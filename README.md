# Tetris

A browser-based Tetris game built with **Vite**, **TypeScript**, and **Jest**.

Player input is intentionally limited to the four arrow keys:

- **← / →** — move the active piece left/right
- **↓** — soft drop
- **↑** — rotate

## Architecture

| Path                  | Responsibility                                             |
| --------------------- | ---------------------------------------------------------- |
| `src/game/types.ts`   | Core data types (`Direction`, `Cell`, `Tetromino`, `Board`) |
| `src/game/tetrominoes.ts` | The 7 standard tetrominoes + `rotate` helper           |
| `src/game/board.ts`   | Pure board operations (`createBoard`, `clearFullRows`, …)  |
| `src/main.ts`         | Browser entry point (canvas bootstrap)                      |

The game-logic modules (`types.ts`, `tetrominoes.ts`, `board.ts`) are **pure**:
no DOM, no randomness, no I/O. This keeps them fast to unit-test with Jest.

## Scripts

| Script            | Description                              |
| ----------------- | ---------------------------------------- |
| `npm run dev`     | Start the Vite dev server                |
| `npm run build`   | Type-check and build for production      |
| `npm test`        | Run the Jest test suite                  |
| `npm run preview` | Preview the production build locally     |

## Getting started

```bash
npm install
npm run dev
```
