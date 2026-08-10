// ---------------------------------------------------------------------------
// Pure Tetris engine.
//
// This module is intentionally DOM-free and Node-importable: it never touches
// window, document, timers or the canvas. All rendering, input and UI live in
// the other modules. The unit tests in test/engine.test.mjs import only this
// module (and constants.js).
// ---------------------------------------------------------------------------
import {
  COLS,
  ROWS,
  BAG,
  SHAPES,
  SPAWN,
  KICKS,
  CLEAR_SCORE,
  LINES_PER_LEVEL,
  GRAVITY,
  NEXT_COUNT,
} from './constants.js';

export class Tetris {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
    this.bag = [];
    this.next = [];
    this.hold = null;
    this.canHold = true;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.state = 'ready'; // ready | playing | paused | over
    this.current = null;
    this.ghostY = 0;
    this.gravityAccum = 0;
    this.refillBag();
    this.fillNext();
  }

  refillBag() {
    const bag = [...BAG];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    this.bag = this.bag.concat(bag);
  }

  drawFromBag() {
    if (this.bag.length === 0) this.refillBag();
    return this.bag.shift();
  }

  fillNext() {
    while (this.next.length < NEXT_COUNT) {
      this.next.push(this.drawFromBag());
    }
  }

  start() {
    this.reset();
    this.state = 'playing';
    this.spawn();
  }

  // Place the next queued piece as the active piece. Returns false (and sets
  // state to 'over') if the spawn position is already blocked.
  spawn() {
    this.fillNext();
    const type = this.next.shift();
    this.current = { type, rotation: 0, x: SPAWN[type], y: 0 };
    this.canHold = true;
    this.fillNext();
    if (this.collides(this.current.type, this.current.rotation, this.current.x, this.current.y)) {
      this.state = 'over';
      this.current = null;
      return false;
    }
    this.updateGhost();
    return true;
  }

  getCells(type, rotation) {
    return SHAPES[type][rotation];
  }

  collides(type, rotation, x, y) {
    const cells = this.getCells(type, rotation);
    for (const [cx, cy] of cells) {
      const bx = x + cx;
      const by = y + cy;
      if (bx < 0 || bx >= COLS || by >= ROWS) return true;
      if (by >= 0 && this.board[by][bx]) return true;
    }
    return false;
  }

  moveLeft() {
    if (this.state !== 'playing' || !this.current) return false;
    if (!this.collides(this.current.type, this.current.rotation, this.current.x - 1, this.current.y)) {
      this.current.x -= 1;
      this.updateGhost();
      return true;
    }
    return false;
  }

  moveRight() {
    if (this.state !== 'playing' || !this.current) return false;
    if (!this.collides(this.current.type, this.current.rotation, this.current.x + 1, this.current.y)) {
      this.current.x += 1;
      this.updateGhost();
      return true;
    }
    return false;
  }

  // Gravity-driven downward step (no score).
  moveDown() {
    if (this.state !== 'playing' || !this.current) return false;
    if (!this.collides(this.current.type, this.current.rotation, this.current.x, this.current.y + 1)) {
      this.current.y += 1;
      this.updateGhost();
      return true;
    }
    return false;
  }

  // Player soft drop: move down and award 1 point.
  softDrop() {
    if (this.moveDown()) {
      this.score += 1;
      return true;
    }
    return false;
  }

  getGhostY() {
    let y = this.current.y;
    while (!this.collides(this.current.type, this.current.rotation, this.current.x, y + 1)) {
      y += 1;
    }
    return y;
  }

  updateGhost() {
    if (this.current) this.ghostY = this.getGhostY();
  }

  hardDrop() {
    if (this.state !== 'playing' || !this.current) return false;
    this.current.y = this.getGhostY();
    this.lock();
    return true;
  }

  rotate(direction) {
    // direction: 1 = CW, -1 = CCW
    if (this.state !== 'playing' || !this.current) return false;
    const { type, rotation } = this.current;
    if (type === 'O') return false; // O does not rotate
    const newRot = (rotation + direction + 4) % 4;
    const table = KICKS[type === 'I' ? 'I' : 'JLSTZ'];
    const kicks = table[`${rotation}->${newRot}`];
    for (const [dx, dy] of kicks) {
      if (!this.collides(type, newRot, this.current.x + dx, this.current.y + dy)) {
        this.current.rotation = newRot;
        this.current.x += dx;
        this.current.y += dy;
        this.updateGhost();
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

  // Standard hold: swap the active piece with the held one (or stash it and
  // spawn a fresh piece when nothing is held). Only once per piece.
  holdPiece() {
    if (this.state !== 'playing' || !this.current || !this.canHold) return false;
    const held = this.current.type;
    this.current = null;
    if (this.hold) {
      const swap = this.hold;
      this.hold = held;
      this.current = { type: swap, rotation: 0, x: SPAWN[swap], y: 0 };
    } else {
      this.hold = held;
      this.spawn(); // spawns a fresh current
    }
    this.canHold = false;
    this.updateGhost();
    return true;
  }

  lock() {
    const { type, rotation, x, y } = this.current;
    const cells = this.getCells(type, rotation);
    for (const [cx, cy] of cells) {
      const bx = x + cx;
      const by = y + cy;
      if (by < 0) {
        // Piece locked above the visible board -> game over.
        this.state = 'over';
        this.current = null;
        return;
      }
      this.board[by][bx] = type;
    }

    // Line clear: remove full rows and shift everything above down.
    let cleared = 0;
    for (let row = ROWS - 1; row >= 0; row--) {
      if (this.board[row].every((c) => c !== null)) {
        this.board.splice(row, 1);
        this.board.unshift(new Array(COLS).fill(null));
        cleared += 1;
        row += 1; // recheck the same index after the shift
      }
    }

    if (cleared > 0) {
      this.score += (CLEAR_SCORE[cleared] || 0) * this.level;
      this.lines += cleared;
      this.level = Math.floor(this.lines / LINES_PER_LEVEL) + 1;
    }

    this.spawn();
  }

  // Gravity tick driven by the main rAF loop with a delta in ms.
  tick(dt) {
    if (this.state !== 'playing' || !this.current) return;
    this.gravityAccum += dt;
    const interval = GRAVITY(this.level);
    while (this.gravityAccum >= interval) {
      this.gravityAccum -= interval;
      if (!this.moveDown()) {
        this.lock();
        this.gravityAccum = 0;
        break;
      }
    }
  }

  getNextPieces(count = NEXT_COUNT) {
    return this.next.slice(0, count);
  }

  togglePause() {
    if (this.state === 'playing') this.state = 'paused';
    else if (this.state === 'paused') this.state = 'playing';
  }
}
