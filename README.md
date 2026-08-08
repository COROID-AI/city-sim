# Browser Tetris

A browser-based Tetris game built with Vite, TypeScript, and Jest.

Current phase: **Foundation** — project scaffold plus the core Tetris
primitives (tetromino definitions and the board model).

## Scripts

| Command           | Description                                          |
| ----------------- | ---------------------------------------------------- |
| `npm run dev`     | Start the Vite dev server                            |
| `npm run build`   | Type-check with `tsc` and build into `dist/`         |
| `npm run preview` | Preview the production build                         |
| `npm test`        | Run the Jest unit tests for the game modules         |

## Project structure

```
.
├── index.html           # App shell: #app div + #canvas (ARIA-labeled)
├── vite.config.ts       # Vite config (static build output in dist/)
├── jest.config.mjs      # Jest config (tests under src/game/__tests__)
├── tsconfig.json        # TypeScript config (ES2020, Vite-friendly)
└── src
    ├── main.ts          # Entry point; imports the game loop module
    └── game
        ├── loop.ts      # Game loop placeholder (implemented later)
        ├── types.ts     # Shared types: Direction, Cell, TetrominoId,
        │                #   Tetromino, Board, GameConfig
        ├── tetrominoes.ts  # The 7 standard pieces + rotate(id, dir)
        ├── board.ts     # Board helpers (createBoard, clearFullRows, ...)
        └── __tests__    # Jest tests for tetrominoes and board
```

## Game modules

- `src/game/types.ts` — shared types consumed by the other game modules.
- `src/game/tetrominoes.ts` — a `TETROMINOES` record with four rotation
  states per piece and a `rotate(id, dir: 1 | -1)` helper.
- `src/game/board.ts` — immutable board helpers: `createBoard`, `inBounds`,
  `getCell`, `setCell`, `isRowFull`, `clearFullRows`.

## Dependency manifest

The scaffold intentionally keeps its dependency manifest minimal: only
TypeScript, Vite, Jest, and the Jest TypeScript transformer (`ts-jest`).
