# Tetris

A web-based Tetris game. Vanilla HTML/CSS/Canvas with ES modules and zero
dependencies — no build step, no framework, no package downloads.

## Run

```sh
npm run dev
```

Then open <http://127.0.0.1:8080/>. The app is served over HTTP by the bundled
zero-dependency static server (`server.js`) because ESM module scripts can fail
to load from `file://` URLs in some browsers. Set `PORT` to change the port.

## Controls

| Key | Action |
| --- | --- |
| ← / → or A / D | Move piece |
| ↓ or S | Soft drop (1 point per cell) |
| Space | Hard drop (2 points per cell) |
| ↑ / X / W | Rotate clockwise |
| Z | Rotate counter-clockwise |
| C | Hold / swap piece |
| P / Esc | Pause / resume |
| Enter | Start / restart |

## Gameplay

- **7-bag randomizer** — every bag of seven pieces contains one of each
  tetromino before any repeats.
- **SRS rotation** — standard Tetris Guideline rotation states and wall-kick
  tables (tetris.wiki/SRS) for all JLSTZ and I-piece transitions; O never
  rotates.
- **Ghost piece**, **next preview** (3 pieces) and **hold** (disabled
  immediately after use, re-enabled on the next spawn).
- **Scoring** — single/double/triple/tetris = 100/300/500/800 × level, plus
  soft/hard drop bonuses.
- **Levels** — level increases every 10 lines; gravity ramps up each level.
- **Game over** — when a new piece cannot spawn; final score is shown with an
  immediate restart option.

## Development

```sh
npm run check   # syntax-check every JS file (node --check)
npm test        # unit tests (node --test, no dependencies)
```

## Architecture

| Module | Responsibility |
| --- | --- |
| `src/constants.js` | Shared rules: board size, colors, scoring, gravity curve |
| `src/tetrominoes.js` | Piece definitions, SRS rotation states + kick tables, 7-bag |
| `src/board.js` | Pure board primitives: collision, lock, line clear, ghost drop |
| `src/game.js` | DOM-free game state machine: movement, rotation, scoring, hold, game over |
| `src/renderer.js` | Canvas rendering: board, ghost, active piece, previews |
| `src/input.js` | Keyboard mapping |
| `src/main.js` | Browser wiring: rAF loop, HUD, overlays, buttons |
| `server.js` | Zero-dependency static file server |

The logic modules (`constants`, `tetrominoes`, `board`, `game`) never touch the
DOM, so they are fully exercised by `node --test` and reused by the browser
without branching.