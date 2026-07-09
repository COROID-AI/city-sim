# Tetris

A standalone, browser-based Tetris game controlled **entirely with arrow keys**.

Built with vanilla HTML5 + CSS + ES modules — **no framework, no bundler, no runtime dependencies**. The same files the developer edits are what the browser loads. Just open `index.html` and play.

## How to Run

**Option 1 — Open directly:**
```
open index.html        # macOS
xdg-open index.html    # Linux
start index.html       # Windows
```

**Option 2 — Local server (recommended for module support):**
```bash
npm start
# or
npx serve .
```
Then visit `http://localhost:8080`.

> **Note:** Opening `index.html` via `file://` works in modern browsers, but a local server avoids any CORS quirks with ES modules.

## Controls

| Key | Action |
|-----|--------|
| **↑** | Rotate piece clockwise (with SRS wall-kicks) |
| **←** | Move piece left |
| **→** | Move piece right |
| **↓** | Soft drop (hold for faster fall) |

**Gameplay is arrow-key only.** Per the original constraint ("only using arrow keys to turn the blocks"), no other keys affect the falling piece.

| Key | Meta Action |
|-----|-------------|
| **Enter** | Pause / Resume, or Restart on game-over |

Enter is reserved for **out-of-game state management** only (pause, resume, restart). It never affects a piece in play. This distinction is documented in the on-screen legend.

## Scoring

Standard Tetris scoring, multiplied by the current level (level = 0-indexed):

| Lines Cleared | Base Points |
|---------------|-------------|
| 1 (Single)    | 100         |
| 2 (Double)    | 300         |
| 3 (Triple)    | 500         |
| 4 (Tetris)    | 800         |

**Score = base points × (level + 1)**

## Levels

- Every **10 lines cleared** increments the level.
- Gravity (fall speed) decreases as the level increases, per the configured table (800ms at level 0 down to 20ms at level 29+).

## Features

- **SRS Rotation** — Super Rotation System with full wall-kick tables for all pieces
- **7-Bag Randomizer** — guarantees no piece repeats before all 7 have appeared
- **Ghost Piece** — shadow showing where the piece will land
- **DAS** — held Left/Right auto-repeats (150ms initial delay, then 50ms repeat)
- **Soft Drop** — hold Down for a faster fall; release to return to normal gravity
- **High-DPI Rendering** — crisp on Retina displays via `devicePixelRatio` scaling
- **Responsive** — board scales down on mobile screens
- **Pause / Game Over Overlays** — with score display and restart hints

## Development

### Prerequisites
- Node.js ≥ 18 (for tests and lint; the game itself runs in any modern browser)

### Commands
```bash
npm test     # Run unit tests (node --test)
npm run lint # Run ESLint
```

### File Layout

```
.
├── index.html          # HTML5 shell: structure + script/module link
├── styles.css          # Dark-theme responsive styling
├── src/
│   ├── config.js       # Centralized constants (dimensions, colors, kick tables, gravity)
│   ├── tetrominoes.js  # 7 pieces, 4 rotation states each, 7-bag factory
│   ├── board.js        # Pure board model (grid, validation, lock, clear)
│   ├── game.js         # Core rules (spawn, move, rotate, step, score, game-over)
│   ├── renderer.js     # Canvas 2D drawing (board, piece, ghost, preview)
│   ├── input.js        # Arrow-key handler with DAS + soft-drop
│   ├── loop.js         # requestAnimationFrame loop with dt cap
│   ├── ui.js           # DOM updates (stats, next-piece, overlays)
│   └── main.js         # Bootstrap: wires everything together
├── tests/
│   └── game.test.mjs   # node --test covering pure logic
├── package.json        # Minimal manifest (ESLint only devDep)
└── eslint.config.js    # ESLint v9 flat config
```

## No External Runtime Dependencies

The game ships **zero runtime dependencies**. It is plain ES modules loaded directly by the browser. The only devDependency is ESLint (for linting), and tests use Node's built-in `node --test` runner. There is no build step.

## Browser Support

Targets evergreen browsers (Chrome, Firefox, Safari, Edge — last 2 years) with native ES module and Canvas2D support.
