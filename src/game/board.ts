import { BOARD_COLS, BOARD_ROWS, FIRST_VISIBLE_ROW } from './constants';
import { pieceCells } from './tetrominoes';
import type { BoardGrid, Cell, CellType, Piece, TetrominoType } from './types';

export function createBoard(): BoardGrid {
  return Array.from({ length: BOARD_ROWS }, () => Array<CellType>(BOARD_COLS).fill(null));
}

export function cloneBoard(board: BoardGrid): BoardGrid {
  return board.map((row) => row.slice());
}

/** True when any cell is off the board or overlaps a locked cell. */
export function collides(board: BoardGrid, cells: Cell[]): boolean {
  for (const { row, col } of cells) {
    if (row < 0 || row >= BOARD_ROWS || col < 0 || col >= BOARD_COLS) return true;
    if (board[row][col] !== null) return true;
  }
  return false;
}

/** Merge a piece's cells into a copy of the board. */
export function merge(board: BoardGrid, cells: Cell[], type: TetrominoType): BoardGrid {
  const next = cloneBoard(board);
  for (const { row, col } of cells) {
    if (row < 0 || row >= BOARD_ROWS || col < 0 || col >= BOARD_COLS) continue;
    next[row][col] = type;
  }
  return next;
}

export function canPlace(board: BoardGrid, piece: Piece): boolean {
  return !collides(board, pieceCells(piece));
}

/**
 * Remove full visible rows and shift the row stack down. Hidden rows are
 * never cleared and never shift. Returns the cleared-row indices and the
 * consolidated board.
 */
export function clearLines(board: BoardGrid): { board: BoardGrid; cleared: number[] } {
  const cleared: number[] = [];
  const kept: CellType[][] = [];
  for (let row = FIRST_VISIBLE_ROW; row < BOARD_ROWS; row++) {
    if (board[row].every((cell) => cell !== null)) {
      cleared.push(row);
    } else {
      kept.push(board[row]);
    }
  }

  const next = createBoard();
  for (let row = 0; row < FIRST_VISIBLE_ROW; row++) {
    next[row] = board[row].slice();
  }
  const slack = BOARD_ROWS - FIRST_VISIBLE_ROW - kept.length;
  for (let i = 0; i < kept.length; i++) {
    next[FIRST_VISIBLE_ROW + slack + i] = kept[i];
  }

  return { board: next, cleared };
}

/** Lowest valid placement of the piece (same shape, no kicks applied). */
export function ghostPiece(board: BoardGrid, piece: Piece): Piece {
  let y = piece.y;
  while (
    !collides(board, pieceCells({ ...piece, y: y + 1 }))
  ) {
    y++;
  }
  return { ...piece, y };
}