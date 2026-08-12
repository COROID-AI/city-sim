import {
  createInitialState,
  setDirection,
  tick,
  DEFAULT_CONFIG,
} from './game';
import type { Direction, GameState } from './game';
import { CanvasRenderer } from './ui/renderer';
import { attachKeyboardInput } from './ui/input';

/** Size of a single grid cell in CSS pixels. */
const CELL_SIZE = 30;

/**
 * Boots the game once the DOM is ready: reads the #game canvas, creates the
 * initial state, renders it, and wires up input plus a setInterval game loop.
 */
function boot(): void {
  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element #game not found');
  }

  const renderer = new CanvasRenderer(canvas, CELL_SIZE);
  let state: GameState = createInitialState(DEFAULT_CONFIG);

  // Show the empty board immediately, before any key has been pressed.
  renderer.draw(state);

  let started = false;
  const startLoop = (): void => {
    if (started) {
      return;
    }
    started = true;
    // The game tick lives in a setInterval at config.tickMs. Rendering is a
    // side effect of the same loop; requestAnimationFrame is not used to
    // advance the tick.
    setInterval(() => {
      if (state.status === 'running') {
        state = tick(state);
      }
      renderer.draw(state);
    }, DEFAULT_CONFIG.tickMs);
  };

  const handleRestart = (): void => {
    state = createInitialState(DEFAULT_CONFIG);
    renderer.draw(state);
  };

  const handleDirection = (direction: Direction): void => {
    // A directional keypress starts a fresh game from the idle state.
    if (state.status === 'idle') {
      state = { ...state, status: 'running' };
    }
    state = setDirection(state, direction);
    startLoop();
  };

  const handleTogglePause = (): void => {
    if (state.status === 'gameover') {
      handleRestart();
      return;
    }
    if (state.status === 'idle' || state.status === 'paused') {
      state = { ...state, status: 'running' };
    } else if (state.status === 'running') {
      state = { ...state, status: 'paused' };
    }
    startLoop();
  };

  attachKeyboardInput({
    onDirection: handleDirection,
    onTogglePause: handleTogglePause,
    onRestart: handleRestart,
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', boot);
}
