// ---------------------------------------------------------------------------
// Input handling: keyboard (with smooth DAS/ARR movement) and on-screen touch
// controls. Touch controls only operate on touch-capable devices and are
// hidden on desktop via CSS, so they never clutter the desktop layout.
// ---------------------------------------------------------------------------
import { DAS_MS, ARR_MS, SOFT_DROP_MS } from './constants.js';

// Delayed Auto Shift / Auto Repeat Rate controller.
//
// On initial press the piece moves once immediately. While the key stays
// held, no further movement happens until DAS_MS elapses, then the piece
// repeats every ARR_MS. Native key-repeat is ignored (e.repeat) so the timing
// is fully controlled here — this avoids the laggy or double-firing feel that
// naive implementations produce.
class DasController {
  constructor() {
    this.das = DAS_MS;
    this.arr = ARR_MS;
    this.keys = { left: false, right: false };
    this.dir = null; // 'left' | 'right' | null (last pressed wins)
    this.lastMove = 0;
    this.dasElapsed = false;
  }

  press(dir) {
    this.keys[dir] = true;
    this.dir = dir;
    this.dasElapsed = false;
    this.lastMove = performance.now();
    return true; // perform an immediate move
  }

  release(dir) {
    this.keys[dir] = false;
    if (this.dir === dir) {
      this.dir = this.keys.left ? 'left' : this.keys.right ? 'right' : null;
      if (this.dir) {
        this.dasElapsed = false;
        this.lastMove = performance.now();
      }
    }
  }

  // Returns true when a repeat move should fire at time `now`.
  update(now) {
    if (!this.dir) return false;
    if (!this.dasElapsed) {
      if (now - this.lastMove >= this.das) {
        this.dasElapsed = true;
        this.lastMove = now;
        return true;
      }
      return false;
    }
    if (now - this.lastMove >= this.arr) {
      this.lastMove = now;
      return true;
    }
    return false;
  }
}

export class Input {
  constructor(engine, ui) {
    this.engine = engine;
    this.ui = ui;
    this.das = new DasController();
    this.softDropActive = false;
    this.softDropLast = 0;
    this.touchButtons = [];
    this.bindKeyboard();
    this.bindTouch();
  }

  bindKeyboard() {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
  }

  onKeyDown(e) {
    const code = e.code;
    // Prevent the page from scrolling on game keys.
    if (
      code === 'ArrowLeft' || code === 'ArrowRight' ||
      code === 'ArrowDown' || code === 'ArrowUp' ||
      code === 'Space'
    ) {
      e.preventDefault();
    }

    // Ignore native key-repeat; DAS/ARR drives all repeat movement.
    if (e.repeat) return;

    switch (code) {
      case 'ArrowLeft':
        if (this.das.press('left')) this.engine.moveLeft();
        break;
      case 'ArrowRight':
        if (this.das.press('right')) this.engine.moveRight();
        break;
      case 'ArrowDown':
        this.softDropActive = true;
        this.softDropLast = performance.now();
        this.engine.softDrop();
        break;
      case 'ArrowUp':
      case 'KeyX':
        this.engine.rotateCW();
        break;
      case 'KeyZ':
      case 'ControlLeft':
      case 'ControlRight':
        this.engine.rotateCCW();
        break;
      case 'Space':
        this.engine.hardDrop();
        break;
      case 'KeyC':
      case 'ShiftLeft':
      case 'ShiftRight':
        this.engine.holdPiece();
        break;
      case 'Enter':
        this.ui.handleEnter();
        break;
      case 'KeyP':
      case 'Escape':
        this.ui.togglePause();
        break;
      default:
        break;
    }
  }

  onKeyUp(e) {
    switch (e.code) {
      case 'ArrowLeft':
        this.das.release('left');
        break;
      case 'ArrowRight':
        this.das.release('right');
        break;
      case 'ArrowDown':
        this.softDropActive = false;
        break;
      default:
        break;
    }
  }

  bindTouch() {
    const container = document.querySelector('.touch-controls');
    if (!container) return;
    const buttons = container.querySelectorAll('button[data-action]');
    buttons.forEach((btn) => {
      const action = btn.dataset.action;
      const start = (e) => {
        e.preventDefault();
        this.touchStart(action);
      };
      const end = (e) => {
        e.preventDefault();
        this.touchEnd(action);
      };
      btn.addEventListener('pointerdown', start);
      btn.addEventListener('pointerup', end);
      btn.addEventListener('pointercancel', end);
      btn.addEventListener('pointerleave', end);
      this.touchButtons.push({ action, btn });
    });
  }

  touchStart(action) {
    switch (action) {
      case 'left':
        if (this.das.press('left')) this.engine.moveLeft();
        break;
      case 'right':
        if (this.das.press('right')) this.engine.moveRight();
        break;
      case 'softDrop':
        this.softDropActive = true;
        this.softDropLast = performance.now();
        this.engine.softDrop();
        break;
      case 'rotateCW':
        this.engine.rotateCW();
        break;
      case 'rotateCCW':
        this.engine.rotateCCW();
        break;
      case 'hardDrop':
        this.engine.hardDrop();
        break;
      case 'hold':
        this.engine.holdPiece();
        break;
      default:
        break;
    }
  }

  touchEnd(action) {
    switch (action) {
      case 'left':
        this.das.release('left');
        break;
      case 'right':
        this.das.release('right');
        break;
      case 'softDrop':
        this.softDropActive = false;
        break;
      default:
        break;
    }
  }

  // Called every frame from the rAF loop with the current timestamp.
  update(now) {
    if (this.das.update(now)) {
      if (this.das.dir === 'left') this.engine.moveLeft();
      else if (this.das.dir === 'right') this.engine.moveRight();
    }
    if (this.softDropActive && now - this.softDropLast >= SOFT_DROP_MS) {
      this.softDropLast = now;
      this.engine.softDrop();
    }
  }
}
