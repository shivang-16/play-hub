"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wordPuzzleService = exports.DIFFICULTY_WORD_COUNTS = void 0;
exports.gridSizeForWordCount = gridSizeForWordCount;
const uuid_1 = require("uuid");
const word_puzzle_1 = require("../types/word-puzzle");
const word_bank_1 = require("../data/word-bank");
/** 8 directional vectors: [rowDelta, colDelta] */
const DIRECTIONS = [
    [0, 1], // →  right
    [0, -1], // ←  left
    [1, 0], // ↓  down
    [-1, 0], // ↑  up
    [1, 1], // ↘  down-right
    [1, -1], // ↙  down-left
    [-1, 1], // ↗  up-right
    [-1, -1], // ↖  up-left
];
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// ── Difficulty → word count mapping ──────────────────────────────────────────
exports.DIFFICULTY_WORD_COUNTS = {
    easy: 8,
    medium: 14,
    hard: 20,
};
// ── Board size ───────────────────────────────────────────────────────────────
function gridSizeForWordCount(count) {
    if (count <= 8)
        return 12; // easy  — small, fast
    if (count <= 14)
        return 17; // medium
    return 22; // hard  — large
}
// ── Pick N random unique words from the shared word bank ─────────────────────
function pickWords(n) {
    // Deduplicate WORD_LIST entries first (the bank may have a word listed twice)
    const unique = [...new Set(word_bank_1.WORD_LIST)];
    const shuffled = unique.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(n, shuffled.length));
}
// ── Board generation ─────────────────────────────────────────────────────────
function buildBoard(words, size) {
    const grid = Array.from({ length: size }, () => Array(size).fill(''));
    const placedWords = [];
    for (const word of words) {
        let placed = false;
        let attempts = 0;
        while (!placed && attempts < 300) {
            attempts++;
            const [dr, dc] = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
            const startRow = Math.floor(Math.random() * size);
            const startCol = Math.floor(Math.random() * size);
            // Validate all cells
            const cells = [];
            let valid = true;
            for (let i = 0; i < word.length; i++) {
                const r = startRow + dr * i;
                const c = startCol + dc * i;
                if (r < 0 || r >= size || c < 0 || c >= size) {
                    valid = false;
                    break;
                }
                // Cell is fine if empty or already has the correct letter (word crossing)
                if (grid[r][c] !== '' && grid[r][c] !== word[i]) {
                    valid = false;
                    break;
                }
                cells.push({ row: r, col: c });
            }
            if (valid) {
                for (let i = 0; i < word.length; i++) {
                    grid[cells[i].row][cells[i].col] = word[i];
                }
                placedWords.push({ word, cells });
                placed = true;
            }
        }
        // If a word couldn't be placed after 300 attempts, skip it gracefully
    }
    // Fill remaining cells with random letters
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (grid[r][c] === '') {
                grid[r][c] = ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
            }
        }
    }
    return { grid, placedWords };
}
// ── Main service class ────────────────────────────────────────────────────────
class WordPuzzleService {
    games = new Map();
    /** Create a new game and return its state */
    createGame(players, wordCount) {
        const size = gridSizeForWordCount(wordCount);
        const selectedWords = pickWords(wordCount);
        const { grid, placedWords } = buildBoard(selectedWords, size);
        // Build only the words that were actually placed
        const words = placedWords.map(({ word, cells }) => ({
            id: (0, uuid_1.v4)(),
            word,
            cells,
            claimedBy: null,
            claimedAt: null,
        }));
        const wpPlayers = players.map((p, i) => ({
            username: p.username,
            socketId: '',
            score: 0,
            colorIndex: i % 8,
        }));
        const game = {
            id: (0, uuid_1.v4)(),
            board: grid,
            gridSize: size,
            words,
            players: wpPlayers,
            wordCount: words.length, // actual placed count
            status: 'playing',
            startedAt: Date.now(),
        };
        this.games.set(game.id, game);
        console.log(`📝 Word puzzle game created: ${game.id} (${words.length} words on ${size}×${size} board)`);
        return game;
    }
    getGame(gameId) {
        return this.games.get(gameId);
    }
    getGameByPlayer(username) {
        for (const game of this.games.values()) {
            if (game.status === 'playing' && game.players.some((p) => p.username === username)) {
                return game;
            }
        }
        return undefined;
    }
    /** Update a player's socketId (after reconnect) */
    updateSocketId(gameId, username, socketId) {
        const game = this.games.get(gameId);
        if (!game)
            return;
        const player = game.players.find((p) => p.username === username);
        if (player)
            player.socketId = socketId;
    }
    /**
     * Attempt to claim the word that spans (startRow,startCol)→(endRow,endCol).
     * Returns null if invalid, or the claimed WPWord on success.
     */
    claimWord(gameId, username, startRow, startCol, endRow, endCol) {
        const game = this.games.get(gameId);
        if (!game || game.status !== 'playing')
            return null;
        const player = game.players.find((p) => p.username === username);
        if (!player)
            return null;
        // Build the sequence of cells from start → end
        const cells = this.buildCellPath(startRow, startCol, endRow, endCol);
        if (!cells)
            return null; // not a straight line
        // Build the string spelled by those cells
        const spelled = cells
            .map((c) => game.board[c.row]?.[c.col] ?? '')
            .join('');
        // Find matching unclaimed word (forward or reverse)
        const reversed = spelled.split('').reverse().join('');
        const match = game.words.find((w) => w.claimedBy === null &&
            (w.word === spelled || w.word === reversed) &&
            this.cellsMatch(w.cells, cells, w.word === reversed));
        if (!match)
            return null;
        // Claim it
        match.claimedBy = username;
        match.claimedAt = Date.now();
        const pts = (0, word_puzzle_1.scoreForWord)(match.word);
        player.score += pts;
        console.log(`✅ ${username} claimed "${match.word}" (+${pts} pts) in game ${gameId}`);
        // Check if all words claimed → end game
        const allClaimed = game.words.every((w) => w.claimedBy !== null);
        if (allClaimed) {
            game.status = 'ended';
            game.endedAt = Date.now();
            console.log(`🏁 Word puzzle game ${gameId} ended — all words found`);
        }
        return { word: match, player };
    }
    /**
     * Build the ordered list of cells between (r1,c1) and (r2,c2).
     * Returns null if the path is not axis-aligned or diagonal.
     */
    buildCellPath(r1, c1, r2, c2) {
        const dr = r2 - r1;
        const dc = c2 - c1;
        if (dr === 0 && dc === 0)
            return null; // same cell
        // Must be horizontal, vertical, or 45° diagonal
        if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc))
            return null;
        const steps = Math.max(Math.abs(dr), Math.abs(dc));
        const stepR = dr === 0 ? 0 : dr / Math.abs(dr);
        const stepC = dc === 0 ? 0 : dc / Math.abs(dc);
        const cells = [];
        for (let i = 0; i <= steps; i++) {
            cells.push({ row: r1 + stepR * i, col: c1 + stepC * i });
        }
        return cells;
    }
    /**
     * Check that the path cells match a word's stored cells
     * (possibly reversed if `reversed` is true).
     */
    cellsMatch(wordCells, pathCells, reversed) {
        if (wordCells.length !== pathCells.length)
            return false;
        const orderedPath = reversed ? [...pathCells].reverse() : pathCells;
        return wordCells.every((wc, i) => wc.row === orderedPath[i].row && wc.col === orderedPath[i].col);
    }
    /** Force-end a game (player disconnect with no others) */
    endGame(gameId) {
        const game = this.games.get(gameId);
        if (game) {
            game.status = 'ended';
            game.endedAt = Date.now();
        }
    }
    deleteGame(gameId) {
        this.games.delete(gameId);
    }
}
exports.wordPuzzleService = new WordPuzzleService();
