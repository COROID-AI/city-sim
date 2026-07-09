/**
 * DOM UI module: updates score/level/lines readouts, renders the next-piece
 * preview on a small canvas, and toggles overlay states (start, paused,
 * game-over).
 *
 * Pure DOM helpers; no canvas drawing for the main board (that's renderer.js).
 */

import { renderPreview } from './renderer.js';
import { setupCanvas } from './renderer.js';

/**
 * Creates the UI controller bound to DOM elements.
 *
 * @param {object} els
 * @param {HTMLElement} els.scoreEl
 * @param {HTMLElement} els.levelEl
 * @param {HTMLElement} els.linesEl
 * @param {HTMLCanvasElement} els.nextCanvas - Canvas for the next-piece preview
 * @param {HTMLElement} els.overlayEl - The overlay container
 * @param {HTMLElement} els.overlayTitleEl - Title text inside the overlay
 * @param {HTMLElement} els.overlayTextEl - Subtext inside the overlay
 * @param {number} [els.previewWidth] - CSS width of the preview canvas
 * @param {number} [els.previewHeight] - CSS height of the preview canvas
 */
export function createUI(els) {
  const pw = els.previewWidth || 120;
  const ph = els.previewHeight || 120;
  let previewCtx = null;

  if (els.nextCanvas) {
    previewCtx = setupCanvas(els.nextCanvas, pw, ph);
  }

  /** Update score, level, and lines readouts. */
  function updateStats({ score, level, lines }) {
    if (els.scoreEl) els.scoreEl.textContent = String(score).padStart(6, '0');
    if (els.levelEl) els.levelEl.textContent = String(level);
    if (els.linesEl) els.linesEl.textContent = String(lines);
  }

  /** Render the next-piece preview. */
  function updateNext(piece) {
    if (previewCtx) {
      renderPreview(previewCtx, piece, pw, ph);
    }
  }

  /** Show or hide the overlay with a given title/subtitle. */
  function showOverlay(title, text) {
    if (!els.overlayEl) return;
    if (els.overlayTitleEl) els.overlayTitleEl.textContent = title;
    if (els.overlayTextEl) els.overlayTextEl.textContent = text || '';
    els.overlayEl.classList.add('visible');
    els.overlayEl.classList.remove('hidden');
  }

  /** Hide the overlay. */
  function hideOverlay() {
    if (!els.overlayEl) return;
    els.overlayEl.classList.remove('visible');
    els.overlayEl.classList.add('hidden');
  }

  /**
   * Sync overlay to the current game state.
   * @param {{ isGameOver: boolean, isPaused: boolean, score: number }} state
   */
  function syncOverlay(state) {
    if (state.isGameOver) {
      showOverlay(
        'GAME OVER',
        `Final Score: ${state.score}\nPress Enter to restart`,
      );
    } else if (state.isPaused) {
      showOverlay('PAUSED', 'Press Enter to resume');
    } else {
      hideOverlay();
    }
  }

  return { updateStats, updateNext, showOverlay, hideOverlay, syncOverlay };
}
