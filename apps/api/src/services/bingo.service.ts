import { v4 as uuidv4 } from 'uuid';
import {
  BingoGameState,
  BingoPlayer,
  checkBingoLines,
  shufflePool,
  generateBotCard,
} from '../types/bingo';

export interface BingoMarkResult {
  success: boolean;
  error?: string;
  alreadyMarked?: boolean;
  newLines?: number;       // how many new lines this mark completed
  totalLines?: number;
  winReached?: boolean;    // reached WIN_LINES threshold
  gameOver?: boolean;
  winner?: string | null;
  rankings?: { username: string; rank: number }[];
}

export interface BingoCallResult {
  success: boolean;
  error?: string;
  calledNumber?: number;
  nextCallerIndex?: number;
  gameOver?: boolean;
  winner?: string | null;
  rankings?: { username: string; rank: number }[];
}

// First player to complete this many lines wins
const WIN_LINES = 5;

class BingoService {
  private games: Map<string, BingoGameState> = new Map();

  createGame(
    players: { username: string; isBot?: boolean }[],
    gridRows: number,
    gridCols: number,
  ): BingoGameState {
    const gameId = uuidv4();

    const gamePlayers: BingoPlayer[] = players.map((p, i) => {
      const isBot = !!p.isBot;
      const card = isBot
        ? generateBotCard(gridRows, gridCols)
        // Human players start with empty card (null = unfilled)
        : Array.from({ length: gridRows }, () => new Array(gridCols).fill(null));

      const marked: boolean[][] = Array.from({ length: gridRows }, () =>
        new Array(gridCols).fill(false)
      );

      return {
        username: p.username,
        card,
        markedCells: marked,
        colorIndex: i % 8,
        bingoLines: 0,
        rank: null,
        isBot,
      };
    });

    // Number pool = 1 .. rows*cols, shuffled
    const maxNum = gridRows * gridCols;
    const pool = shufflePool(1, maxNum);

    const state: BingoGameState = {
      id: gameId,
      players: gamePlayers,
      gridRows,
      gridCols,
      calledNumbers: [],
      currentCall: null,
      currentCallerIndex: 0,
      // If all players are bots, skip filling phase
      status: gamePlayers.every((p) => p.isBot) ? 'playing' : 'filling',
      winner: null,
      rankings: [],
      startedAt: new Date(),
      isBot: players.some((p) => p.isBot),
      botUsername: players.find((p) => p.isBot)?.username,
      numberPool: pool,
    };

    this.games.set(gameId, state);
    return state;
  }

  getGame(gameId: string): BingoGameState | undefined {
    return this.games.get(gameId);
  }

  deleteGame(gameId: string): void {
    this.games.delete(gameId);
  }

  /** Player submits their filled card. Returns true if all humans have submitted → game can start. */
  submitCard(gameId: string, username: string, card: number[][]): { success: boolean; allReady?: boolean; error?: string } {
    const game = this.games.get(gameId);
    if (!game) return { success: false, error: 'Game not found' };
    if (game.status !== 'filling') return { success: false, error: 'Not in filling phase' };

    const player = game.players.find((p) => p.username === username);
    if (!player) return { success: false, error: 'Player not found' };
    if (player.isBot) return { success: false, error: 'Bot cannot submit card' };

    // Validate card dimensions
    if (card.length !== game.gridRows || card.some((row) => row.length !== game.gridCols)) {
      return { success: false, error: 'Invalid card dimensions' };
    }

    // Validate all cells are filled with numbers in valid range
    const maxNum = game.gridRows * game.gridCols;
    const seen = new Set<number>();
    for (const row of card) {
      for (const val of row) {
        if (!val || val < 1 || val > maxNum || seen.has(val)) {
          return { success: false, error: `Invalid or duplicate number: ${val}. Use 1–${maxNum}.` };
        }
        seen.add(val);
      }
    }

    player.card = card;

    // Check if all human players have submitted
    const allReady = game.players.filter((p) => !p.isBot).every((p) =>
      p.card.every((row) => row.every((v) => v !== null))
    );

    if (allReady) {
      game.status = 'playing';
    }

    return { success: true, allReady };
  }

  /** The current caller picks a specific number to call. */
  callNumber(gameId: string, callerUsername: string, chosenNumber: number): BingoCallResult {
    const game = this.games.get(gameId);
    if (!game) return { success: false, error: 'Game not found' };
    if (game.status !== 'playing') return { success: false, error: 'Game not in playing state' };

    const currentCaller = game.players[game.currentCallerIndex];
    if (!currentCaller) return { success: false, error: 'No caller found' };
    if (currentCaller.username !== callerUsername) {
      return { success: false, error: 'Not your turn to call' };
    }

    const maxNum = game.gridRows * game.gridCols;
    if (!chosenNumber || chosenNumber < 1 || chosenNumber > maxNum) {
      return { success: false, error: `Choose a number between 1 and ${maxNum}` };
    }
    if (game.calledNumbers.includes(chosenNumber)) {
      return { success: false, error: `${chosenNumber} has already been called` };
    }

    // Block calling if ANY human player still hasn't marked the previous call on their card
    // (skip this check when the bot is the caller — bot calls immediately after marking)
    const callerIsBot = game.players.find((p) => p.username === callerUsername)?.isBot ?? false;
    if (!callerIsBot && game.currentCall !== null) {
      const prev = game.currentCall;
      for (const player of game.players) {
        if (player.isBot || player.rank !== null) continue;
        for (let r = 0; r < game.gridRows; r++) {
          for (let c = 0; c < game.gridCols; c++) {
            if (player.card[r]![c] === prev && !player.markedCells[r]![c]) {
              const isCallerSelf = player.username === callerUsername;
              const msg = isCallerSelf
                ? `Mark ${prev} on your card first`
                : `Waiting for ${player.username} to mark ${prev}`;
              return { success: false, error: msg };
            }
          }
        }
      }
    }

    if (game.numberPool.length === 0) {
      game.status = 'completed';
      return { success: true, gameOver: true, winner: game.winner, rankings: game.rankings };
    }

    // Remove the chosen number from the pool
    const poolIdx = game.numberPool.indexOf(chosenNumber);
    if (poolIdx === -1) {
      return { success: false, error: `${chosenNumber} has already been called` };
    }
    game.numberPool.splice(poolIdx, 1);

    const num = chosenNumber;
    game.calledNumbers.push(num);
    game.currentCall = num;

    // Advance caller to next player (includes bots)
    const callerIdx = game.players.findIndex((p) => p.username === callerUsername);
    game.currentCallerIndex = (callerIdx + 1) % game.players.length;

    return {
      success: true,
      calledNumber: num,
      nextCallerIndex: game.currentCallerIndex,
    };
  }

  /** Player manually marks a cell on their card. */
  markCell(gameId: string, username: string, row: number, col: number): BingoMarkResult {
    const game = this.games.get(gameId);
    if (!game) return { success: false, error: 'Game not found' };
    if (game.status !== 'playing') return { success: false, error: 'Game not active' };

    const player = game.players.find((p) => p.username === username);
    if (!player) return { success: false, error: 'Player not found' };
    if (player.rank !== null) return { success: false, error: 'Player already finished' };

    const cellValue = player.card[row]?.[col];
    if (cellValue === undefined || cellValue === null) return { success: false, error: 'Invalid cell' };

    // The cell value must have been called already
    if (!game.calledNumbers.includes(cellValue)) {
      return { success: false, error: `${cellValue} has not been called yet` };
    }

    if (player.markedCells[row]![col]) {
      return { success: false, alreadyMarked: true };
    }

    player.markedCells[row]![col] = true;

    // Check lines
    const lines = checkBingoLines(player.markedCells, game.gridRows, game.gridCols);
    const prevLines = player.bingoLines;
    player.bingoLines = lines.length;
    const newLines = lines.length - prevLines;

    // Win check
    const winReached = lines.length >= WIN_LINES && prevLines < WIN_LINES;

    if (winReached) {
      const rank = game.rankings.length + 1;
      player.rank = rank;
      game.rankings.push({ username, rank });
      if (!game.winner) game.winner = username;
    }

    // Game over when all players have won or pool exhausted
    const unranked = game.players.filter((p) => p.rank === null);
    const gameOver = unranked.length === 0 || game.numberPool.length === 0;

    if (gameOver && game.status === 'playing') {
      let remaining = game.rankings.length + 1;
      for (const p of unranked) {
        p.rank = remaining++;
        game.rankings.push({ username: p.username, rank: p.rank });
      }
      game.status = 'completed';
      game.endedAt = new Date();
    }

    return {
      success: true,
      newLines,
      totalLines: lines.length,
      winReached,
      gameOver: game.status === 'completed',
      winner: game.winner,
      rankings: game.rankings,
    };
  }

  /** Bot automatically marks its card when a number is called. */
  botMark(gameId: string, botUsername: string, calledNumber: number): BingoMarkResult {
    const game = this.games.get(gameId);
    if (!game) return { success: false, error: 'Game not found' };

    const bot = game.players.find((p) => p.username === botUsername);
    if (!bot) return { success: false, error: 'Bot not found' };

    for (let r = 0; r < game.gridRows; r++) {
      for (let c = 0; c < game.gridCols; c++) {
        if (bot.card[r]![c] === calledNumber) {
          bot.markedCells[r]![c] = true;
        }
      }
    }

    const lines = checkBingoLines(bot.markedCells, game.gridRows, game.gridCols);
    const prevLines = bot.bingoLines;
    bot.bingoLines = lines.length;
    const winReached = lines.length >= WIN_LINES && prevLines < WIN_LINES;

    if (winReached && bot.rank === null) {
      const rank = game.rankings.length + 1;
      bot.rank = rank;
      game.rankings.push({ username: botUsername, rank });
      if (!game.winner) game.winner = botUsername;
    }

    const unranked = game.players.filter((p) => p.rank === null);
    const gameOver = unranked.length === 0;

    if (gameOver && game.status === 'playing') {
      let remaining = game.rankings.length + 1;
      for (const p of unranked) {
        p.rank = remaining++;
        game.rankings.push({ username: p.username, rank: p.rank });
      }
      game.status = 'completed';
      game.endedAt = new Date();
    }

    return {
      success: true,
      winReached,
      totalLines: lines.length,
      gameOver: game.status === 'completed',
      winner: game.winner,
      rankings: game.rankings,
    };
  }
}

export const bingoService = new BingoService();
