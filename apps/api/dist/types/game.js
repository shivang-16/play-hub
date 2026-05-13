"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WinReason = exports.GameStatus = exports.MAX_PLAYERS_PER_GAME = exports.CellValue = exports.COLS = exports.ROWS = void 0;
exports.boardSizeForPlayerCount = boardSizeForPlayerCount;
exports.winStreakForPlayerCount = winStreakForPlayerCount;
exports.slotIndexToCellValue = slotIndexToCellValue;
exports.cellValueToSlotIndex = cellValueToSlotIndex;
/** Default size for classic 2-player games */
exports.ROWS = 6;
exports.COLS = 7;
var CellValue;
(function (CellValue) {
    CellValue[CellValue["EMPTY"] = 0] = "EMPTY";
    CellValue[CellValue["PLAYER1"] = 1] = "PLAYER1";
    CellValue[CellValue["PLAYER2"] = 2] = "PLAYER2";
    CellValue[CellValue["PLAYER3"] = 3] = "PLAYER3";
    CellValue[CellValue["PLAYER4"] = 4] = "PLAYER4";
    CellValue[CellValue["PLAYER5"] = 5] = "PLAYER5";
    CellValue[CellValue["PLAYER6"] = 6] = "PLAYER6";
    CellValue[CellValue["PLAYER7"] = 7] = "PLAYER7";
    CellValue[CellValue["PLAYER8"] = 8] = "PLAYER8";
})(CellValue || (exports.CellValue = CellValue = {}));
/** Max human (or human+bot) slots for one game; matches CellValue.PLAYER1..PLAYER8 */
exports.MAX_PLAYERS_PER_GAME = 8;
/** Larger boards for 3+ players. Capped so UI stays reasonable. */
function boardSizeForPlayerCount(playerCount) {
    const n = Math.max(2, Math.min(exports.MAX_PLAYERS_PER_GAME, Math.floor(playerCount)));
    const rows = Math.min(16, 6 + Math.ceil((n - 2) * 2.5));
    const cols = Math.min(18, 7 + (n - 2) * 3);
    return { rows, cols };
}
/** How many in a row needed to win based on player count (3+ players need 6). */
function winStreakForPlayerCount(playerCount) {
    return playerCount >= 3 ? 6 : 4;
}
function slotIndexToCellValue(index) {
    const v = index + 1;
    if (v < 1 || v > exports.MAX_PLAYERS_PER_GAME) {
        throw new Error(`Invalid player slot ${index}`);
    }
    return v;
}
function cellValueToSlotIndex(cv) {
    return Number(cv) - 1;
}
var GameStatus;
(function (GameStatus) {
    GameStatus["WAITING"] = "waiting";
    GameStatus["IN_PROGRESS"] = "in_progress";
    GameStatus["COMPLETED"] = "completed";
    GameStatus["FORFEITED"] = "forfeited";
})(GameStatus || (exports.GameStatus = GameStatus = {}));
var WinReason;
(function (WinReason) {
    WinReason["HORIZONTAL"] = "horizontal";
    WinReason["VERTICAL"] = "vertical";
    WinReason["DIAGONAL"] = "diagonal";
    WinReason["DRAW"] = "draw";
    WinReason["FORFEIT"] = "forfeit";
    WinReason["OPPONENT_DISCONNECT"] = "opponent_disconnect";
})(WinReason || (exports.WinReason = WinReason = {}));
