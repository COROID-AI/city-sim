# Simple Tetris

A dependency-free, browser-based Tetris clone. No build step, no CDN, no
external libraries — just classic HTML, CSS, and JavaScript with an HTML5
canvas.

## Run it

Open `index.html` directly in a browser (`file://`), or serve the folder over
HTTP and visit it:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

The game starts immediately on load.

## Controls

| Action      | Keyboard                              | On-screen |
| ----------- | ------------------------------------- | --------- |
| Move        | &#8592; / &#8594;                     | Buttons   |
| Rotate CW   | &#8593; or X                          | Button    |
| Soft drop   | &#8595;                               | Button    |
| Hard drop   | Space                                 | Button    |
| Pause       | P                                     | Button    |
| Restart     | R                                     | Button    |

## Features

- 10 x 20 playfield; all 7 standard tetrominoes (I, O, T, S, Z, J, L), each
  with a distinct color, dealt from a 7-bag.
- Move, clockwise rotation with wall/floor kicks, soft drop, and hard drop.
- 7-bag next-piece preview and a ghost piece showing the landing position.
- Line clears with standard scoring (1/2/3/4 lines = 100/300/500/800 x level);
  level rises every 10 lines and gravity speeds up with the level.
- Pause, restart, and game-over detection (top-out) with restart.

## Tests

The engine (`tetris.js`) is dependency-free and runs under Node's built-in
test runner:

```sh
npm test
```

## Structure

- `tetris.js` — pure engine: shapes, rotation states, collision, merge, line
  clearing, scoring/leveling, 7-bag spawning, game-over. UMD-lite export
  (`window.Tetris` in the browser, `module.exports` in Node).
- `main.js` — canvas rendering, responsive sizing, keyboard + button input,
  and the requestAnimationFrame game loop.
- `index.html` / `styles.css` — page shell and layout.
- `test/tetris.test.js` — unit tests for the engine.