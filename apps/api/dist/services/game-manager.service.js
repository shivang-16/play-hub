"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gameManager = exports.GameManager = void 0;
const uuid_1 = require("uuid");
const game_1 = require("../types/game");
const game_logic_service_1 = require("./game-logic.service");
const bot_service_1 = require("./bot.service");
const websocket_service_1 = require("../websocket/websocket.service");
const game_model_1 = require("../models/game.model");
const kafka_service_1 = require("./kafka.service");
class GameManager {
    activeGames = new Map();
    playerToGame = new Map();
    /**
     * Creates a game from an ordered list of participants (turn order = array order).
     * Used by matchmaking (2 humans), bot queue (human + bot), and private rooms (2–8 humans).
     */
    createGame(participants, options) {
        if (participants.length < 2) {
            throw new Error('At least 2 players required');
        }
        if (participants.length > game_1.MAX_PLAYERS_PER_GAME) {
            throw new Error(`At most ${game_1.MAX_PLAYERS_PER_GAME} players`);
        }
        const gameId = (0, uuid_1.v4)();
        const partyId = options?.isInviteGame === true
            ? options.partyId ?? (0, uuid_1.v4)()
            : undefined;
        const { rows, cols } = (0, game_1.boardSizeForPlayerCount)(participants.length);
        const winStreak = options?.winStreak != null
            ? Math.max(4, Math.min(8, options.winStreak))
            : (0, game_1.winStreakForPlayerCount)(participants.length);
        const players = participants.map((p) => ({
            id: (0, uuid_1.v4)(),
            username: p.username,
            isBot: p.isBot,
            connected: !p.isBot,
        }));
        const gameState = {
            id: gameId,
            board: game_logic_service_1.GameLogic.createEmptyBoard(rows, cols),
            rows,
            cols,
            players,
            currentTurn: game_1.CellValue.PLAYER1,
            status: game_1.GameStatus.IN_PROGRESS,
            winner: null,
            winReason: null,
            moves: [],
            startedAt: new Date(),
            winStreak,
            isInviteGame: options?.isInviteGame,
            partyId,
        };
        this.activeGames.set(gameId, gameState);
        for (const p of players) {
            if (!p.isBot) {
                this.playerToGame.set(p.username, gameId);
            }
        }
        const names = players.map((p) => p.username).join(' vs ');
        console.log(`🎮 Game created: ${gameId} - ${names} (${winStreak}-in-a-row)`);
        if (websocket_service_1.wsService) {
            websocket_service_1.wsService.emitGameStart(gameState, options?.colorChoices);
        }
        kafka_service_1.kafkaService.sendGameEvent(kafka_service_1.GameEventType.GAME_STARTED, {
            gameId,
            player1: players[0]?.username,
            player2: players[1]?.username,
            players: players.map((p) => p.username),
            isBot: players.some((p) => p.isBot),
        });
        return gameState;
    }
    /** Backward-compatible helper for two-player flows */
    createTwoPlayerGame(player1Username, player2Username, player2IsBot) {
        return this.createGame([
            { username: player1Username, isBot: false },
            { username: player2Username, isBot: player2IsBot },
        ]);
    }
    makeMove(gameId, username, column) {
        const game = this.activeGames.get(gameId);
        if (!game) {
            return { success: false, error: 'Game not found' };
        }
        if (game.status !== game_1.GameStatus.IN_PROGRESS) {
            return { success: false, error: 'Game is not in progress' };
        }
        const slot = (0, game_1.cellValueToSlotIndex)(game.currentTurn);
        const expectedUsername = game.players[slot]?.username;
        if (!expectedUsername || username !== expectedUsername) {
            const inGame = game.players.some((p) => p.username === username);
            if (!inGame) {
                return { success: false, error: 'Player not in this game' };
            }
            return { success: false, error: 'Not your turn' };
        }
        const result = game_logic_service_1.GameLogic.makeMove(game.board, column, game.currentTurn, game.winStreak);
        if (!result.success) {
            return result;
        }
        const move = {
            player: username,
            column,
            row: result.row,
            timestamp: new Date(),
        };
        game.moves.push(move);
        kafka_service_1.kafkaService.sendGameEvent(kafka_service_1.GameEventType.MOVE_MADE, {
            gameId,
            player: username,
            column,
            row: result.row,
            moveNumber: game.moves.length,
        });
        const isMultiplayer = game.players.length > 2;
        // ── Multiplayer ranking flow ────────────────────────────────────────────
        if (isMultiplayer && result.winningPlayer !== undefined) {
            if (!game.rankedOut)
                game.rankedOut = [];
            const rankAchieved = game.rankedOut.length + 1;
            game.players[slot].rank = rankAchieved;
            game.rankedOut.push({ username, rank: rankAchieved });
            const remainingUnranked = game.players.filter((p) => p.rank == null);
            if (remainingUnranked.length <= 1) {
                // Last unranked player gets final rank → game over
                if (remainingUnranked.length === 1) {
                    const lastPlayer = remainingUnranked[0];
                    const lastRank = rankAchieved + 1;
                    lastPlayer.rank = lastRank;
                    game.rankedOut.push({ username: lastPlayer.username, rank: lastRank });
                }
                game.status = game_1.GameStatus.COMPLETED;
                game.winner = username; // rank 1 player is the overall winner
                game.winReason = result.winReason;
                game.endedAt = new Date();
                // Emit final rank event + board update first so clients can flash winning cells
                if (websocket_service_1.wsService) {
                    websocket_service_1.wsService.emitGameUpdate(gameId, {
                        board: game.board,
                        currentTurn: game.currentTurn,
                        lastMove: move,
                        isGameOver: true,
                        rankEvent: { username, rank: rankAchieved, winningCells: result.winningCells },
                        rankings: game.rankedOut,
                    });
                    this.notifyGameEnded(game, gameId, result.winReason, undefined);
                }
                this.saveGameToDatabase(game);
                kafka_service_1.kafkaService.sendGameEvent(kafka_service_1.GameEventType.GAME_ENDED, {
                    gameId,
                    winner: game.winner,
                    reason: result.winReason,
                    duration: game.endedAt.getTime() - game.startedAt.getTime(),
                    totalMoves: game.moves.length,
                });
                this.cleanupGameMaps(gameId, game);
                console.log(`🏁 Multiplayer ranking game over: ${game.rankedOut.map((r) => `${r.rank}.${r.username}`).join(' ')}`);
            }
            else {
                // Advance turn past ranked-out players
                const n = game.players.length;
                let nextSlot = (slot + 1) % n;
                while (game.players[nextSlot]?.rank != null) {
                    nextSlot = (nextSlot + 1) % n;
                }
                game.currentTurn = (0, game_1.slotIndexToCellValue)(nextSlot);
                if (websocket_service_1.wsService) {
                    websocket_service_1.wsService.emitGameUpdate(gameId, {
                        board: game.board,
                        currentTurn: game.currentTurn,
                        lastMove: move,
                        isGameOver: false,
                        rankEvent: { username, rank: rankAchieved, winningCells: result.winningCells },
                        rankings: game.rankedOut,
                    });
                }
                console.log(`🏅 ${username} ranked #${rankAchieved}. ${remainingUnranked.length} unranked remain.`);
                const nextPl = game.players[nextSlot];
                if (nextPl?.isBot)
                    setTimeout(() => this.makeBotMove(gameId), 1500);
            }
            return result;
        }
        // ── Classic 2-player win / draw ─────────────────────────────────────────
        if (result.winningPlayer !== undefined || result.isDraw) {
            game.status = game_1.GameStatus.COMPLETED;
            if (result.isDraw) {
                game.winner = null;
            }
            else {
                const winSlot = (0, game_1.cellValueToSlotIndex)(result.winningPlayer);
                game.winner = game.players[winSlot]?.username ?? null;
            }
            game.winReason = result.winReason;
            game.endedAt = new Date();
            if (websocket_service_1.wsService) {
                this.notifyGameEnded(game, gameId, result.winReason, result.winningCells);
            }
            this.saveGameToDatabase(game);
            kafka_service_1.kafkaService.sendGameEvent(kafka_service_1.GameEventType.GAME_ENDED, {
                gameId,
                winner: game.winner,
                reason: result.winReason,
                duration: game.endedAt.getTime() - game.startedAt.getTime(),
                totalMoves: game.moves.length,
            });
            this.cleanupGameMaps(gameId, game);
            console.log(`🧹 Cleaned up game ${gameId} from active games`);
        }
        else {
            const n = game.players.length;
            let nextSlot = (slot + 1) % n;
            // Skip ranked-out players (multiplayer ranking games)
            while (game.players[nextSlot]?.rank != null) {
                nextSlot = (nextSlot + 1) % n;
            }
            game.currentTurn = (0, game_1.slotIndexToCellValue)(nextSlot);
            const nextPlayer = game.players[nextSlot];
            if (nextPlayer?.isBot) {
                setTimeout(() => this.makeBotMove(gameId), 1000);
            }
        }
        if (websocket_service_1.wsService) {
            websocket_service_1.wsService.emitGameUpdate(gameId, {
                board: game.board,
                currentTurn: game.currentTurn,
                lastMove: move,
                isGameOver: game.status === game_1.GameStatus.COMPLETED,
            });
        }
        return result;
    }
    makeBotMove(gameId) {
        const game = this.activeGames.get(gameId);
        if (!game || game.status !== game_1.GameStatus.IN_PROGRESS)
            return;
        const slot = (0, game_1.cellValueToSlotIndex)(game.currentTurn);
        const bot = game.players[slot];
        if (!bot?.isBot)
            return;
        const botService = new bot_service_1.BotService(game.currentTurn);
        const column = botService.getBestMove(game.board);
        if (column !== -1) {
            this.makeMove(gameId, bot.username, column);
        }
    }
    notifyGameEnded(game, gameId, reason, winningCells) {
        if (!websocket_service_1.wsService)
            return;
        const humans = game.players.filter((p) => !p.isBot).map((p) => p.username);
        if (game.isInviteGame && game.partyId && humans.length >= 2) {
            websocket_service_1.wsService.registerInviteRematch(game.partyId, humans, game.winStreak);
        }
        websocket_service_1.wsService.emitGameEnd(gameId, game.winner, reason, winningCells, {
            partyId: game.partyId,
            canRematch: Boolean(game.isInviteGame && game.partyId && humans.length >= 2),
            rematchPlayers: game.isInviteGame && game.partyId ? humans : undefined,
        });
    }
    cleanupGameMaps(gameId, game) {
        this.activeGames.delete(gameId);
        for (const p of game.players) {
            if (!p.isBot) {
                this.playerToGame.delete(p.username);
            }
        }
    }
    /**
     * After a disconnect timeout: remove that player from the game, remap discs + gravity,
     * and keep playing if at least two players remain; otherwise the sole remaining player wins.
     */
    removeDisconnectedPlayerFromGame(gameId, disconnectedUsername) {
        const game = this.activeGames.get(gameId);
        if (!game || game.status !== game_1.GameStatus.IN_PROGRESS)
            return false;
        const removedIndex = game.players.findIndex((p) => p.username === disconnectedUsername);
        if (removedIndex === -1)
            return false;
        const oldN = game.players.length;
        const oldTurnSlot = (0, game_1.cellValueToSlotIndex)(game.currentTurn);
        game_logic_service_1.GameLogic.remapBoardRemovePlayer(game.board, removedIndex);
        game.players.splice(removedIndex, 1);
        this.playerToGame.delete(disconnectedUsername);
        const newN = game.players.length;
        if (newN < 2) {
            const sole = game.players[0];
            game.status = game_1.GameStatus.COMPLETED;
            game.winner = sole?.username ?? null;
            game.winReason = game_1.WinReason.OPPONENT_DISCONNECT;
            game.endedAt = new Date();
            if (sole) {
                game.currentTurn = (0, game_1.slotIndexToCellValue)(0);
            }
            if (websocket_service_1.wsService) {
                websocket_service_1.wsService.emitGameUpdate(gameId, {
                    board: game.board,
                    currentTurn: game.currentTurn,
                    playerUsernames: game.players.map((p) => p.username),
                    playerLeft: disconnectedUsername,
                });
                this.notifyGameEnded(game, gameId, game_1.WinReason.OPPONENT_DISCONNECT, undefined);
            }
            this.saveGameToDatabase(game).catch((e) => console.error(e));
            this.cleanupGameMaps(gameId, game);
            return true;
        }
        let newTurnSlot;
        if (oldTurnSlot === removedIndex) {
            const nextOld = (removedIndex + 1) % oldN;
            newTurnSlot = nextOld > removedIndex ? nextOld - 1 : nextOld;
        }
        else {
            newTurnSlot = oldTurnSlot > removedIndex ? oldTurnSlot - 1 : oldTurnSlot;
        }
        game.currentTurn = (0, game_1.slotIndexToCellValue)(newTurnSlot);
        if (websocket_service_1.wsService) {
            websocket_service_1.wsService.emitGameUpdate(gameId, {
                board: game.board,
                currentTurn: game.currentTurn,
                playerUsernames: game.players.map((p) => p.username),
                playerLeft: disconnectedUsername,
            });
        }
        const nextSlot = (0, game_1.cellValueToSlotIndex)(game.currentTurn);
        const nextPl = game.players[nextSlot];
        if (nextPl?.isBot) {
            setTimeout(() => this.makeBotMove(gameId), 1000);
        }
        return true;
    }
    getGame(gameId) {
        return this.activeGames.get(gameId);
    }
    getGameByPlayer(username) {
        const gameId = this.playerToGame.get(username);
        if (!gameId)
            return undefined;
        const game = this.activeGames.get(gameId);
        if (!game) {
            console.log(`🧹 Cleaning up stale player mapping for ${username} (game ${gameId} no longer exists)`);
            this.playerToGame.delete(username);
            return undefined;
        }
        return game;
    }
    clearPlayerMapping(username) {
        if (this.playerToGame.has(username)) {
            console.log(`🧹 Cleared player mapping for ${username}`);
            this.playerToGame.delete(username);
        }
    }
    async saveGameToDatabase(game) {
        try {
            const p0 = game.players[0];
            const p1 = game.players[1] ?? p0;
            await game_model_1.Game.create({
                gameId: game.id,
                player1: {
                    username: p0.username,
                    isBot: p0.isBot,
                },
                player2: {
                    username: p1.username,
                    isBot: p1.isBot,
                },
                allPlayers: game.players.map((p) => ({
                    username: p.username,
                    isBot: p.isBot,
                })),
                board: game.board,
                status: game.status,
                winner: game.winner,
                winReason: game.winReason,
                moves: game.moves,
                startedAt: game.startedAt,
                endedAt: game.endedAt,
                duration: game.endedAt ? game.endedAt.getTime() - game.startedAt.getTime() : undefined,
            });
            console.log(`💾 Game saved to database: ${game.id}`);
        }
        catch (error) {
            console.error('Failed to save game to database:', error);
        }
    }
    getActiveGames() {
        return Array.from(this.activeGames.values());
    }
}
exports.GameManager = GameManager;
exports.gameManager = new GameManager();
