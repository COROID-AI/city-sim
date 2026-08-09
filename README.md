# Browser Tetris

A browser-based Tetris game built with Vite + TypeScript. Movement and
rotation are controlled with the arrow keys only.

## Current state — Game logic (rules + state + arrow-key input)

- Vite dev server with a placeholder page (`index.html` mounts a `#app` div
  and a `#canvas` element with ARIA attributes).
- Shared game types in `src/game/types.ts`: `Direction`, `Cell`,
  `TetrominoId`, `Tetromino`, `Board`, `GameConfig`, plus `GameState`,
  `GameAction`, `Rotation`, `MoveDirection`, and `RNG`.
- The seven standard tetrominoes (I, O, T, S, Z, J, L) as four-state rotation
  arrays plus a `rotate(id, dir)` helper in `src/game/tetrominoes.ts`.
- Immutable board primitives in `src/game/board.ts`: `createBoard`,
  `inBounds`, `getCell`, `setCell`, `isRowFull`, `clearFullRows`.
- Pure rules in `src/game/rules.ts`: `canPlace`, `tryMove`, `tryRotate`
  (simple non-kick rotation with a one-cell nudge attempt), `lockPiece`
  (writes the piece, clears full rows, updates score/lines/level), and
  `applyGravity`.
- State management in `src/game/state.ts`: `createInitialState(config, rng)`,
  `spawnPiece(state, rng)`, and the `step(state, action, rng)` reducer
  handling `move`/`rotate`/`softDrop`/`hardDrop`/`tick`. All randomness
  flows through the injected `rng`, so tests are deterministic.
- Arrow-key input mapping in `src/input/keyboard.ts`: `mapKeyToAction(key)`
  maps the four arrow keys to move/rotate/soft-drop actions; any other key
  returns `null`.
- Jest unit tests for the tetromino, board, rules, state, and keyboard
  modules (including line-clear scoring, soft/hard drop scoring, game over
  on spawn collision, and non-arrow keys being ignored).

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
    rules.ts           # Pure rules: placement, move, rotate, lock, gravity
    state.ts           # Initial state, spawn, and step reducer
    __tests__/         # Jest unit tests
  input/
    keyboard.ts        # Arrow-key -> GameAction mapping
    __tests__/         # Jest unit tests
```