"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotService = void 0;
const game_1 = require("../types/game");
const game_logic_service_1 = require("./game-logic.service");
class BotService {
    botPlayer;
    humanPlayer;
    constructor(botPlayer) {
        this.botPlayer = botPlayer;
        this.humanPlayer =
            botPlayer === game_1.CellValue.PLAYER1 ? game_1.CellValue.PLAYER2 : game_1.CellValue.PLAYER1;
    }
    getBestMove(board) {
        const validMoves = game_logic_service_1.GameLogic.getValidMoves(board);
        if (validMoves.length === 0) {
            return -1;
        }
        const winningMove = this.findWinningMove(board, this.botPlayer);
        if (winningMove !== -1) {
            console.log('🤖 Bot: Taking winning move at column', winningMove);
            return winningMove;
        }
        const blockingMove = this.findWinningMove(board, this.humanPlayer);
        if (blockingMove !== -1) {
            console.log('🤖 Bot: Blocking opponent at column', blockingMove);
            return blockingMove;
        }
        const strategicMove = this.findStrategicMove(board);
        if (strategicMove !== -1) {
            console.log('🤖 Bot: Making strategic move at column', strategicMove);
            return strategicMove;
        }
        const cols = board[0]?.length ?? 7;
        const mid = (cols - 1) / 2;
        const centerMoves = validMoves.filter((col) => col >= Math.max(0, Math.floor(mid - 1)) && col <= Math.min(cols - 1, Math.ceil(mid + 1)));
        if (centerMoves.length > 0) {
            const move = centerMoves[Math.floor(Math.random() * centerMoves.length)];
            console.log('🤖 Bot: Choosing center column', move);
            return move;
        }
        const move = validMoves[Math.floor(Math.random() * validMoves.length)];
        console.log('🤖 Bot: Random move at column', move);
        return move;
    }
    findWinningMove(board, player) {
        const cols = board[0]?.length ?? 7;
        for (let col = 0; col < cols; col++) {
            if (game_logic_service_1.GameLogic.isColumnFull(board, col))
                continue;
            const testBoard = game_logic_service_1.GameLogic.cloneBoard(board);
            const row = game_logic_service_1.GameLogic.dropDisc(testBoard, col, player);
            if (row !== -1) {
                const winReason = game_logic_service_1.GameLogic.checkWin(testBoard, row, col);
                if (winReason) {
                    return col;
                }
            }
        }
        return -1;
    }
    findStrategicMove(board) {
        const cols = board[0]?.length ?? 7;
        const strategicScores = [];
        for (let col = 0; col < cols; col++) {
            if (game_logic_service_1.GameLogic.isColumnFull(board, col))
                continue;
            const testBoard = game_logic_service_1.GameLogic.cloneBoard(board);
            const row = game_logic_service_1.GameLogic.dropDisc(testBoard, col, this.botPlayer);
            if (row !== -1) {
                const score = this.evaluatePosition(testBoard, row, col);
                strategicScores.push({ col, score });
            }
        }
        if (strategicScores.length > 0) {
            strategicScores.sort((a, b) => b.score - a.score);
            if (strategicScores[0].score > 0) {
                return strategicScores[0].col;
            }
        }
        return -1;
    }
    evaluatePosition(board, row, col) {
        let score = 0;
        const player = board[row][col];
        const directions = [
            { dr: 0, dc: 1 },
            { dr: 1, dc: 0 },
            { dr: 1, dc: 1 },
            { dr: -1, dc: 1 },
        ];
        for (const { dr, dc } of directions) {
            const count = this.countConsecutive(board, row, col, dr, dc, player);
            if (count === 2)
                score += 5;
            if (count === 3)
                score += 20;
        }
        return score;
    }
    countConsecutive(board, row, col, rowDir, colDir, player) {
        let count = 1;
        const numCols = board[0]?.length ?? 7;
        let r = row + rowDir;
        let c = col + colDir;
        while (r >= 0 &&
            r < board.length &&
            c >= 0 &&
            c < numCols &&
            board[r][c] === player) {
            count++;
            r += rowDir;
            c += colDir;
        }
        r = row - rowDir;
        c = col - colDir;
        while (r >= 0 &&
            r < board.length &&
            c >= 0 &&
            c < numCols &&
            board[r][c] === player) {
            count++;
            r -= rowDir;
            c -= colDir;
        }
        return count;
    }
}
exports.BotService = BotService;
