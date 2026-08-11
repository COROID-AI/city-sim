/**
 * Core shared types for the game. Kept DOM-free so unit tests run in Node.
 */

export type TetrominoType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';

/**
 * SRS rotation states: 0 = spawn, 1 = clockwise ("R"), 2 = 180° ("2"),
 * 3 = counter-clockwise ("L").
 */
export type RotationState = 0 | 1 | 2 | 3;

export type CellType = TetrominoType | null;

/**
 * Board grid indexed [row][col]; row 0 is the top of the full board
 * (hidden rows included).
 */
export type BoardGrid = CellType[][];

export interface Cell {
  row: number;
  col: number;
}

export interface Piece {
  type: TetrominoType;
  rotation: RotationState;
  /** Left column of the piece's bounding box. */
  x: number;
  /** Top row of the piece's bounding box (row 0 = top of the full board). */
  y: number;
}

export type RotateDirection = 'cw' | 'ccw';

export type GameStatus = 'idle' | 'playing' | 'paused' | 'over';

export type ActionName =
  | 'moveLeft'
  | 'moveRight'
  | 'softDrop'
  | 'hardDrop'
  | 'rotateCW'
  | 'rotateCCW'
  | 'hold'
  | 'pauseToggle'
  | 'start';