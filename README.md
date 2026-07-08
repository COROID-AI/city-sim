# Tetris

A browser-based Tetris game controlled entirely with the arrow keys, plus Space
for a hard drop. No frameworks, no build-time server, no external dependencies —
just TypeScript compiled to native ES modules.

## Controls

| Key | Action |
| --- | ------ |
| &larr; / &rarr; | Move the block left / right |
| &uarr; | Turn (rotate) the block |
| &darr; | Soft drop (one cell) |
| **Space** | Hard drop (instantly lock) |

Arrow keys and Space are the only inputs; no other key triggers a game action.

## Getting Started

Install dependencies:

```bash
npm install
```

Build the TypeScript source:

```bash
npm run build
```

Run the tests:

```bash
npm test
```

Play the game: build first, then open `index.html` in any modern evergreen
browser (it loads `/dist/main.js` as a native ES module).

## Architecture

```
.
├── index.html              # Game page: board canvas, next-piece preview, stats
├── src/
│   ├── main.ts             # Bootstraps the renderer, input, and loop
│   ├── input/
│   │   └── keyboard.ts     # Arrow keys + Space → Action queue (preventDefault)
│   ├── render/
│   │   └── draw.ts         # Pure Canvas drawing (board, piece, grid, overlay)
│   └── game/
│       ├── board.ts        # Playfield primitives (bounds, collision, line clear)
│       ├── tetrominoes.ts  # SRS tetromino shapes and colours
│       ├── rules.ts        # move/rotate/lock rules, wall kicks
│       ├── state.ts        # GameState + applyAction reducer (7-bag randomiser)
│       └── loop.ts         # requestAnimationFrame fixed-timestep gravity loop
├── tsconfig.json           # TypeScript config (strict, ES2020, DOM)
├── jest.config.mjs         # ts-jest preset, jsdom environment
└── package.json
```

The game logic (`src/game/*`) is pure and free of browser APIs, so it is fully
unit-testable. The renderer and input layers are thin adapters around the DOM.
