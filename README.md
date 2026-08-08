# Browser Tetris

A browser-based Tetris game built with Vite, TypeScript, and Jest.

Current phase: **Playable render loop** — the canvas renderer, the
`requestAnimationFrame` loop, and keyboard input are wired up so the game is
fully playable in the browser.

## Controls

The piece is driven entirely by the arrow keys:

| Key            | Action                       |
| -------------- | ---------------------------- |
| `ArrowUp`      | Rotate the piece clockwise   |
| `ArrowLeft`    | Move the piece left          |
| `ArrowRight`   | Move the piece right         |
| `ArrowDown`    | Soft drop (1 point per cell) |

The piece falls on its own over time (gravity tick). Line clears and soft/hard
drop points add to your score.

## Scripts

| Command           | Description                                          |
| ----------------- | ---------------------------------------------------- |
| `npm run dev`     | Start the Vite dev server                            |
| `npm run build`   | Type-check with `tsc` and build into `dist/`         |
| `npm run preview` | Preview the production build                         |
| `npm test`        | Run the Jest unit and integration tests              |

## Project structure

```
.
├── index.html           # App shell: #canvas (ARIA-labeled)
├── vite.config.ts       # Vite config (static build output in dist/)
├── jest.config.mjs      # Jest config (tests under src/**/__tests__)
├── tsconfig.json        # TypeScript config (ES2020, Vite-friendly)
└── src
    ├── main.ts          # Entry point; wires input, state, and render loop
    ├── game
    │   ├── state.ts     # Reducer: createInitialState, step, spawnPiece
    │   ├── loop.ts      # Game loop placeholder
    │   ├── types.ts     # Shared types: Direction, Cell, TetrominoId,
    │   │                #   Tetromino, Board, GameConfig, GameState
    │   ├── tetrominoes.ts  # The 7 standard pieces + rotate(id, dir)
    │   ├── board.ts     # Board helpers (createBoard, clearFullRows, ...)
    │   ├── rules.ts     # canPlace, tryMove, tryRotate, lockPiece, ...
    │   └── __tests__    # Jest tests for the game modules
    ├── input
    │   └── keyboard.ts  # mapKeyToAction: KeyboardEvent.key -> action
    └── render
        ├── draw.ts      # draw(ctx, state, config): canvas renderer
        └── __tests__    # Jest tests for the renderer
```

## Game modules

- `src/game/types.ts` — shared types consumed by the other game modules.
- `src/game/state.ts` — the `step(state, action, rng)` reducer plus
  `createInitialState` and `spawnPiece`.
- `src/game/tetrominoes.ts` — a `TETROMINOES` record with four rotation
  states per piece and a `rotate(id, dir: 1 | -1)` helper.
- `src/game/board.ts` — immutable board helpers: `createBoard`, `inBounds`,
  `getCell`, `setCell`, `isRowFull`, `clearFullRows`.
- `src/game/rules.ts` — `canPlace`, `tryMove`, `tryRotate`, `lockPiece`,
  `applyGravity`.
- `src/input/keyboard.ts` — `mapKeyToAction(key)` maps arrow keys to actions.
- `src/render/draw.ts` — `draw(ctx, state, config)` paints the locked board,
  the current piece, the next-piece preview, and the score/level/lines HUD.
  It takes a minimal `DrawContext` interface so it can be tested with a mock.

## Dependency manifest

The scaffold intentionally keeps its dependency manifest minimal: only
TypeScript, Vite, Jest, and the Jest TypeScript transformer (`ts-jest`).
