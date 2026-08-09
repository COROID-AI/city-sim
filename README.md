# Browser Tetris

A browser-based Tetris game built with Vite + TypeScript. The game renders to
a `<canvas>` and is controlled with the arrow keys only.

## Controls

| Key          | Action                            |
| ------------ | --------------------------------- |
| Arrow Up     | Rotate the piece clockwise        |
| Arrow Left   | Move the piece left               |
| Arrow Right  | Move the piece right              |
| Arrow Down   | Soft drop (1 point per cell)      |

Every other key is ignored. The current piece advances one row on its own
every `tickMs` (500 ms by default).

## Current state — playable render loop

- Vite entry point `src/main.ts` wires `createInitialState` / `step` from
  `src/game/state` with `mapKeyToAction` from `src/input/keyboard`, sizes the
  `#canvas` element from the render config, and runs a
  `requestAnimationFrame` loop that ticks gravity at `tickMs` intervals via an
  accumulator and calls `draw` every frame. A single `keydown` listener maps
  arrow keys to actions. The piece sequence comes from a deterministic
  seeded RNG (mulberry32), so every run plays the same game.
- Canvas renderer in `src/render/draw.ts`: `draw(ctx, state, config)` clears
  the canvas, paints every locked board cell with a color derived from the
  cell value, draws the current piece at `(x, y)` from its rotation matrix,
  shows the next-piece preview in a side panel, and renders a score/level/lines
  HUD. `draw` only writes through a minimal `DrawContext` interface
  (`fillRect`, `fillStyle`, `clearRect`, `font`, `fillText`), never touches
  the DOM, and is unit-tested with a mock context.
- Shared game types in `src/game/types.ts`: `Direction`, `Cell`,
  `TetrominoId`, `Tetromino`, `Board`, `GameConfig`, plus `GameState`,
  `GameAction`, `Rotation`, `MoveDirection`, and `RNG`.
- The seven standard tetrominoes (I, O, T, S, Z, J, L) as four-state rotation
  arrays plus a `rotate(id, dir)` helper in `src/game/tetrominoes.ts`.
- Immutable board primitives in `src/game/board.ts`: `createBoard`,
  `inBounds`, `getCell`, `setCell`, `isRowFull`, `clearFullRows`.
- Pure rules in `src/game/rules.ts`: `canPlace`, `tryMove`, `tryRotate`,
  `lockPiece` (writes the piece, clears full rows, updates score/lines/level),
  and `applyGravity`.
- State management in `src/game/state.ts`: `createInitialState(config, rng)`,
  `spawnPiece(state, rng)`, and the `step(state, action, rng)` reducer
  handling `move`/`rotate`/`softDrop`/`hardDrop`/`tick`. All randomness flows
  through the injected `rng`, so tests are deterministic.
- Jest unit tests for the tetromino, board, rules, state, keyboard, and
  renderer modules (including line-clear scoring, soft/hard drop scoring,
  game over on spawn collision, non-arrow keys being ignored, and expected
  `fillRect` calls for the current piece and locked cells), plus a state
  integration test that plays spawn -> hardDrop -> spawn -> rotate -> hardDrop.

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
  main.ts              # Vite entry point: wiring + requestAnimationFrame loop
  game/
    types.ts           # Shared game types
    tetrominoes.ts     # 7 tetrominoes + rotation states + rotate()
    board.ts           # Board primitives (create/set/get/clear)
    rules.ts           # Pure rules: placement, move, rotate, lock, gravity
    state.ts           # Initial state, spawn, and step reducer
    __tests__/         # Jest unit + integration tests
  input/
    keyboard.ts        # Arrow-key -> GameAction mapping
    __tests__/         # Jest unit tests
  render/
    draw.ts            # Canvas renderer (pure w.r.t. the draw context)
    __tests__/         # Jest unit tests
```