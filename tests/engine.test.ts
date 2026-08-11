import { describe, expect, it } from 'vitest';
import {
  BOARD_COLS,
  LOCK_DELAY_MS,
  LOCK_DELAY_RESET_CAP,
} from '../src/game/constants';
import { Engine } from '../src/game/engine';

/** Deterministic RNG producing a fixed permutation: I, J, O, Z, T, L, S, ... */
const halfRng = () => 0.5;

describe('Engine', () => {
  it('starts with a fresh 7-bag queue and an active piece', () => {
    const engine = new Engine(halfRng);
    engine.start();
    expect(engine.state.status).toBe('playing');
    expect(engine.state.active?.type).toBe('I');
    expect(engine.state.queue).toHaveLength(4);
    expect(engine.state.queue[0]).toBe('J');
    expect(engine.getQueuePreview()).toHaveLength(3);
    expect(engine.state.score).toBe(0);
  });

  it('gravity advances the piece one row per gravity tick', () => {
    const engine = new Engine(halfRng);
    engine.start();
    expect(engine.state.active!.y).toBe(0);
    engine.update(engine.state.gravityMs);
    expect(engine.state.active!.y).toBe(1);
    engine.update(engine.state.gravityMs);
    expect(engine.state.active!.y).toBe(2);
  });

  it('soft drop scores rows and grounds the piece', () => {
    const engine = new Engine(halfRng);
    engine.start();
    const ghostY = engine.getGhost()!.y;
    const rows = engine.softDrop();
    expect(rows).toBe(ghostY);
    expect(engine.state.active!.y).toBe(ghostY);
    expect(engine.state.grounded).toBe(true);
    expect(engine.state.score).toBe(ghostY * 1);
  });

  it('hard drop scores 2x rows and immediately spawns the next piece', () => {
    const engine = new Engine(halfRng);
    engine.start();
    const ghostY = engine.getGhost()!.y;
    engine.hardDrop();
    expect(engine.state.score).toBe(ghostY * 2);
    expect(engine.state.active!.type).toBe('J');
    expect(engine.state.status).toBe('playing');
  });

  it('locks a grounded piece after the lock delay elapses', () => {
    const engine = new Engine(halfRng);
    engine.start();
    engine.softDrop();
    expect(engine.state.grounded).toBe(true);
    engine.update(LOCK_DELAY_MS - 1);
    expect(engine.state.active!.type).toBe('I');
    engine.update(1);
    expect(engine.state.active!.type).toBe('J'); // new piece spawned; I locked
  });

  it('resets lock delay on player moves, capped to prevent infinite stalling', () => {
    const engine = new Engine(halfRng);
    engine.start();
    engine.softDrop();
    expect(engine.state.grounded).toBe(true);

    engine.update(250);
    expect(engine.state.lockAccumMs).toBe(250);
    expect(engine.moveLeft()).toBe(true);
    expect(engine.state.lockAccumMs).toBe(0);
    expect(engine.state.lockResets).toBe(1);

    // Exhaust the remaining resets one by one.
    for (let i = 1; i < LOCK_DELAY_RESET_CAP; i++) {
      engine.update(20);
      if (i % 2 === 1) engine.moveRight();
      else engine.moveLeft();
    }
    expect(engine.state.lockResets).toBe(LOCK_DELAY_RESET_CAP);

    // Past the cap, further moves no longer reset the accumulator.
    engine.state.lockAccumMs = 0;
    engine.update(100);
    expect(engine.state.lockAccumMs).toBe(100);
    expect(engine.moveLeft()).toBe(true);
    expect(engine.state.lockAccumMs).toBe(100);
    expect(engine.state.status).toBe('playing');
  });

  it('clears a full line on hard drop and scores a single', () => {
    const engine = new Engine(halfRng);
    engine.start();
    const s = engine.state;
    // Pre-fill the bottom row, leaving the landing cells of the J open.
    for (let c = 0; c < BOARD_COLS; c++) {
      if (c < 3 || c > 5) s.board[23][c] = 'T';
    }
    expect(engine.hold()).toBe(true); // hold I, play J
    const ghostY = engine.getGhost()!.y;
    expect(ghostY).toBe(22);
    engine.hardDrop();
    expect(engine.state.lines).toBe(1);
    expect(engine.state.score).toBe(100 + ghostY * 2);
    expect(engine.state.lastClear?.rows).toHaveLength(1);
    expect(engine.state.status).toBe('playing');
  });

  it('hold swaps once per piece and refreshes after a lock', () => {
    const engine = new Engine(halfRng);
    engine.start();
    expect(engine.state.active!.type).toBe('I');

    expect(engine.hold()).toBe(true);
    expect(engine.state.hold).toBe('I');
    expect(engine.state.active!.type).toBe('J');
    expect(engine.state.holdUsed).toBe(true);
    expect(engine.hold()).toBe(false); // already used this piece

    engine.hardDrop();
    expect(engine.state.holdUsed).toBe(false);
    expect(engine.hold()).toBe(true);
    expect(engine.state.hold).toBe('O');
    expect(engine.state.active!.type).toBe('I');
  });

  it('ends the game when a spawn collides (block-out)', () => {
    const engine = new Engine(halfRng);
    engine.start();
    const s = engine.state;
    for (let r = 0; r <= 3; r++) {
      for (let c = 0; c < 10; c++) s.board[r][c] = 'T';
    }
    engine.hardDrop();
    expect(engine.state.status).toBe('over');
    expect(engine.state.gameOverReason).toBe('spawn');
  });

  it('ends the game when a piece locks above the visible field (lock-out)', () => {
    const engine = new Engine(halfRng);
    engine.start();
    // Block the row directly below the I so its bar cannot descend.
    for (let c = 0; c < 4; c++) engine.state.board[4][c] = 'T';
    engine.state.active = { type: 'I', rotation: 0, x: 0, y: 0 };
    engine.hardDrop();
    expect(engine.state.status).toBe('over');
    expect(engine.state.gameOverReason).toBe('lockout');
  });

  it('pauses and resumes without advancing gravity', () => {
    const engine = new Engine(halfRng);
    engine.start();
    engine.update(engine.state.gravityMs);
    expect(engine.state.active!.y).toBe(1);
    engine.togglePause();
    expect(engine.state.status).toBe('paused');
    engine.update(10_000);
    expect(engine.state.active!.y).toBe(1);
    engine.togglePause();
    expect(engine.state.status).toBe('playing');
  });

  it('pauseToggle is ignored from idle/over states by the controller path', () => {
    const engine = new Engine(halfRng);
    // The engine itself only toggles between playing/paused.
    engine.togglePause();
    expect(engine.state.status).toBe('idle');
  });
});