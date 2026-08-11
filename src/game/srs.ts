import { collides } from './board';
import { pieceCells } from './tetrominoes';
import type { Piece, RotateDirection, RotationState, TetrominoType } from './types';

export type Kick = readonly [dx: number, dyUp: number];
type TransitionKey =
  | '0->1'
  | '1->0'
  | '1->2'
  | '2->1'
  | '2->3'
  | '3->2'
  | '3->0'
  | '0->3';

type KickTable = Record<TransitionKey, Kick[]>;

/** Key for the rotation transition `from -> to`. */
function transitionKey(from: RotationState, to: RotationState): TransitionKey {
  return `${from}->${to}` as TransitionKey;
}

export function nextRotationState(rot: RotationState, dir: RotateDirection): RotationState {
  return ((rot + (dir === 'cw' ? 1 : 3)) % 4) as RotationState;
}

/**
 * Published SRS wall-kick data for J, L, S, T, Z. Kicks are stored in the
 * Guideline's y-up coordinate frame (`+y` = up, `-y` = down); `tryRotate`
 * negates the y component when applying to our row-space board.
 */
const JLSTZ_KICKS: KickTable = {
  '0->1': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '1->0': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  '1->2': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  '2->1': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '2->3': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
  '3->2': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '3->0': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '0->3': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
};

/** The I tetromino uses its own dedicated kick table. */
const I_KICKS: KickTable = {
  '0->1': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  '1->0': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  '1->2': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
  '2->1': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  '2->3': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  '3->2': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  '3->0': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  '0->3': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
};

/** The O tetromino rotates in place; it never clips, so only (0,0) exists. */
const O_KICKS: KickTable = {
  '0->1': [[0, 0]],
  '1->0': [[0, 0]],
  '1->2': [[0, 0]],
  '2->1': [[0, 0]],
  '2->3': [[0, 0]],
  '3->2': [[0, 0]],
  '3->0': [[0, 0]],
  '0->3': [[0, 0]],
};

const KICKS: Record<TetrominoType, KickTable> = {
  I: I_KICKS,
  O: O_KICKS,
  T: JLSTZ_KICKS,
  S: JLSTZ_KICKS,
  Z: JLSTZ_KICKS,
  J: JLSTZ_KICKS,
  L: JLSTZ_KICKS,
};

export function getKickTests(
  type: TetrominoType,
  from: RotationState,
  to: RotationState,
): Kick[] {
  return KICKS[type][transitionKey(from, to)];
}

/**
 * Attempt an SRS rotation of `piece`. Applies every kick test in order and
 * returns the first collision-free placement, or null if none fits (in which
 * case the piece remains unchanged — a rotation never clips or pushes the
 * piece out of bounds).
 */
export function tryRotate(
  board: ReturnType<typeof import('./board').createBoard>,
  piece: Piece,
  dir: RotateDirection,
): Piece | null {
  const to = nextRotationState(piece.rotation, dir);
  for (const [dx, dyUp] of getKickTests(piece.type, piece.rotation, to)) {
    const candidate: Piece = {
      type: piece.type,
      rotation: to,
      x: piece.x + dx,
      y: piece.y - dyUp,
    };
    if (!collides(board, pieceCells(candidate))) return candidate;
  }
  return null;
}