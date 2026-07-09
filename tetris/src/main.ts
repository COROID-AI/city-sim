/**
 * Composition root — wires game rules, keyboard input, renderer, and loop.
 *
 * This is the ONLY module that touches the DOM. Everything else (game/, input/,
 * render/) is designed to be pure or framework-agnostic.
 */

import { loadHighScore, saveHighScore } from "./game/highscore";
import { startLoop, type LoopController } from "./game/loop";
import {
  createGame,
  setSoftDrop,
  spawnNext,
  tick,
  tryMove,
  tryRotate,
} from "./game/rules";
import type { Bag } from "./game/bag";
import type { GameState } from "./game/types";
import { createKeyboardController } from "./input/keyboard";
import { createRenderer } from "./render/draw";

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const boardCanvas = document.getElementById("board") as HTMLCanvasElement;
const nextCanvas = document.getElementById("next") as HTMLCanvasElement;
const scoreEl = document.getElementById("score") as HTMLElement;
const levelEl = document.getElementById("level") as HTMLElement;
const linesEl = document.getElementById("lines") as HTMLElement;
const overlayEl = document.getElementById("overlay") as HTMLElement;
const overlayTitleEl = document.getElementById("overlay-title") as HTMLElement;
const overlayTextEl = document.getElementById("overlay-text") as HTMLElement;
const startBtn = document.getElementById("start-btn") as HTMLButtonElement;

// ---------------------------------------------------------------------------
// Mutable game world (only the composition root mutates these)
// ---------------------------------------------------------------------------

let state: GameState;
let bag: Bag;
let loop: LoopController | null = null;

const renderer = createRenderer({
  boardCanvas,
  nextCanvas,
  cellSize: 30,
});

// ---------------------------------------------------------------------------
// Actions — translate input into pure state transitions
// ---------------------------------------------------------------------------

function moveActive(dir: number): void {
  if (state.status !== "playing" || state.active === null) return;
  const moved = tryMove(state.board, state.active, 0, dir);
  if (moved) {
    state = { ...state, active: moved };
    // Reset lock timer on successful move (lock delay resets when piece moves).
    state = { ...state, lockTimer: 0 };
    render();
  }
}

function rotateActive(): void {
  if (state.status !== "playing" || state.active === null) return;
  const rotated = tryRotate(state.board, state.active, 1);
  if (rotated) {
    state = { ...state, active: rotated, lockTimer: 0 };
    render();
  }
}

function setSoftDropState(on: boolean): void {
  if (state.status !== "playing") return;
  state = setSoftDrop(state, on);
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

const keyboard = createKeyboardController({
  onMove: moveActive,
  onRotate: rotateActive,
  onSoftDrop: setSoftDropState,
});

// ---------------------------------------------------------------------------
// Rendering & HUD
// ---------------------------------------------------------------------------

function render(): void {
  renderer.render(state);
  scoreEl.textContent = String(state.score);
  // Levels are displayed 1-based for players.
  levelEl.textContent = String(state.level + 1);
  linesEl.textContent = String(state.lines);

  if (state.status === "gameOver") {
    overlayEl.classList.add("visible");
    overlayTitleEl.textContent = "Game Over";
    overlayTextEl.textContent = `Score: ${state.score} — press Start to play again`;
    startBtn.textContent = "Restart";
  } else if (state.status === "idle") {
    overlayEl.classList.add("visible");
    overlayTitleEl.textContent = "Tetris";
    overlayTextEl.textContent = "Press Start to play";
  } else {
    overlayEl.classList.remove("visible");
  }
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------

function reset(): void {
  const highScore = loadHighScore();
  const created = createGame({ highScore });
  state = created.state;
  bag = created.bag;

  if (loop) loop.stop();
  loop = startLoop({
    tick(dt: number) {
      state = tick(state, dt, bag);
      // Persist high score whenever it increases.
      if (state.score > state.highScore) {
        saveHighScore(state.score);
      }
    },
    render,
  });

  render();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

keyboard.attach(window);

startBtn.addEventListener("click", () => {
  reset();
});

// Auto-pause on tab visibility change to avoid accumulator explosion.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.status === "playing") {
    // Dropping soft-drop ensures we don't accelerate while away.
    state = setSoftDrop(state, false);
  }
});

// Start in idle state — player presses Start to begin.
const initialHigh = loadHighScore();
const created = createGame({ highScore: initialHigh });
state = { ...created.state, status: "idle", active: null };
bag = created.bag;

render();
