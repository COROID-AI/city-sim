# Tetris

A minimal, browser-based Tetris built from scratch with TypeScript, Vite, and Vitest.

## Play

```bash
cd tetris
npm install
npm run dev
```

Open the URL printed by Vite (default <http://localhost:5173>).

## Controls

Only the four **arrow keys** are used — no mouse, no other keys:

| Key         | Action          |
| ----------- | --------------- |
| **← / →**   | Move left/right |
| **↑**       | Rotate 90°      |
| **↓**       | Soft drop       |

Use the **Start** / **Restart** button to begin a new game.

## Scoring

Lines cleared are scored by base points × (level + 1):

| Lines | Base points |
| ----- | ----------- |
| 1     | 100         |
| 2     | 300         |
| 3     | 500         |
| 4     | 800         |

## Level & Gravity

The level increases every 10 lines cleared. Gravity (fall speed) accelerates
per the table below (ms per cell):

| Level | ms/cell |
| ----- | ------- |
| 0     | 1000    |
| 1     | 793     |
| 2     | 618     |
| 3     | 473     |
| 4     | 355     |
| 5     | 262     |
| …     | faster  |

Lock delay is 500ms — the industry-standard grace period for sliding/rotating a
piece at the floor.

## High Score

Your best score is persisted in `localStorage` and loaded on each new game.
The feature degrades gracefully if storage is unavailable.

## Development

```bash
npm run typecheck   # type-check with tsc --noEmit
npm run test:run    # run the Vitest suite once
npm run build       # production build → dist/
npm run preview     # serve the production build
```

## Architecture

- **`src/game/`** — pure game logic (rules, bag randomizer, tetromino data,
  types, constants). No DOM access — fully unit-testable.
- **`src/input/keyboard.ts`** — arrow-key-only input adapter.
- **`src/render/draw.ts`** — Canvas 2D renderer (board, active piece, ghost,
  next-piece preview). DPR-aware.
- **`src/main.ts`** — composition root that wires everything together.

## Browser Support

Any modern browser with Canvas and ES module support (Chrome, Firefox, Safari).
