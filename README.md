# Tetris (Browser)

A standalone, browser-based Tetris game. Open `index.html` directly with your
browser (`file://`) or serve the folder over HTTP — no build step, no external
dependencies, no CDN resources.

## Controls (arrow keys only)

- **◀ / ▶** — move the falling piece left / right
- **▲** — rotate the piece clockwise (with SRS wall kicks)
- **▼** — soft drop (accelerate descent; +1 point per cell)

The first arrow key press starts the game. When the game is over, any arrow
key restarts it. Arrow keys never scroll the page.

## Rules

- Standard 10×20 board and all seven tetrominoes.
- Pieces come from a 7-bag randomizer (each bag contains every piece once).
- Gravity speeds up as the level rises.
- Full rows clear for 100/300/500/800 × level (1/2/3/4 lines).
- Level increases every 10 cleared lines.
- The game ends when a new piece cannot spawn.

## Files

- `tetris-core.js` — pure, dependency-free game logic (works in Node and the
  browser via a UMD wrapper).
- `game.js` — browser runtime: rendering, input, and the game loop.
- `index.html`, `style.css` — page structure and styling.
- `tests/tetris-core.test.js` — unit tests for the core logic.

## Running the tests

```sh
npm test
# or, equivalently:
node --test
```

(Note: this sandbox's Node build requires a file or glob argument, or no
argument at all, for the test runner — a bare `node --test tests/` directory
argument is treated as an entry point here. `node --test` auto-discovers the
tests under `tests/`.)

The tests cover rotation and wall kicks, collision, movement bounds, line
clearing, scoring/level progression, 7-bag integrity, lock, and game-over
detection.
