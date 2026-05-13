"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uuid = exports.BINGO_PLAYER_COLORS = void 0;
exports.generateBingoRoomCode = generateBingoRoomCode;
exports.generateBingoCard = generateBingoCard;
exports.checkBingoWin = checkBingoWin;
const uuid_1 = require("uuid");
Object.defineProperty(exports, "uuid", { enumerable: true, get: function () { return uuid_1.v4; } });
exports.BINGO_PLAYER_COLORS = [
    '#f87171', // red
    '#60a5fa', // blue
    '#4ade80', // green
    '#fbbf24', // yellow
    '#a78bfa', // purple
    '#f472b6', // pink
    '#34d399', // teal
    '#fb923c', // orange
];
function generateBingoRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}
/** Generates a standard 5×5 Bingo card.
 *  B: 1-15, I: 16-30, N: 31-45, G: 46-60, O: 61-75
 *  Center cell (2,2) is a FREE space = 0
 */
function generateBingoCard() {
    const card = [];
    const ranges = [
        [1, 15], // B
        [16, 30], // I
        [31, 45], // N
        [46, 60], // G
        [61, 75], // O
    ];
    for (let col = 0; col < 5; col++) {
        const [min, max] = ranges[col];
        const nums = pickUniqueNumbers(min, max, 5);
        for (let row = 0; row < 5; row++) {
            if (!card[row])
                card[row] = [];
            card[row][col] = nums[row];
        }
    }
    // Free space in center
    card[2][2] = 0;
    return card;
}
function pickUniqueNumbers(min, max, count) {
    const pool = [];
    for (let i = min; i <= max; i++)
        pool.push(i);
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
}
/** Returns the winning line indices (rows 0-4, cols 5-9, diags 10-11) or empty array. */
function checkBingoWin(card, marked) {
    const lines = [];
    // Rows
    for (let r = 0; r < 5; r++) {
        if (marked[r].every(Boolean))
            lines.push([r, 0, r, 1, r, 2, r, 3, r, 4]);
    }
    // Cols
    for (let c = 0; c < 5; c++) {
        if (marked.every((row) => row[c]))
            lines.push([0, c, 1, c, 2, c, 3, c, 4, c]);
    }
    // Diagonals
    if ([0, 1, 2, 3, 4].every((i) => marked[i][i]))
        lines.push([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    if ([0, 1, 2, 3, 4].every((i) => marked[i][4 - i]))
        lines.push([0, 4, 1, 3, 2, 2, 3, 1, 4, 0]);
    return lines;
}
