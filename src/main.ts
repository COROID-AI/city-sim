import './style.css';
import { Engine } from './game/engine';
import { KeyboardController } from './game/input';
import { createRenderer, type Renderer } from './game/renderer';
import { loadHighScore, saveHighScore } from './game/storage';
import type { ActionName, GameStatus } from './game/types';

const boardCanvas = mustGet<HTMLCanvasElement>('#board');
const holdCanvas = mustGet<HTMLCanvasElement>('#hold');
const nextCanvas = mustGet<HTMLCanvasElement>('#next');

const scoreEl = mustGet<HTMLElement>('#score');
const levelEl = mustGet<HTMLElement>('#level');
const linesEl = mustGet<HTMLElement>('#lines');
const highEl = mustGet<HTMLElement>('#high');

const overlayEl = mustGet<HTMLElement>('#overlay');
const overlayTitleEl = mustGet<HTMLElement>('#overlay-title');
const overlayTextEl = mustGet<HTMLElement>('#overlay-text');
const finalScoreEl = mustGet<HTMLElement>('#final-score');
const overlayPrimaryEl = mustGet<HTMLButtonElement>('#overlay-primary');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const engine = new Engine();
const renderer: Renderer = createRenderer(boardCanvas, holdCanvas, nextCanvas, {
  reducedMotion,
});

let highScore = loadHighScore();

function mustGet<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

function startGame(): void {
  engine.start();
}

function overlayFor(status: GameStatus): void {
  switch (status) {
    case 'idle':
      overlayTitleEl.textContent = 'Tetris';
      overlayTextEl.textContent =
        'Clear lines to score. Rack up Tetrises with the I piece. Survive as the gravity rises.';
      finalScoreEl.hidden = true;
      overlayPrimaryEl.textContent = 'Start';
      overlayEl.hidden = false;
      overlayPrimaryEl.focus();
      break;
    case 'playing':
      overlayEl.hidden = true;
      break;
    case 'paused':
      overlayTitleEl.textContent = 'Paused';
      overlayTextEl.textContent = 'Take a breath — press P or Resume to continue.';
      finalScoreEl.hidden = true;
      overlayPrimaryEl.textContent = 'Resume';
      overlayEl.hidden = false;
      break;
    case 'over': {
      const { score } = engine.state;
      overlayTitleEl.textContent = 'Game Over';
      overlayTextEl.textContent = 'The stack reached the top.';
      finalScoreEl.textContent = `Final score ${score} · Best ${highScore}`;
      finalScoreEl.hidden = false;
      overlayPrimaryEl.textContent = 'Play Again';
      overlayEl.hidden = false;
      break;
    }
  }
}

const controller = new KeyboardController({
  onAction(action: ActionName): void {
    switch (action) {
      case 'moveLeft':
        engine.moveLeft();
        break;
      case 'moveRight':
        engine.moveRight();
        break;
      case 'softDrop':
        engine.softDrop();
        break;
      case 'hardDrop':
        engine.hardDrop();
        break;
      case 'rotateCW':
        engine.rotateCW();
        break;
      case 'rotateCCW':
        engine.rotateCCW();
        break;
      case 'hold':
        engine.hold();
        break;
      case 'pauseToggle':
        if (engine.state.status === 'playing' || engine.state.status === 'paused') {
          engine.togglePause();
        }
        break;
      case 'start':
        if (engine.state.status !== 'playing') startGame();
        break;
    }
  },
  onMove(dir: 'left' | 'right'): void {
    if (dir === 'left') engine.moveLeft();
    else engine.moveRight();
  },
  onSoftDrop(): void {
    engine.softDrop();
  },
});

overlayPrimaryEl.addEventListener('click', () => {
  if (engine.state.status === 'paused') {
    engine.togglePause();
  } else {
    startGame();
  }
});

function updateHud(): void {
  const s = engine.state;
  scoreEl.textContent = String(s.score);
  levelEl.textContent = String(s.level);
  linesEl.textContent = String(s.lines);
  highEl.textContent = highScore > s.score ? String(highScore) : String(s.score);
}

function syncOverlay(previous: GameStatus): void {
  const status = engine.state.status;
  if (status !== previous) {
    if (status === 'over' && engine.state.score > highScore) {
      highScore = engine.state.score;
      saveHighScore(highScore);
    }
    overlayFor(status);
  }
}

let lastStatus: GameStatus = engine.state.status;

function frame(now: number): void {
  if (lastTime === null) lastTime = now;
  const dt = Math.min(now - lastTime, 100);
  lastTime = now;

  controller.poll(now);
  engine.update(dt);
  renderer.render(engine.state);
  updateHud();
  syncOverlay(lastStatus);
  lastStatus = engine.state.status;

  requestAnimationFrame(frame);
}

let lastTime: number | null = null;

// Auto-pause when the tab is hidden so gravity never "teleports".
document.addEventListener('visibilitychange', () => {
  if (document.hidden && engine.state.status === 'playing') engine.togglePause();
});

controller.bind();
overlayFor('idle');
requestAnimationFrame(frame);