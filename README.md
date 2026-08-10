# Tetris

A web-based Tetris game built with vanilla ES modules and Vite. The game
engine is a pure, DOM-free module so it can be unit-tested in Node.

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run build    # production build -> dist/
npm run test:engine  # run the engine unit tests
```

## Controls

| Key            | Action                          |
| -------------- | ------------------------------- |
| ← / →          | Move left / right (DAS + ARR)   |
| ↓              | Soft drop                       |
| ↑ or X         | Rotate clockwise                |
| Z or Ctrl      | Rotate counter-clockwise        |
| Space          | Hard drop                       |
| C or Shift     | Hold                             |
| Enter          | Start / pause / restart         |
| P or Esc       | Pause / resume                  |

On touch devices, on-screen controls are shown for the same actions.

## Features

- All 7 tetrominoes (I, O, T, S, Z, J, L) in the classic guideline colors,
  dealt by a correct 7-bag randomizer.
- Full SRS rotation with wall kicks (separate kick tables for I and JLSTZ).
- Ghost piece, hold (once per piece), and a 5-piece next preview.
- Line clears (single / double / triple / tetris) scored × level, with a
  level-up every 10 lines and accelerating gravity.
- Smooth DAS/ARR keyboard movement, hard/soft drop, pause, and game over.

## Architecture

- `src/constants.js` — board size, tetromino shapes, SRS kick tables, colors,
  scoring, gravity, DAS/ARR tuning (DOM-free).
- `src/tetris.js` — pure game engine (DOM-free, Node-importable).
- `src/renderer.js` — DPR-aware canvas rendering (board, ghost, previews).
- `src/input.js` — keyboard (DAS/ARR) and touch input.
- `src/ui.js` — overlays, stats, and previews.
- `src/main.js` — wiring and the requestAnimationFrame loop.
- `test/engine.test.mjs` — Node unit tests for the engine.
