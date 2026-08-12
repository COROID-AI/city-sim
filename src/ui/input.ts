import type { Direction } from '../game';

/** Callbacks invoked by the keyboard controller. */
export interface InputCallbacks {
  onDirection: (direction: Direction) => void;
  onTogglePause: () => void;
  onRestart: () => void;
}

/** Maps Arrow keys and WASD to a Direction. */
const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  W: 'up',
  s: 'down',
  S: 'down',
  a: 'left',
  A: 'left',
  d: 'right',
  D: 'right',
};

/**
 * Attaches global keyboard listeners for snake controls.
 *
 * - Arrow keys + WASD map to a Direction.
 * - Space toggles pause / starts the game; the host decides whether to
 *   restart based on the current game state.
 * - Arrow keys (and Space) have their default behaviour suppressed so the
 *   page does not scroll while playing.
 *
 * Returns a cleanup function that removes the listeners.
 */
export function attachKeyboardInput(callbacks: InputCallbacks): () => void {
  const handleKeyDown = (event: KeyboardEvent): void => {
    const { key } = event;

    if (key === ' ') {
      event.preventDefault();
      callbacks.onTogglePause();
      return;
    }

    const direction = KEY_TO_DIRECTION[key];
    if (direction) {
      event.preventDefault();
      callbacks.onDirection(direction);
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}
