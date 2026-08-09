/**
 * Keyboard input mapping.
 *
 * The game is controlled with the arrow keys only (per the product
 * requirement): ArrowUp rotates clockwise, ArrowLeft/ArrowRight move the
 * piece, and ArrowDown soft-drops. Every other key maps to `null` and is
 * ignored by the loop.
 *
 * Note: rotation is intentionally clockwise-only on ArrowUp (dir: 1). The
 * rules support `dir: -1`, but adding a secondary rotate would require a
 * non-arrow key or a second arrow action, which would break the arrow-key
 * only constraint, so it is left unmapped.
 */
import type { GameAction } from '../game/types';

const KEY_ACTIONS: Record<string, GameAction> = {
  ArrowLeft: { type: 'move', dir: 'left' },
  ArrowRight: { type: 'move', dir: 'right' },
  ArrowDown: { type: 'softDrop' },
  ArrowUp: { type: 'rotate', dir: 1 },
};

/**
 * Maps a KeyboardEvent key string to a `GameAction`, or `null` when the key
 * is not an arrow key. Returns a fresh action object on every call.
 */
export function mapKeyToAction(key: string): GameAction | null {
  const action = KEY_ACTIONS[key];
  if (action === undefined) return null;

  switch (action.type) {
    case 'move':
      return { type: 'move', dir: action.dir };
    case 'rotate':
      return { type: 'rotate', dir: action.dir };
    default:
      return { type: action.type };
  }
}