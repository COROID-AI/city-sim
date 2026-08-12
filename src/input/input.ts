import type { Direction } from '../game/types'

/**
 * Options for {@link attachInput}.
 */
export interface InputOptions {
  /** Called once for every directional key press with the raw direction. */
  onDirection: (direction: Direction) => void
  /** Called when a restart key (Space / Enter / R) is pressed. */
  onRestart?: () => void
}

/**
 * Maps physical key names to {@link Direction} values. Both the arrow keys and
 * WASD are supported, including the shifted (uppercase) WASD spellings.
 */
const KEY_TO_DIRECTION: Readonly<Record<string, Direction>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  W: 'up',
  S: 'down',
  A: 'left',
  D: 'right',
}

/** Keys that trigger the optional restart callback. */
const RESTART_KEYS: ReadonlySet<string> = new Set([' ', 'Enter', 'r', 'R'])

/**
 * Attaches keyboard listeners to `target` and translates key presses into
 * game commands.
 *
 * - Arrow keys and WASD map to `up` / `down` / `left` / `right` directions,
 *   forwarded through `options.onDirection`.
 * - Default browser scrolling for the arrow keys is prevented while the game
 *   element is focused (i.e. while key events reach `target`).
 * - Space / Enter / R trigger the optional `options.onRestart` callback.
 *
 * Reversal (180°) prevention is intentionally NOT enforced here: the handler
 * always emits the raw direction that was pressed. The engine applies the
 * reversal guard at the point where a direction is applied to the snake, so a
 * key press that would reverse directly into the snake's body is accepted here
 * and rejected there.
 *
 * Returns a detach function that removes the listeners so repeated calls do
 * not leave duplicate or dangling listeners behind.
 */
export function attachInput(
  target: HTMLElement,
  options: InputOptions,
): () => void {
  const { onDirection, onRestart } = options

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key in KEY_TO_DIRECTION) {
      // Directional key: suppress default scrolling / page behavior.
      event.preventDefault()
      onDirection(KEY_TO_DIRECTION[event.key])
      return
    }

    if (RESTART_KEYS.has(event.key)) {
      // Restart key: suppress default behavior and trigger the callback.
      event.preventDefault()
      onRestart?.()
    }
  }

  target.addEventListener('keydown', handleKeyDown)

  return function detach(): void {
    target.removeEventListener('keydown', handleKeyDown)
  }
}
