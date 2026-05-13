"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameLogic = void 0;
const game_1 = require("../types/game");
class GameLogic {
    static dims(board) {
        const rows = board.length;
        const cols = board[0]?.length ?? 0;
        return { rows, cols };
    }
    static createEmptyBoard(rows = game_1.ROWS, cols = game_1.COLS) {
        return Array(rows)
            .fill(null)
            .map(() => Array(cols).fill(game_1.CellValue.EMPTY));
    }
    static dropDisc(board, column, player) {
        const { rows, cols } = this.dims(board);
        if (column < 0 || column >= cols) {
            return -1;
        }
        for (let row = rows - 1; row >= 0; row--) {
            if (board[row][column] === game_1.CellValue.EMPTY) {
                board[row][column] = player;
                return row;
            }
        }
        return -1;
    }
    static checkWin(board, row, col, winStreak = 4) {
        const player = board[row][col];
        if (player === game_1.CellValue.EMPTY)
            return null;
        const horizontal = this.getWinningCells(board, row, col, 0, 1, player, winStreak);
        if (horizontal)
            return { winReason: game_1.WinReason.HORIZONTAL, winningCells: horizontal };
        const vertical = this.getWinningCells(board, row, col, 1, 0, player, winStreak);
        if (vertical)
            return { winReason: game_1.WinReason.VERTICAL, winningCells: vertical };
        const diag1 = this.getWinningCells(board, row, col, -1, 1, player, winStreak);
        if (diag1)
            return { winReason: game_1.WinReason.DIAGONAL, winningCells: diag1 };
        const diag2 = this.getWinningCells(board, row, col, 1, 1, player, winStreak);
        if (diag2)
            return { winReason: game_1.WinReason.DIAGONAL, winningCells: diag2 };
        return null;
    }
    static getWinningCells(board, row, col, rowDir, colDir, player, winStreak = 4) {
        const { rows, cols } = this.dims(board);
        const cells = [{ row, col }];
        let r = row + rowDir;
        let c = col + colDir;
        while (r >= 0 && r < rows && c >= 0 && c < cols && board[r][c] === player) {
            cells.push({ row: r, col: c });
            r += rowDir;
            c += colDir;
        }
        r = row - rowDir;
        c = col - colDir;
        while (r >= 0 && r < rows && c >= 0 && c < cols && board[r][c] === player) {
            cells.push({ row: r, col: c });
            r -= rowDir;
            c -= colDir;
        }
        if (cells.length >= winStreak) {
            console.log(`🏆 Winning cells: ${cells.length} in direction (${rowDir},${colDir})`);
            return cells;
        }
        return null;
    }
    static isBoardFull(board) {
        return board[0].every((cell) => cell !== game_1.CellValue.EMPTY);
    }
    static isColumnFull(board, column) {
        return board[0][column] !== game_1.CellValue.EMPTY;
    }
    static getValidMoves(board) {
        const { cols } = this.dims(board);
        const validMoves = [];
        for (let col = 0; col < cols; col++) {
            if (!this.isColumnFull(board, col)) {
                validMoves.push(col);
            }
        }
        return validMoves;
    }
    static makeMove(board, column, player, winStreak = 4) {
        const { cols } = this.dims(board);
        if (column < 0 || column >= cols) {
            return { success: false, error: 'Invalid column' };
        }
        if (this.isColumnFull(board, column)) {
            return { success: false, error: 'Column is full' };
        }
        const row = this.dropDisc(board, column, player);
        if (row === -1) {
            return { success: false, error: 'Failed to drop disc' };
        }
        const winResult = this.checkWin(board, row, column, winStreak);
        if (winResult) {
            return {
                success: true,
                row,
                winReason: winResult.winReason,
                winningCells: winResult.winningCells,
                winningPlayer: player,
            };
        }
        if (this.isBoardFull(board)) {
            return {
                success: true,
                row,
                isDraw: true,
                winReason: game_1.WinReason.DRAW,
            };
        }
        return { success: true, row };
    }
    /** Pack non-empty cells to the bottom of the column (gravity after player removal). */
    static gravityColumn(board, col) {
        const { rows } = this.dims(board);
        const stack = [];
        for (let r = rows - 1; r >= 0; r--) {
            const v = board[r][col];
            if (v !== game_1.CellValue.EMPTY)
                stack.push(v);
        }
        let i = 0;
        for (let r = rows - 1; r >= 0; r--) {
            board[r][col] = i < stack.length ? stack[i++] : game_1.CellValue.EMPTY;
        }
    }
    /**
     * Remove one seat from the board: clear that color, renumber higher player colors down by one, then gravity.
     */
    static remapBoardRemovePlayer(board, removedSlotIndex) {
        const { rows, cols } = this.dims(board);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const v = board[r][c];
                if (v === game_1.CellValue.EMPTY)
                    continue;
                const oldSlot = (0, game_1.cellValueToSlotIndex)(v);
                if (oldSlot === removedSlotIndex) {
                    board[r][c] = game_1.CellValue.EMPTY;
                }
                else {
                    const newSlot = oldSlot > removedSlotIndex ? oldSlot - 1 : oldSlot;
                    board[r][c] = (0, game_1.slotIndexToCellValue)(newSlot);
                }
            }
        }
        for (let c = 0; c < cols; c++) {
            this.gravityColumn(board, c);
        }
    }
    static cloneBoard(board) {
        return board.map((row) => [...row]);
    }
}
exports.GameLogic = GameLogic;
