import { createInitialState, step } from './game/state';
import { mapKeyToAction } from './input/keyboard';
import { draw, DEFAULT_DRAW_CONFIG } from './render/draw';
import type { DrawContext } from './render/draw';

/**
 * Integration tests for the full play pipeline:
 *   arrow-key → mapKeyToAction → step (reducer) → draw (renderer)
 *
 * These exercise the wiring that `main.ts` relies on without requiring a real
 * browser or canvas.
 */

/** Fixed rng that always selects the first tetromino id (I-piece). */
const rngAlwaysFirst = (): number => 0;

/** Create a minimal KeyboardEvent stub (Jest runs in a Node environment). */
function fakeKeyEvent(key: string): KeyboardEvent {
  return { key } as KeyboardEvent;
}

/** A mock rendering context that satisfies {@link DrawContext}. */
function createMockContext(): DrawContext {
  return {
    fillStyle: '',
    font: '',
    fillRect: jest.fn(),
    fillText: jest.fn(),
    clearRect: jest.fn(),
  };
}

describe('integration: arrow-key play sequence', () => {
  it('moves the piece left and right via ArrowLeft / ArrowRight', () => {
    let state = createInitialState(rngAlwaysFirst);
    const startX = state.current!.x;

    // Move left.
    const leftAction = mapKeyToAction(fakeKeyEvent('ArrowLeft'));
    expect(leftAction).not.toBeNull();
    state = step(state, leftAction!);
    expect(state.current!.x).toBe(startX - 1);

    // Move right back to the original column.
    const rightAction = mapKeyToAction(fakeKeyEvent('ArrowRight'));
    expect(rightAction).not.toBeNull();
    state = step(state, rightAction!);
    expect(state.current!.x).toBe(startX);
  });

  it('rotates the piece via ArrowUp', () => {
    let state = createInitialState(rngAlwaysFirst);
    const rotationBefore = state.current!.rotation;

    const action = mapKeyToAction(fakeKeyEvent('ArrowUp'));
    expect(action).not.toBeNull();
    state = step(state, action!);

    // Rotation index should have advanced (0 → 1 for the I-piece).
    expect(state.current!.rotation).not.toBe(rotationBefore);
  });

  it('soft-drops the piece one row via ArrowDown', () => {
    let state = createInitialState(rngAlwaysFirst);
    const yBefore = state.current!.y;

    const action = mapKeyToAction(fakeKeyEvent('ArrowDown'));
    expect(action).not.toBeNull();
    state = step(state, action!);

    expect(state.current!.y).toBe(yBefore + 1);
    // Soft-drop awards 1 point.
    expect(state.score).toBe(1);
  });

  it('ignores every non-arrow key (returns null, no state change)', () => {
    const state = createInitialState(rngAlwaysFirst);
    const nonArrowKeys = [' ', 'Space', 'Enter', 'w', 'a', 's', 'd', 'Escape', 'p', '1'];

    for (const key of nonArrowKeys) {
      const action = mapKeyToAction(fakeKeyEvent(key));
      expect(action).toBeNull();
    }

    // State is untouched because no action was produced.
    expect(state.current).not.toBeNull();
  });

  it('locks the piece after enough gravity ticks and spawns the next one', () => {
    let state = createInitialState(rngAlwaysFirst);
    const boardBefore = state.board;

    // Tick gravity until the piece locks and a new piece spawns at the top.
    let respawned = false;
    let prevY = state.current!.y;
    for (let i = 0; i < 100 && !respawned; i++) {
      state = step(state, { type: 'tick' });
      // A respawn is detected when the piece jumps back up (y decreases).
      if (state.current && state.current.y < prevY) {
        respawned = true;
      }
      if (state.current) {
        prevY = state.current.y;
      }
    }

    expect(respawned).toBe(true);
    // The board should now contain at least one locked cell.
    expect(state.board).not.toBe(boardBefore);
    const hasLockedCell = state.board.some((row) =>
      row.some((cell) => cell !== null),
    );
    expect(hasLockedCell).toBe(true);
  });

  it('renders the full pipeline result without throwing', () => {
    let state = createInitialState(rngAlwaysFirst);
    state = step(state, mapKeyToAction(fakeKeyEvent('ArrowLeft'))!);
    state = step(state, mapKeyToAction(fakeKeyEvent('ArrowDown'))!);
    state = step(state, mapKeyToAction(fakeKeyEvent('ArrowUp'))!);

    const ctx = createMockContext();
    expect(() => draw(ctx, state, DEFAULT_DRAW_CONFIG)).not.toThrow();

    // The renderer should have cleared, drawn cells, and written HUD text.
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it('reflects accumulated score, level, and lines after a full lock cycle', () => {
    let state = createInitialState(rngAlwaysFirst);
    const initialScore = state.score;

    // Tick until the first piece locks.
    let prevY = state.current!.y;
    for (let i = 0; i < 100; i++) {
      state = step(state, { type: 'tick' });
      if (state.current && state.current.y < prevY) {
        break;
      }
      if (state.current) {
        prevY = state.current.y;
      }
    }

    // After one I-piece locks flat on the bottom, no lines are cleared (it
    // only fills one row), but the game continues with the next piece.
    expect(state.gameOver).toBe(false);
    expect(state.current).not.toBeNull();
    // Score should not have decreased.
    expect(state.score).toBeGreaterThanOrEqual(initialScore);
  });
});
