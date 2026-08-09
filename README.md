# Browser Tetris

A browser-based Tetris game built with Vite + TypeScript. Movement and
rotation are controlled with the arrow keys only.

## Current state — Foundation (scaffold + tetrominoes + board)

- Vite dev server with a placeholder page (`index.html` mounts a `#app` div
  and a `#canvas` element with ARIA attributes).
- Shared game types in `src/game/types.ts`: `Direction`, `Cell`,
  `TetrominoId`, `Tetromino`, `Board`, and `GameConfig`.
- The seven standard tetrominoes (I, O, T, S, Z, J, L) as four-state rotation
  arrays plus a `rotate(id, dir)` helper in `src/game/tetrominoes.ts`.
- Immutable board primitives in `src/game/board.ts`: `createBoard`,
  `inBounds`, `getCell`, `setCell`, `isRowFull`, `clearFullRows`.
- Jest unit tests for the tetromino and board modules.

## Scripts

| Command          | Description                          |
| ---------------- | ------------------------------------ |
| `npm install`    | Install dependencies                 |
| `npm run dev`    | Start the Vite dev server            |
| `npm run build`  | Type-check and create the production build |
| `npm test`       | Run the Jest unit tests              |

## Structure

```
src/
  main.ts              # Vite entry point (imports src/game/loop)
  game/
    loop.ts            # Game loop stub (implemented in a later phase)
    types.ts           # Shared game types
    tetrominoes.ts     # 7 tetrominoes + rotation states + rotate()
    board.ts           # Board primitives (create/set/get/clear)
    __tests__/         # Jest unit tests
```