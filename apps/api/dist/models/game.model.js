"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Game = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const game_1 = require("../types/game");
const GameSchema = new mongoose_1.Schema({
    gameId: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    player1: {
        username: { type: String, required: true },
        isBot: { type: Boolean, default: false },
    },
    player2: {
        username: { type: String, required: true },
        isBot: { type: Boolean, default: false },
    },
    allPlayers: [
        {
            username: { type: String, required: true },
            isBot: { type: Boolean, default: false },
        },
    ],
    board: {
        type: [[Number]],
        required: true,
    },
    status: {
        type: String,
        enum: Object.values(game_1.GameStatus),
        default: game_1.GameStatus.IN_PROGRESS,
    },
    winner: {
        type: String,
        default: null,
    },
    winReason: {
        type: String,
        enum: [...Object.values(game_1.WinReason), null],
        default: null,
    },
    moves: [
        {
            player: { type: String, required: true },
            column: { type: Number, required: true },
            row: { type: Number, required: true },
            timestamp: { type: Date, default: Date.now },
        },
    ],
    startedAt: {
        type: Date,
        default: Date.now,
    },
    endedAt: {
        type: Date,
    },
    duration: {
        type: Number,
    },
}, {
    timestamps: true,
});
// Index for leaderboard queries
GameSchema.index({ winner: 1, status: 1 });
GameSchema.index({ 'player1.username': 1 });
GameSchema.index({ 'player2.username': 1 });
exports.Game = mongoose_1.default.model('Game', GameSchema);
