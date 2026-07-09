/**
 * Arrow-key to action mapping for Tetris.
 *
 * This module is the **single place** where the "only arrow keys" player-input
 * constraint is enforced. It maps the four arrow keys to game actions and maps
 * *every other key* to `null`. There are no WASD bindings, no space-as-hard-drop,
 * and no touch handlers — by design.
 */

import { Action, Direction } from '../game/types';

/**
 * Map a keyboard `KeyboardEvent` to a game {@link Action}.
 *
 * Mapping:
 *   - `ArrowLeft`  → `{ type: 'move', dir: Direction.Left }`
 *   - `ArrowRight` → `{ type: 'move', dir: Direction.Right }`
 *   - `ArrowDown`  → `{ type: 'softDrop' }`
 *   - `ArrowUp`    → `{ type: 'rotate', dir: 'cw' }`
 *   - *anything else* → `null`
 *
 * The function inspects `event.key` (not `keyCode`, which is deprecated), so it
 * works regardless of physical layout as long as the OS reports the standard
 * `Arrow*` key names.
 *
 * @param event  The DOM keyboard event.
 * @returns      The corresponding action, or `null` for non-arrow keys.
 */
export function keyToAction(event: KeyboardEvent): Action | null {
  switch (event.key) {
    case 'ArrowLeft':
      return { type: 'move', dir: Direction.Left };
    case 'ArrowRight':
      return { type: 'move', dir: Direction.Right };
    case 'ArrowDown':
      return { type: 'softDrop' };
    case 'ArrowUp':
      return { type: 'rotate', dir: 'cw' };
    default:
      return null;
  }
}
