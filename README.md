# Tetris

A browser-based Tetris game built with **Vite**, **TypeScript**, and **Jest**.

## Controls

Player input is intentionally limited to the **four arrow keys** — no WASD, no
space, no mouse, no touch:

| Key | Action |
| --- | --- |
| **←** | Move the active piece one cell left |
| **→** | Move the active piece one cell right |
| **↓** | Soft-drop the piece one cell (awards 1 point) |
| **↑** | Rotate the piece clockwise |

## Architecture

The game is split into pure, headlessly-testable logic and a thin browser shell.

| Path | Responsibility |
| --- | --- |
| `src/game/types.ts` | Core data types (`Direction`, `Cell`, `Tetromino`, `Board`, `GameState`, …) |
| `src/game/tetrominoes.ts` | The 7 standard tetrominoes + `getShape` / `rotate` helpers |
| `src/game/board.ts` | Pure board operations (`createBoard`, `clearFullRows`, …) |
| `src/game/rules.ts` | Pure collision/placement rules (`canPlace`, `tryMove`, `tryRotate`, `lockPiece`) |
| `src/game/state.ts` | Immutable state reducer (`createInitialState`, `step`) + scoring |
| `src/input/keyboard.ts` | Arrow-key → action mapper (`mapKeyToAction`) — the sole input surface |
| `src/render/draw.ts` | Pure canvas renderer (`draw`) — accepts a mock context |
| `src/main.ts` | Browser entry: canvas bootstrap, one `keydown` listener, `requestAnimationFrame` loop |

The game-logic and input modules are **pure**: no DOM, no randomness (the RNG is
injected), no I/O. The renderer (`draw.ts`) is pure with respect to its context
parameter — it only calls drawing methods on a minimal `DrawContext` interface
that `CanvasRenderingContext2D` satisfies, so it can be unit-tested with a plain
mock object.

## Layout

The 480 × 600 canvas is divided into a **300 × 600 play field** (10 columns × 20
rows at 30 px per cell) and a **170 px side panel** showing the next-piece
preview and the score / level / lines HUD.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server with hot-module reload |
| `npm run build` | Type-check (`tsc`) and build for production into `dist/` |
| `npm test` | Run the Jest test suite |
| `npm run preview` | Preview the production build locally |

## Getting started

```bash
npm install
npm run dev
```

Open the URL Vite prints, then use the arrow keys to play.
