// DOM-free game state machine: movement, SRS rotation with wall kicks,
// gravity step, locking, scoring, levels, hold and game-over detection.
// No browser APIs — unit-testable with node:test and reused by the browser.

import {
  COLS,
  ROWS,
  LINE_SCORES,
  SOFT_DROP_SCORE,
  HARD_DROP_SCORE,
  LINES_PER_LEVEL,
  NEXT_PREVIEW_COUNT,
  gravityMs,
} from './constants.js';
import { getCells, getWallKicks, rotateState, createQueue, refillQueue, drawFromBag, spawnColumn } from './tetrominoes.js';
import { createBoard, collides, lockPiece, getFullRows, clearLines, getDropCells } from './board.js';

export const STATUS = Object.freeze({
  READY: 'ready',
  RUNNING: 'running',
  PAUSED: 'paused',
  OVER: 'over',
});

export class Game {
  constructor({ cols = COLS, rows = ROWS, rng = Math.random } = {}) {
    this.cols = cols;
    this.rows = rows;
    this.rng = rng;
    this.reset();
  }

  reset() {
    this.board = createBoard(this.cols, this.rows);
    this.queue = createQueue(this.rng);
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.hold = null;
    this.canHold = true;
    this.status = STATUS.READY;
    this.active = null;
    this.lastClear = 0;
  }

  start() {
    this.reset();
    this.status = STATUS.RUNNING;
    this.spawnNext();
    return this.status === STATUS.RUNNING;
  }

  pause() {
    if (this.status === STATUS.RUNNING) this.status = STATUS.PAUSED;
    return this.status;
  }

  resume() {
    if (this.status === STATUS.PAUSED) this.status = STATUS.RUNNING;
    return this.status;
  }

  togglePause() {
    return this.status === STATUS.PAUSED ? this.resume() : this.pause();
  }

  gravityMs() {
    return gravityMs(this.level);
  }

  // Places the next bag piece. Game over when the spawn position collides.
  spawnNext() {
    if (this.status !== STATUS.RUNNING) return false;
    const type = drawFromBag(this.queue, this.rng);
    this.active = { type, x: spawnColumn(type, this.cols), y: 0, rotation: 0 };
    if (collides(this.board, this.cells(), this.cols, this.rows)) {
      this.active = null;
      this.status = STATUS.OVER;
      return false;
    }
    return true;
  }

  cells() {
    const a = this.active;
    if (!a) return [];
    return getCells(a.type, a.rotation).map(([dx, dy]) => [a.x + dx, a.y + dy]);
  }

  ghostCells() {
    if (!this.active) return [];
    return getDropCells(this.board, this.cells(), this.cols, this.rows);
  }

  shift(dx, dy) {
    const a = this.active;
    const next = this.cells().map(([x, y]) => [x + dx, y + dy]);
    if (collides(this.board, next, this.cols, this.rows)) return false;
    a.x += dx;
    a.y += dy;
    return true;
  }

  moveLeft() {
    if (this.status !== STATUS.RUNNING || !this.active) return false;
    return this.shift(-1, 0);
  }

  moveRight() {
    if (this.status !== STATUS.RUNNING || !this.active) return false;
    return this.shift(1, 0);
  }

  softDrop() {
    if (this.status !== STATUS.RUNNING || !this.active) return false;
    if (this.shift(0, 1)) {
      this.score += SOFT_DROP_SCORE;
      return true;
    }
    this.lockAndSpawn();
    return false;
  }

  // Gravity tick: move down when possible, otherwise lock and spawn.
  step() {
    if (this.status !== STATUS.RUNNING || !this.active) return false;
    if (this.shift(0, 1)) return true;
    this.lockAndSpawn();
    return false;
  }

  hardDrop() {
    if (this.status !== STATUS.RUNNING || !this.active) return false;
    const current = this.cells();
    const ghost = this.ghostCells();
    const dist = ghost[0][1] - current[0][1];
    if (dist > 0) {
      this.score += dist * HARD_DROP_SCORE;
      this.active.y += dist;
    }
    this.lockAndSpawn();
    return true;
  }

  rotate(dir) {
    if (this.status !== STATUS.RUNNING || !this.active) return false;
    const a = this.active;
    if (a.type === 'O') return false;
    const to = rotateState(a.type, a.rotation, dir);
    const rotated = getCells(a.type, to);
    for (const [dx, dy] of getWallKicks(a.type, a.rotation, to)) {
      const placed = rotated.map(([cx, cy]) => [a.x + cx + dx, a.y + cy + dy]);
      if (!collides(this.board, placed, this.cols, this.rows)) {
        a.rotation = to;
        a.x += dx;
        a.y += dy;
        return true;
      }
    }
    return false;
  }

  rotateCW() {
    return this.rotate(1);
  }

  rotateCCW() {
    return this.rotate(-1);
  }

  // Hold/swap. Disables hold immediately; re-enabled on the next natural spawn
  // (after a lock), never by the hold action itself.
  holdPiece() {
    if (this.status !== STATUS.RUNNING || !this.active || !this.canHold) return false;
    const previous = this.active.type;
    this.active = null;
    if (this.hold === null) {
      this.hold = previous;
      this.spawnNext();
    } else {
      const swapped = this.hold;
      this.hold = previous;
      this.active = { type: swapped, x: spawnColumn(swapped, this.cols), y: 0, rotation: 0 };
    }
    this.canHold = false;
    return true;
  }

  lockAndSpawn() {
    if (!this.active) return;
    this.board = lockPiece(this.board, this.cells(), this.active.type);
    const full = getFullRows(this.board);
    if (full.length > 0) {
      this.board = clearLines(this.board, full).board;
      this.score += LINE_SCORES[full.length] * this.level;
      this.lines += full.length;
      this.level = 1 + Math.floor(this.lines / LINES_PER_LEVEL);
      this.lastClear = full.length;
    } else {
      this.lastClear = 0;
    }
    this.spawnNext();
    // Re-enabled on the next spawn after a lock.
    this.canHold = true;
  }

  peekQueue(n) {
    refillQueue(this.queue, this.rng);
    return this.queue.slice(0, n);
  }

  getState() {
    return {
      status: this.status,
      board: this.board,
      score: this.score,
      lines: this.lines,
      level: this.level,
      active: this.active
        ? {
            type: this.active.type,
            x: this.active.x,
            y: this.active.y,
            rotation: this.active.rotation,
            cells: this.cells(),
            ghost: this.ghostCells(),
          }
        : null,
      next: this.peekQueue(NEXT_PREVIEW_COUNT),
      hold: this.hold,
      canHold: this.canHold,
      lastClear: this.lastClear,
    };
  }
}