"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uuid = exports.DAB_PLAYER_COLORS = void 0;
exports.generateDABRoomCode = generateDABRoomCode;
exports.initDABGame = initDABGame;
const uuid_1 = require("uuid");
Object.defineProperty(exports, "uuid", { enumerable: true, get: function () { return uuid_1.v4; } });
exports.DAB_PLAYER_COLORS = [
    '#f87171', // red
    '#60a5fa', // blue
    '#4ade80', // green
    '#fbbf24', // yellow
    '#a78bfa', // purple
    '#f472b6', // pink
    '#34d399', // teal
    '#fb923c', // orange
];
// Room code generator (shared with word-puzzle pattern)
function generateDABRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}
function initDABGame(rows, cols, numPlayers) {
    const hLines = Array.from({ length: rows + 1 }, () => new Array(cols).fill(null));
    const vLines = Array.from({ length: rows }, () => new Array(cols + 1).fill(null));
    const boxes = Array.from({ length: rows }, () => new Array(cols).fill(null));
    return {
        gameId: (0, uuid_1.v4)(),
        hLines,
        vLines,
        boxes,
        scores: new Array(numPlayers).fill(0),
        currentTurn: 0,
    };
}
