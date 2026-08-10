// ---------------------------------------------------------------------------
// UI: overlays (start / pause / game over), stat readouts, and hold/next
// previews. All DOM access lives here (and in renderer/input/main).
// ---------------------------------------------------------------------------
import { NEXT_COUNT } from './constants.js';

export class UI {
  constructor(engine, renderer) {
    this.engine = engine;
    this.renderer = renderer;

    this.scoreEl = document.getElementById('score');
    this.linesEl = document.getElementById('lines');
    this.levelEl = document.getElementById('level');
    this.holdCanvas = document.getElementById('hold');
    this.nextCanvas = document.getElementById('next');
    this.slotCanvas = document.createElement('canvas');

    this.overlay = document.getElementById('overlay');
    this.overlayTitle = document.getElementById('overlay-title');
    this.overlayText = document.getElementById('overlay-text');
    this.startBtn = document.getElementById('start-btn');

    this.startBtn.addEventListener('click', () => this.handleEnter());
  }

  handleEnter() {
    if (this.engine.state === 'ready' || this.engine.state === 'over') {
      this.engine.start();
    } else if (this.engine.state === 'paused') {
      this.engine.togglePause();
    }
  }

  togglePause() {
    if (this.engine.state === 'playing') this.engine.togglePause();
    else if (this.engine.state === 'paused') this.engine.togglePause();
  }

  update() {
    this.updateOverlay();
    this.updateStats();
    this.updatePreview();
  }

  updateOverlay() {
    const s = this.engine.state;
    if (s === 'playing') {
      this.overlay.classList.add('hidden');
      return;
    }
    this.overlay.classList.remove('hidden');
    if (s === 'ready') {
      this.overlayTitle.textContent = 'TETRIS';
      this.overlayText.textContent = 'Press Enter or tap Start';
      this.startBtn.textContent = 'Start';
    } else if (s === 'paused') {
      this.overlayTitle.textContent = 'Paused';
      this.overlayText.textContent = 'Press Enter to resume';
      this.startBtn.textContent = 'Resume';
    } else if (s === 'over') {
      this.overlayTitle.textContent = 'Game Over';
      this.overlayText.textContent = `Final score: ${this.engine.score}`;
      this.startBtn.textContent = 'Restart';
    }
  }

  updateStats() {
    this.scoreEl.textContent = String(this.engine.score);
    this.linesEl.textContent = String(this.engine.lines);
    this.levelEl.textContent = String(this.engine.level);
  }

  updatePreview() {
    this.renderer.drawPreview(this.holdCanvas, this.engine.hold);
    const next = this.engine.getNextPieces(NEXT_COUNT);
    // Draw each upcoming piece into a slice of the next canvas.
    const ctx = this.nextCanvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = this.nextCanvas.getBoundingClientRect();
    const w = rect.width || this.nextCanvas.width;
    const h = rect.height || this.nextCanvas.height;
    this.nextCanvas.width = Math.round(w * dpr);
    this.nextCanvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const slotH = h / NEXT_COUNT;
    const slot = this.slotCanvas;
    slot.width = w;
    slot.height = slotH;
    next.forEach((type, i) => {
      this.renderer.drawPreviewInto(slot, type, w, slotH);
      ctx.drawImage(slot, 0, i * slotH, w, slotH);
    });
  }
}
