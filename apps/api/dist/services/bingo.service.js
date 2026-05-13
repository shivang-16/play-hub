"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bingoService = void 0;
const uuid_1 = require("uuid");
const bingo_1 = require("../types/bingo");
class BingoService {
    games = new Map();
    // Numbers 1-75 remaining to be called for each game
    numberPools = new Map();
    createGame(players, options) {
        const gameId = (0, uuid_1.v4)();
        const bingoPLayers = players.map((p, i) => {
            const card = (0, bingo_1.generateBingoCard)();
            // Initialize marked: center free space is pre-marked
            const marked = Array.from({ length: 5 }, () => new Array(5).fill(false));
            marked[2][2] = true;
            return {
                username: p.username,
                card,
                markedCells: marked,
                colorIndex: i % 8,
                hasBingo: false,
                bingoLines: [],
                rank: null,
            };
        });
        // Shuffle numbers 1-75
        const pool = Array.from({ length: 75 }, (_, i) => i + 1);
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const state = {
            id: gameId,
            players: bingoPLayers,
            calledNumbers: [],
            currentCall: null,
            status: 'playing',
            winner: null,
            rankings: [],
            isInviteGame: options?.isInviteGame,
            partyId: options?.partyId,
            startedAt: new Date(),
            isBot: players.some((p) => p.isBot),
            botUsername: players.find((p) => p.isBot)?.username,
        };
        this.games.set(gameId, state);
        this.numberPools.set(gameId, pool);
        return state;
    }
    getGame(gameId) {
        return this.games.get(gameId);
    }
    deleteGame(gameId) {
        this.games.delete(gameId);
        this.numberPools.delete(gameId);
    }
    /** Called when a number is drawn (auto-call for bot/quick games, or host presses "Call" button). */
    callNextNumber(gameId) {
        const game = this.games.get(gameId);
        if (!game)
            return { success: false, error: 'Game not found' };
        if (game.status !== 'playing')
            return { success: false, error: 'Game is not active' };
        const pool = this.numberPools.get(gameId);
        if (!pool || pool.length === 0) {
            // All numbers called — force end
            game.status = 'completed';
            return { success: true, gameOver: true, winner: null, rankings: game.rankings };
        }
        const num = pool.pop();
        game.calledNumbers.push(num);
        game.currentCall = num;
        // Auto-mark cells for all players
        const newBingoPlayers = [];
        let rankCounter = game.rankings.length + 1;
        for (const player of game.players) {
            if (player.rank !== null)
                continue; // already ranked out
            // Mark matching cells
            for (let r = 0; r < 5; r++) {
                for (let c = 0; c < 5; c++) {
                    if (player.card[r][c] === num) {
                        player.markedCells[r][c] = true;
                    }
                }
            }
            // Check for new bingo lines
            const lines = (0, bingo_1.checkBingoWin)(player.card, player.markedCells);
            if (lines.length > player.bingoLines.length) {
                player.bingoLines = lines;
                if (!player.hasBingo) {
                    player.hasBingo = true;
                    player.rank = rankCounter++;
                    newBingoPlayers.push(player.username);
                    game.rankings.push({ username: player.username, rank: player.rank });
                    if (!game.winner)
                        game.winner = player.username;
                }
            }
        }
        // Game over when all players have bingo or pool empty
        const activePlayers = game.players.filter((p) => p.rank === null);
        const gameOver = activePlayers.length === 0 || pool.length === 0;
        if (gameOver) {
            // Assign remaining ranks
            let remaining = rankCounter;
            for (const player of activePlayers) {
                player.rank = remaining++;
                game.rankings.push({ username: player.username, rank: player.rank });
            }
            game.status = 'completed';
            game.endedAt = new Date();
        }
        return {
            success: true,
            calledNumber: num,
            updatedPlayers: game.players,
            newBingoPlayers,
            gameOver,
            winner: game.winner,
            rankings: game.rankings,
        };
    }
    /** Bot marks its card for a called number and checks for bingo. */
    botMark(gameId, botUsername, calledNumber) {
        const game = this.games.get(gameId);
        if (!game)
            return { success: false, error: 'Game not found' };
        const bot = game.players.find((p) => p.username === botUsername);
        if (!bot)
            return { success: false, error: 'Bot not found' };
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                if (bot.card[r][c] === calledNumber) {
                    bot.markedCells[r][c] = true;
                }
            }
        }
        const lines = (0, bingo_1.checkBingoWin)(bot.card, bot.markedCells);
        return { success: true, updatedPlayers: game.players, newBingoPlayers: lines.length > 0 ? [botUsername] : [] };
    }
    getRemainingCount(gameId) {
        return this.numberPools.get(gameId)?.length ?? 0;
    }
}
exports.bingoService = new BingoService();
