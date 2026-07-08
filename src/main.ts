/**
 * Tetris entry point.
 *
 * Wires the canvas renderer, arrow-key input, and fixed-timestep game loop
 * together. The pure game logic lives in the `game` module; this file only
 * handles DOM bootstrapping and the render callback.
 */

import { installKeyboard } from "./input/keyboard.js";
import { startLoop } from "./game/loop.js";
import { applyAction, newGame, type Action, type GameState } from "./game/state.js";
import {
  BOARD_PIXEL_HEIGHT,
  BOARD_PIXEL_WIDTH,
  clearBoard,
  drawBoard,
  drawGameOver,
  drawGrid,
  drawNextPiece,
  drawPiece,
} from "./render/draw.js";

const BOARD_ID = "board";
const NEXT_ID = "next";
const SCORE_ID = "score";
const LINES_ID = "lines";
const LEVEL_ID = "level";

function getElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) {
    throw new Error(`Expected an element with id="${id}" in the document.`);
  }
  return el;
}

function getCanvas(id: string): HTMLCanvasElement {
  const canvas = getElement(id);
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error(`Expected <canvas id="${id}">.`);
  }
  return canvas;
}

function getCtx(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("Unable to acquire a 2D rendering context.");
  }
  return ctx;
}

/** Text element that displays a numeric stat (score/lines/level). */
class StatView {
  constructor(private readonly el: HTMLElement) {}

  update(value: number): void {
    this.el.textContent = String(value);
  }
}

interface Views {
  boardCtx: CanvasRenderingContext2D;
  boardCanvas: HTMLCanvasElement;
  nextCtx: CanvasRenderingContext2D;
  nextCanvas: HTMLCanvasElement;
  score: StatView;
  lines: StatView;
  level: StatView;
}

function queryViews(): Views {
  const boardCanvas = getCanvas(BOARD_ID);
  const nextCanvas = getCanvas(NEXT_ID);
  return {
    boardCtx: getCtx(boardCanvas),
    boardCanvas,
    nextCtx: getCtx(nextCanvas),
    nextCanvas,
    score: new StatView(getElement(SCORE_ID)),
    lines: new StatView(getElement(LINES_ID)),
    level: new StatView(getElement(LEVEL_ID)),
  };
}

/** Renders the complete current frame from an immutable game state. */
function render(views: Views, state: GameState): void {
  clearBoard(views.boardCtx, BOARD_PIXEL_WIDTH, BOARD_PIXEL_HEIGHT);
  drawGrid(views.boardCtx);
  drawBoard(views.boardCtx, state.board);
  drawPiece(views.boardCtx, state.current);

  const nextType = state.queue[0] ?? null;
  drawNextPiece(
    views.nextCtx,
    nextType,
    views.nextCanvas.width,
    views.nextCanvas.height
  );

  views.score.update(state.score);
  views.lines.update(state.lines);
  views.level.update(state.level);

  if (state.gameOver) {
    drawGameOver(views.boardCtx, BOARD_PIXEL_WIDTH, BOARD_PIXEL_HEIGHT);
  }
}

function main(): void {
  const views = queryViews();
  const queue: Action[] = [];

  installKeyboard(queue);

  const initialState = newGame();
  // Render once immediately so the board is painted before the first rAF.
  render(views, initialState);

  startLoop(initialState, queue, {
    onFrame: (state: GameState) => render(views, state),
  });
}

main();
