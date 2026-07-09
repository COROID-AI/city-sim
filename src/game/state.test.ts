import { TetrominoId, Direction } from './types';
import type { GameState } from './types';
import { createBoard } from './board';
import {
  createInitialState,
  DEFAULT_CONFIG,
  spawnPiece,
  step,
} from './state';

/**
 * A fixed-sequence rng that always returns 0, so `randomId` selects the first
 * tetromino id (I). Handy for deterministic setup.
 */
const rngAlwaysFirst = (): number => 0;

/** A cyclic rng over a fixed list of values in [0, 1). */
function cyclicRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i += 1;
    return v;
  };
}

/** Shorthand for a move action. */
function move(dir: Direction) {
  return { type: 'move' as const, dir };
}

describe('createInitialState', () => {
  it('creates a state with an empty board and an active piece', () => {
    const state = createInitialState(rngAlwaysFirst);
    expect(state.board).toHaveLength(DEFAULT_CONFIG.rows);
    expect(state.board[0]).toHaveLength(DEFAULT_CONFIG.columns);
    expect(state.current).not.toBeNull();
    expect(state.score).toBe(0);
    expect(state.level).toBe(1);
    expect(state.lines).toBe(0);
    expect(state.gameOver).toBe(false);
  });

  it('spawns the first piece at the configured anchor', () => {
    const state = createInitialState(rngAlwaysFirst);
    expect(state.current!.x).toBe(DEFAULT_CONFIG.spawnColumn);
    expect(state.current!.y).toBe(DEFAULT_CONFIG.spawnRow);
    expect(state.current!.rotation).toBe(0);
  });

  it('pre-rolls the next piece for the preview', () => {
    const state = createInitialState(rngAlwaysFirst);
    // Both first and next were rolled with rngAlwaysFirst -> I.
    expect(state.current!.id).toBe(TetrominoId.I);
    expect(state.next).toBe(TetrominoId.I);
  });

  it('does not call module-level Math.random (deterministic with stub)', () => {
    const a = createInitialState(rngAlwaysFirst);
    const b = createInitialState(rngAlwaysFirst);
    expect(a).toEqual(b);
  });
});

describe('spawnPiece', () => {
  it('places the given piece at the spawn anchor', () => {
    const base = createInitialState(rngAlwaysFirst);
    const state = spawnPiece(base, TetrominoId.T);
    expect(state.current!.id).toBe(TetrominoId.T);
    expect(state.current!.x).toBe(DEFAULT_CONFIG.spawnColumn);
    expect(state.current!.y).toBe(DEFAULT_CONFIG.spawnRow);
  });

  it('ends the game when the spawn position is blocked', () => {
    // Fill the spawn region so a new piece cannot fit.
    const board = createBoard(DEFAULT_CONFIG.rows, DEFAULT_CONFIG.columns).map(
      (row, r) =>
        r < 2
          ? row.map(() => TetrominoId.I)
          : row.map(() => null),
    );
    const base: GameState = {
      config: DEFAULT_CONFIG,
      board,
      current: null,
      next: TetrominoId.I,
      score: 0,
      level: 1,
      lines: 0,
      gameOver: false,
    };
    const state = spawnPiece(base, TetrominoId.I);
    expect(state.gameOver).toBe(true);
  });
});

describe('step - move', () => {
  it('moves the piece left', () => {
    const state = createInitialState(rngAlwaysFirst);
    const next = step(state, move(Direction.Left));
    expect(next.current!.x).toBe(state.current!.x - 1);
  });

  it('moves the piece right', () => {
    const state = createInitialState(rngAlwaysFirst);
    const next = step(state, move(Direction.Right));
    expect(next.current!.x).toBe(state.current!.x + 1);
  });

  it('rejects moving into a wall', () => {
    const state = createInitialState(rngAlwaysFirst);
    // Walk the I-piece all the way to the left wall.
    let s = state;
    for (let i = 0; i < 20; i++) {
      s = step(s, move(Direction.Left));
    }
    const before = s.current!.x;
    const after = step(s, move(Direction.Left));
    expect(after.current!.x).toBe(before);
  });

  it('is immutable: returns a new state object', () => {
    const state = createInitialState(rngAlwaysFirst);
    const next = step(state, move(Direction.Right));
    expect(next).not.toBe(state);
    expect(state.current!.x).toBe(DEFAULT_CONFIG.spawnColumn);
  });
});

describe('step - rotate', () => {
  it('rotates the piece clockwise', () => {
    const state = createInitialState(rngAlwaysFirst);
    const next = step(state, { type: 'rotate', dir: 'cw' });
    expect(next.current!.rotation).toBe(1);
  });

  it('does not mutate the original state on rotate', () => {
    const state = createInitialState(rngAlwaysFirst);
    step(state, { type: 'rotate', dir: 'cw' });
    expect(state.current!.rotation).toBe(0);
  });
});

describe('step - softDrop', () => {
  it('drops the piece one row and scores 1 point', () => {
    const state = createInitialState(rngAlwaysFirst);
    const next = step(state, { type: 'softDrop' });
    expect(next.current!.y).toBe(state.current!.y + 1);
    expect(next.score).toBe(1);
  });

  it('locks the piece when it cannot drop further', () => {
    // Drop an O all the way to the floor, then softDrop once more to trigger lock.
    const state = createInitialState(cyclicRng([0.05])); // O-piece
    let s = state;
    for (let i = 0; i < 40; i++) {
      const before = s.current?.y;
      s = step(s, { type: 'softDrop' });
      if (s.current && before === s.current.y) {
        break; // locked
      }
    }
    // After a lock, a new piece spawns and the board has cells filled.
    expect(s.current).not.toBeNull();
    const flat = s.board.flat();
    expect(flat.some((c) => c !== null)).toBe(true);
  });
});

describe('step - hardDrop', () => {
  it('drops to the floor, scores 2 per cell, and locks', () => {
    const state = createInitialState(cyclicRng([0.05])); // O-piece
    const startY = state.current!.y;
    const next = step(state, { type: 'hardDrop' });
    // O-piece at spawnColumn=3; floor for a 2-tall piece is rows-2.
    const expectedY = DEFAULT_CONFIG.rows - 2;
    const cells = expectedY - startY;
    expect(next.current).not.toBeNull(); // a new piece spawned
    expect(next.score).toBe(cells * 2);
  });

  it('locks the piece into the board', () => {
    const state = createInitialState(cyclicRng([0.05])); // O-piece
    const next = step(state, { type: 'hardDrop' });
    const flat = next.board.flat();
    expect(flat.some((c) => c !== null)).toBe(true);
  });
});

describe('step - tick', () => {
  it('applies gravity (one row down, no score)', () => {
    const state = createInitialState(rngAlwaysFirst);
    const next = step(state, { type: 'tick' });
    expect(next.current!.y).toBe(state.current!.y + 1);
    expect(next.score).toBe(0);
  });

  it('locks the piece when gravity cannot lower it', () => {
    const state = createInitialState(cyclicRng([0.05])); // O-piece
    let s = state;
    // Tick until the piece locks (new piece appears).
    for (let i = 0; i < 40; i++) {
      const idBefore = s.current!.id;
      const yBefore = s.current!.y;
      s = step(s, { type: 'tick' });
      if (s.current!.id !== idBefore || s.current!.y !== yBefore + 1) {
        break; // locked + respawned
      }
    }
    const flat = s.board.flat();
    expect(flat.some((c) => c !== null)).toBe(true);
  });
});

/**
 * Build a board where the bottom row is full except for a single gap column,
 * so a horizontal I-piece placed across that row will complete the line.
 *
 * @param gapCol  The column to leave empty in the bottom row.
 */
function boardWithBottomGap(gapCol: number): GameState['board'] {
  const cols = DEFAULT_CONFIG.columns;
  const rows = DEFAULT_CONFIG.rows;
  let board = createBoard(rows, cols);
  for (let c = 0; c < cols; c++) {
    if (c !== gapCol) {
      board = board.map((row, r) =>
        r === rows - 1
          ? row.map((cell, ci) => (ci === c ? TetrominoId.O : cell))
          : row,
      );
    }
  }
  return board;
}

/**
 * Lock the I-piece (horizontal) so it sits on the bottom row, completing one
 * line, and return the resulting state. The piece is placed so its filled row
 * (matrix row 1 of the I shape) lands exactly on the bottom board row.
 */
function lockIHorizontalAtBottom(
  board: GameState['board'],
  startCol: number,
  level: number,
): GameState {
  const rows = DEFAULT_CONFIG.rows;
  // I shape row 1 is the filled row; to place it on the bottom row (rows-1),
  // anchor y must be rows-2 so y+1 == rows-1.
  const anchorY = rows - 2;
  const base: GameState = {
    config: DEFAULT_CONFIG,
    board,
    current: {
      id: TetrominoId.I,
      rotation: 0,
      x: startCol,
      y: anchorY,
    },
    next: TetrominoId.I,
    score: 0,
    level,
    lines: 0,
    gameOver: false,
  };
  // The piece is already on the floor (its filled row lands on the bottom
  // board row), so a tick will lock it and trigger the line clear.
  return step(base, { type: 'tick' });
}

describe('line-clear scoring', () => {
  it('scores 100 * level for a single-line clear', () => {
    // Leave a gap in column 0; the horizontal I fills columns 0..3.
    const board = boardWithBottomGap(0);
    const s = lockIHorizontalAtBottom(board, 0, 1);
    // one line cleared -> +100 (level 1)
    expect(s.lines).toBe(1);
    expect(s.score).toBe(100);
  });

  it('multiplies line scores by the current level', () => {
    // Same setup at level 3 -> 100 * 3 = 300.
    const board = boardWithBottomGap(0);
    const s = lockIHorizontalAtBottom(board, 0, 3);
    expect(s.lines).toBe(1);
    expect(s.score).toBe(300);
  });

  it('scores 200 * level for a double-line clear', () => {
    // Fill the bottom two rows except for the leftmost gap in each; the O-piece
    // (2x2) placed at column 0 completes both rows.
    const cols = DEFAULT_CONFIG.columns;
    const rows = DEFAULT_CONFIG.rows;
    let board = createBoard(rows, cols);
    for (let c = 1; c < cols; c++) {
      board = board.map((row, r) =>
        r >= rows - 2
          ? row.map((cell, ci) => (ci === c ? TetrominoId.O : cell))
          : row,
      );
    }
    const base: GameState = {
      config: DEFAULT_CONFIG,
      board,
      current: { id: TetrominoId.O, rotation: 0, x: 0, y: rows - 2 },
      next: TetrominoId.I,
      score: 0,
      level: 1,
      lines: 0,
      gameOver: false,
    };
    const s = step(base, { type: 'tick' });
    expect(s.lines).toBe(2);
    expect(s.score).toBe(200);
  });

  it('scores 300 * level for a triple-line clear', () => {
    const cols = DEFAULT_CONFIG.columns;
    const rows = DEFAULT_CONFIG.rows;
    // Vertical I (rotation 1) has its filled column at matrix col 2, so with
    // anchor x=0 the cells land on board col 2. Leave the gap at column 2.
    const board = createBoard(rows, cols).map((row, r) =>
      r >= rows - 3
        ? row.map((_, ci) => (ci === 2 ? null : TetrominoId.O))
        : row,
    );
    const base: GameState = {
      config: DEFAULT_CONFIG,
      board,
      current: { id: TetrominoId.I, rotation: 1, x: 0, y: rows - 4 },
      next: TetrominoId.I,
      score: 0,
      level: 1,
      lines: 0,
      gameOver: false,
    };
    const s = step(base, { type: 'tick' });
    expect(s.lines).toBe(3);
    expect(s.score).toBe(300);
  });

  it('scores 800 * level for a Tetris (4-line clear)', () => {
    const cols = DEFAULT_CONFIG.columns;
    const rows = DEFAULT_CONFIG.rows;
    // Vertical I (rotation 1) has its filled column at matrix col 2, so with
    // anchor x=0 the cells land on board col 2. Leave the gap at column 2.
    const board = createBoard(rows, cols).map((row, r) =>
      r >= rows - 4
        ? row.map((_, ci) => (ci === 2 ? null : TetrominoId.O))
        : row,
    );
    const base: GameState = {
      config: DEFAULT_CONFIG,
      board,
      current: { id: TetrominoId.I, rotation: 1, x: 0, y: rows - 4 },
      next: TetrominoId.I,
      score: 0,
      level: 1,
      lines: 0,
      gameOver: false,
    };
    const s = step(base, { type: 'tick' });
    expect(s.lines).toBe(4);
    expect(s.score).toBe(800);
  });
});

describe('immutability', () => {
  it('returns a new board reference after a lock', () => {
    const state = createInitialState(cyclicRng([0.05])); // O-piece
    const before = state.board;
    const next = step(state, { type: 'hardDrop' });
    expect(next.board).not.toBe(before);
  });

  it('never mutates the original board cells', () => {
    const state = createInitialState(rngAlwaysFirst);
    const snapshot = JSON.stringify(state.board);
    step(state, { type: 'hardDrop' });
    step(state, move(Direction.Left));
    step(state, { type: 'rotate', dir: 'cw' });
    expect(JSON.stringify(state.board)).toBe(snapshot);
  });
});

describe('game over', () => {
  it('freezes the state once gameOver is true', () => {
    // Force game over by filling the spawn area.
    const board = createBoard(DEFAULT_CONFIG.rows, DEFAULT_CONFIG.columns).map(
      (row, r) => (r < 2 ? row.map(() => TetrominoId.I) : row),
    );
    const base: GameState = {
      config: DEFAULT_CONFIG,
      board,
      current: null,
      next: TetrominoId.I,
      score: 5,
      level: 2,
      lines: 3,
      gameOver: true,
    };
    const next = step(base, { type: 'tick' });
    expect(next).toBe(base);
  });
});
