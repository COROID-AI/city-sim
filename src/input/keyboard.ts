/**
 * Keyboard input handler for Tetris.
 *
 * `installKeyboard` attaches a `keydown` listener that translates the four
 * arrow keys and Space into `Action` objects pushed onto a caller-owned queue.
 * Only those five keys produce actions; everything else is ignored. The handler
 * calls `preventDefault` on the game keys so the page does not scroll.
 *
 * Returns an `unsubscribe` function that detaches the listener for clean-up.
 */

import type { Action } from "../game/state.js";

/** The set of keys that drive the game. */
const GAME_KEYS: ReadonlySet<string> = new Set([
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "ArrowDown",
  " ",
]);

/** Maps a physical key value to the action it should produce, if any. */
function mapKey(key: string): Action | null {
  switch (key) {
    case "ArrowUp":
      return { type: "Rotate" };
    case "ArrowLeft":
      return { type: "MoveLeft" };
    case "ArrowRight":
      return { type: "MoveRight" };
    case "ArrowDown":
      return { type: "SoftDrop" };
    case " ":
      return { type: "HardDrop" };
    default:
      return null;
  }
}

/**
 * Installs a `keydown` listener on the given target.
 *
 * Game-key repeats are honoured naturally by the browser's auto-repeat, which
 * generates repeated `keydown` events while a key is held. Each valid keypress
 * pushes the corresponding `Action` onto `queue`.
 *
 * @param queue   The caller-owned array actions are pushed onto.
 * @param target  The event target (defaults to `window`).
 * @returns An `unsubscribe` function that removes the listener.
 */
export function installKeyboard(
  queue: Action[],
  target: Pick<EventTarget, "addEventListener" | "removeEventListener"> = window
): () => void {
  const onKeyDown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) {
      return;
    }
    const action = mapKey(event.key);
    if (action === null) {
      // Not a game key — leave the event untouched.
      return;
    }
    // Prevent page scroll for the arrow keys and Space.
    event.preventDefault();
    queue.push(action);
  };

  target.addEventListener("keydown", onKeyDown);

  return () => {
    target.removeEventListener("keydown", onKeyDown);
  };
}

/** Exported for testing: the set of keys treated as game keys. */
export { GAME_KEYS };
