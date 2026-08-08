import type { GameAction } from '../game/types';

/**
 * Map a `KeyboardEvent.key` value to a game action.
 *
 * The piece is driven entirely by the arrow keys:
 * - ArrowLeft  -> move left
 * - ArrowRight -> move right
 * - ArrowDown  -> soft drop
 * - ArrowUp    -> rotate clockwise
 *
 * A counter-clockwise rotation (`dir: -1`) is supported by the action
 * system but intentionally not bound to a key, keeping every binding
 * arrow-key driven; any other key maps to null.
 */
export function mapKeyToAction(key: string): GameAction | null {
  switch (key) {
    case 'ArrowLeft':
      return { type: 'move', dir: 'left' };
    case 'ArrowRight':
      return { type: 'move', dir: 'right' };
    case 'ArrowDown':
      return { type: 'softDrop' };
    case 'ArrowUp':
      return { type: 'rotate', dir: 1 };
    default:
      return null;
  }
}
