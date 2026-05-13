import { Socket } from 'socket.io';
import { v4 as uuid } from 'uuid';

export const BINGO_PLAYER_COLORS = [
  '#f87171', '#60a5fa', '#4ade80', '#fbbf24',
  '#a78bfa', '#f472b6', '#34d399', '#fb923c',
] as const;

export interface BingoPlayer {
  username: string;
  card: (number | null)[][];  // null = empty (not filled yet)
  markedCells: boolean[][];
  colorIndex: number;
  bingoLines: number;         // count of completed lines
  rank: number | null;
  isBot: boolean;
}

export interface BingoGameState {
  id: string;
  players: BingoPlayer[];
  gridRows: number;
  gridCols: number;
  calledNumbers: number[];
  currentCall: number | null;
  currentCallerIndex: number; // whose turn it is to call
  status: 'filling' | 'playing' | 'completed';
  winner: string | null;
  rankings: { username: string; rank: number }[];
  startedAt: Date;
  endedAt?: Date;
  isBot: boolean;
  botUsername?: string;
  numberPool: number[];       // remaining numbers to be called
}

export interface BingoRoom {
  code: string;
  hostUsername: string;
  members: Map<string, Socket>;
  maxPlayers: number;
  gridRows: number;
  gridCols: number;
  status: 'lobby' | 'filling' | 'playing' | 'ended';
  gameId?: string;
  partyId?: string;
  gameState?: BingoGameState;
}

export function generateBingoRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export { uuid };

/** Returns indices of completed lines in a grid.
 *  Each line is an array of [r,c,r,c,...] pairs.
 *  Lines = all rows + all cols + both diagonals (diags only for square grids).
 */
export function checkBingoLines(marked: boolean[][], rows: number, cols: number): number[][] {
  const lines: number[][] = [];

  // Rows
  for (let r = 0; r < rows; r++) {
    if (marked[r]!.slice(0, cols).every(Boolean)) {
      const line: number[] = [];
      for (let c = 0; c < cols; c++) line.push(r, c);
      lines.push(line);
    }
  }
  // Cols
  for (let c = 0; c < cols; c++) {
    if (Array.from({ length: rows }, (_, r) => marked[r]![c]).every(Boolean)) {
      const line: number[] = [];
      for (let r = 0; r < rows; r++) line.push(r, c);
      lines.push(line);
    }
  }
  // Diagonals — only for square grids
  if (rows === cols) {
    if (Array.from({ length: rows }, (_, i) => marked[i]![i]).every(Boolean)) {
      const line: number[] = [];
      for (let i = 0; i < rows; i++) line.push(i, i);
      lines.push(line);
    }
    if (Array.from({ length: rows }, (_, i) => marked[i]![rows - 1 - i]).every(Boolean)) {
      const line: number[] = [];
      for (let i = 0; i < rows; i++) line.push(i, rows - 1 - i);
      lines.push(line);
    }
  }

  return lines;
}

export function shufflePool(min: number, max: number): number[] {
  const pool: number[] = [];
  for (let i = min; i <= max; i++) pool.push(i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool;
}

/** Generate a random bot card filling numbers 1..rows*cols */
export function generateBotCard(rows: number, cols: number): number[][] {
  const total = rows * cols;
  const nums = shufflePool(1, total);
  const card: number[][] = [];
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    card[r] = [];
    for (let c = 0; c < cols; c++) {
      card[r]![c] = nums[idx++]!;
    }
  }
  return card;
}
