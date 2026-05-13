"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAYER_COLORS = exports.uuid = void 0;
exports.generateRoomCode = generateRoomCode;
exports.scoreForWord = scoreForWord;
const uuid_1 = require("uuid");
Object.defineProperty(exports, "uuid", { enumerable: true, get: function () { return uuid_1.v4; } });
// ── Utility: generate a 6-char room code ──────────────────────
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}
// ── Scoring ───────────────────────────────────────────────────
/** Points awarded when a player claims a word: length × 10 */
function scoreForWord(word) {
    return word.length * 10;
}
// ── Player colour palette (8 slots) ───────────────────────────
exports.PLAYER_COLORS = [
    '#f87171', // red
    '#60a5fa', // blue
    '#4ade80', // green
    '#fbbf24', // yellow
    '#a78bfa', // purple
    '#f472b6', // pink
    '#34d399', // teal
    '#fb923c', // orange
];
