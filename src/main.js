/**
 * Application bootstrap module.
 *
 * Wires DOM elements to game modules, attaches the keydown listener (with an
 * input guard for text fields), starts the game loop, and exposes a tiny debug
 * surface for tests (window.__tetris = { state, reset, togglePause }).
 *
 * Entry point only — no game logic lives here.
 */

import { COLS, ROWS, BLOCK_SIZE_PX } from './config.js';
import { createGame } from './game.js';
import { setupCanvas, render } from './renderer.js';
import { createInput, isGameKey } from './input.js';
import { createLoop } from './loop.js';
import { createUI } from './ui.js';

function bootstrap() {
  // --- Locate DOM elements ---
  const canvas = document.getElementById('board');
  const nextCanvas = document.getElementById('next');
  const scoreEl = document.getElementById('score');
  const levelEl = document.getElementById('level');
  const linesEl = document.getElementById('lines');
  const overlayEl = document.getElementById('overlay');
  const overlayTitleEl = document.getElementById('overlay-title');
  const overlayTextEl = document.getElementById('overlay-text');
  const appEl = document.getElementById('app');

  if (!canvas) {
    console.error('Tetris: #board canvas not found');
    return;
  }

  // --- Set up canvases ---
  const boardWidth = COLS * BLOCK_SIZE_PX;
  const boardHeight = ROWS * BLOCK_SIZE_PX;
  const ctx = setupCanvas(canvas, boardWidth, boardHeight);

  // --- Create game ---
  const game = createGame();

  // --- Create UI ---
  const ui = createUI({
    scoreEl,
    levelEl,
    linesEl,
    nextCanvas,
    overlayEl,
    overlayTitleEl,
    overlayTextEl,
    previewWidth: 130,
    previewHeight: 110,
  });

  // --- Render on every state change ---
  function redraw() {
    const ghostY = game.getGhostY();
    render(ctx, {
      board: game.state.board,
      piece: game.state.piece,
      ghostY,
    });
    ui.updateStats({
      score: game.state.score,
      level: game.state.level,
      lines: game.state.lines,
    });
    ui.updateNext(game.state.nextPiece);
    ui.syncOverlay(game.state);
  }

  game.onChange(redraw);

  // --- Input guard: ignore keys when a text field is focused ---
  function isInputGuarded() {
    const active = document.activeElement;
    if (!active) return false;
    const tag = active.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable;
  }

  // --- Arrow-key input (gameplay) ---
  const input = createInput(game, { isInputGuarded });
  input.attach();

  // --- Game loop ---
  const loop = createLoop({
    getGravityInterval: () => game.getGravityInterval(),
    getSoftDropInterval: () => game.getSoftDropInterval(),
    isSoftDropping: () => input.isSoftDropping(),
    isPaused: () => game.state.isGameOver || game.state.isPaused,
    onGravityTick: () => game.step(),
    onSoftDropTick: () => game.softDrop(),
  });
  loop.attachVisibility();
  loop.start();

  // --- Meta controls: Enter for pause / resume / restart (not gameplay) ---
  // Per the user constraint, gameplay is arrow-only. Enter is reserved for
  // out-of-game state transitions and is clearly documented in the UI legend.
  function onKeyDownMeta(e) {
    if (e.key === 'Enter') {
      if (game.state.isGameOver) {
        // Restart on game-over
        game.reset();
        loop.reset();
        redraw();
        e.preventDefault();
      } else {
        // Toggle pause
        game.togglePause();
        e.preventDefault();
      }
      return;
    }
    // Prevent page scroll for all arrow keys (belt-and-suspenders alongside input.js)
    if (isGameKey(e.key)) {
      e.preventDefault();
    }
  }
  window.addEventListener('keydown', onKeyDownMeta, { passive: false });

  // --- Focus the app container so keys are captured ---
  if (appEl) {
    appEl.tabIndex = 0;
    appEl.focus();
  }

  // --- Initial draw ---
  redraw();

  // --- Debug surface for tests ---
  window.__tetris = {
    get state() {
      return game.state;
    },
    reset: () => {
      game.reset();
      loop.reset();
      redraw();
    },
    togglePause: () => {
      game.togglePause();
      redraw();
    },
    game,
  };
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
