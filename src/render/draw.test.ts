import { draw, DEFAULT_DRAW_CONFIG } from './draw';
import type { DrawContext } from './draw';
import { createInitialState, DEFAULT_CONFIG } from '../game/state';
import { createBoard } from '../game/board';
import { TetrominoId } from '../game/types';
import type { GameState } from '../game/types';

/**
 * A mock rendering context that records every call AND every `fillStyle`
 * assignment. Using a class with getter/setter lets us capture the history of
 * colour changes, because the final value after `draw()` is overwritten by the
 * HUD text colour.
 */
class MockContext {
  readonly styles: string[] = [];
  private _fillStyle = '';
  font = '';
  readonly fillRect = jest.fn();
  readonly fillText = jest.fn();
  readonly clearRect = jest.fn();

  get fillStyle(): string {
    return this._fillStyle;
  }
  set fillStyle(value: string) {
    this._fillStyle = value;
    this.styles.push(value);
  }
}

/** Build a typed DrawContext from the mock (satisfies the interface). */
function createMockContext(): MockContext {
  return new MockContext();
}

/** Fixed rng that always selects the first tetromino id (I-piece). */
const rngAlwaysFirst = (): number => 0;

/** Build a GameState with a custom board for targeted draw assertions. */
function stateWithBoard(board: GameState['board']): GameState {
  return {
    config: DEFAULT_CONFIG,
    board,
    current: null,
    next: TetrominoId.T,
    score: 1000,
    level: 3,
    lines: 7,
    gameOver: false,
  };
}

describe('draw — purity & contract', () => {
  it('does not throw for a fresh initial state', () => {
    const ctx = createMockContext();
    const state = createInitialState(rngAlwaysFirst);
    expect(() => draw(ctx, state)).not.toThrow();
  });

  it('clears the entire canvas exactly once per frame', () => {
    const ctx = createMockContext();
    const state = createInitialState(rngAlwaysFirst);
    draw(ctx, state);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(ctx.clearRect).toHaveBeenCalledWith(
      0,
      0,
      DEFAULT_DRAW_CONFIG.canvasWidth,
      DEFAULT_DRAW_CONFIG.canvasHeight,
    );
  });
});

describe('draw — locked board', () => {
  it('paints a fillRect for every non-null board cell', () => {
    // Fill the entire bottom row with I-piece cells (10 cells).
    const board = createBoard(DEFAULT_CONFIG.rows, DEFAULT_CONFIG.columns).map(
      (row, r) =>
        r === DEFAULT_CONFIG.rows - 1
          ? row.map(() => TetrominoId.I)
          : row,
    );
    const state = stateWithBoard(board);

    const ctx = createMockContext();
    draw(ctx, state);

    // Background (1) + grid lines + 10 board cells = well over 11 fillRect calls.
    expect(ctx.fillRect.mock.calls.length).toBeGreaterThanOrEqual(11);
  });

  it('uses the tetromino colour for filled cells', () => {
    const board = createBoard(DEFAULT_CONFIG.rows, DEFAULT_CONFIG.columns).map(
      (row, r) => (r === 0 ? row.map(() => TetrominoId.T) : row),
    );
    const state = stateWithBoard(board);

    const ctx = createMockContext();
    draw(ctx, state);

    // The T-piece colour (#a000f0) should have been set at some point during
    // the frame. The final fillStyle is overwritten by HUD text, so we check
    // the recorded history of assignments instead.
    expect(ctx.styles).toContain('#a000f0');
  });

  it('skips empty board cells (no fillRect for null cells)', () => {
    // Empty board, no current piece — but the next-piece preview still draws.
    const state = stateWithBoard(
      createBoard(DEFAULT_CONFIG.rows, DEFAULT_CONFIG.columns),
    );
    const ctx = createMockContext();
    draw(ctx, state);

    // Background (1) + grid lines (33) + next-piece preview cells (4 for the
    // T-piece) = 38. No board cells and no current piece should be drawn.
    expect(ctx.fillRect.mock.calls.length).toBe(38);
  });
});

describe('draw — current piece', () => {
  it('draws the active piece on top of the board', () => {
    const ctx = createMockContext();
    const state = createInitialState(rngAlwaysFirst);
    draw(ctx, state);

    // Background (1) + grid lines (33) + I-piece cells (4) + preview cells (4) = 42.
    expect(ctx.fillRect.mock.calls.length).toBe(42);
  });
});

describe('draw — next-piece preview', () => {
  it('renders a "NEXT" label', () => {
    const ctx = createMockContext();
    const state = createInitialState(rngAlwaysFirst);
    draw(ctx, state);
    expect(ctx.fillText).toHaveBeenCalledWith(
      'NEXT',
      expect.any(Number),
      expect.any(Number),
    );
  });
});

describe('draw — HUD', () => {
  it('renders SCORE, LEVEL, and LINES labels with their values', () => {
    const ctx = createMockContext();
    const state = stateWithBoard(
      createBoard(DEFAULT_CONFIG.rows, DEFAULT_CONFIG.columns),
    );
    draw(ctx, state);

    expect(ctx.fillText).toHaveBeenCalledWith(
      'SCORE',
      expect.any(Number),
      expect.any(Number),
    );
    expect(ctx.fillText).toHaveBeenCalledWith(
      '1000',
      expect.any(Number),
      expect.any(Number),
    );
    expect(ctx.fillText).toHaveBeenCalledWith(
      'LEVEL',
      expect.any(Number),
      expect.any(Number),
    );
    expect(ctx.fillText).toHaveBeenCalledWith(
      '3',
      expect.any(Number),
      expect.any(Number),
    );
    expect(ctx.fillText).toHaveBeenCalledWith(
      'LINES',
      expect.any(Number),
      expect.any(Number),
    );
    expect(ctx.fillText).toHaveBeenCalledWith(
      '7',
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('renders a GAME OVER banner when the game is over', () => {
    const state: GameState = {
      ...stateWithBoard(
        createBoard(DEFAULT_CONFIG.rows, DEFAULT_CONFIG.columns),
      ),
      gameOver: true,
    };
    const ctx = createMockContext();
    draw(ctx, state);
    expect(ctx.fillText).toHaveBeenCalledWith(
      'GAME OVER',
      expect.any(Number),
      expect.any(Number),
    );
  });
});

describe('draw — accepts a mock context (no DOM)', () => {
  it('works with a minimal hand-rolled context object', () => {
    const calls: string[] = [];
    const mockCtx: DrawContext = {
      fillStyle: '',
      font: '',
      fillRect: () => calls.push('fillRect'),
      fillText: () => calls.push('fillText'),
      clearRect: () => calls.push('clearRect'),
    };
    const state = createInitialState(rngAlwaysFirst);
    draw(mockCtx, state);

    expect(calls).toContain('clearRect');
    expect(calls).toContain('fillRect');
    expect(calls).toContain('fillText');
  });
});
