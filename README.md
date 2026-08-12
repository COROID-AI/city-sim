# Snake

A classic, self-contained browser snake game built with vanilla HTML, CSS, and
JavaScript — no framework and no build step required.

## How to run

Open `index.html` directly in a browser (works over `file://`), or serve it
over HTTP for the full experience (needed for high-score persistence in some
browsers):

```sh
node server.mjs
# then open http://127.0.0.1:8000
```

The port can be overridden with the `PORT` environment variable. The server
binds to `127.0.0.1` only.

## How to play

- **Start**: click the Start button, or press `Space` / `Enter`.
- **Steer**: `Arrow` keys or `WASD`. On touch devices, swipe on the board or
  use the on-screen D-pad.
- **Pause / resume**: press `P` or `Space`, or click the Pause button. The game
  auto-pauses when the browser tab loses focus.
- **Objective**: eat the red food to grow and score. Don't hit the walls or
  your own body.

## Features

- **Fair input handling** — direction changes are queued and validated against
  the last *applied* direction, so quick double key presses can never reverse
  the snake onto itself or skip a needed turn.
- **Crisp, responsive canvas** — the board is `devicePixelRatio`-aware and
  re-renders on window resize, so it stays sharp on high-DPI displays.
- **Bounded progressive speed-up** — the game gets faster as you score, but the
  step interval is clamped to a sane minimum floor so it never becomes
  unplayable.
- **Resilient high-score persistence** — the best score is saved to
  `localStorage`, with every access wrapped in `try/catch` so restricted
  `file://` or privacy modes degrade gracefully instead of crashing the game.
- **Accessibility** — keyboard focus, labelled controls, a visible focus ring,
  and `prefers-reduced-motion` support.

## Files

- `index.html` — page structure, HUD, canvas, overlays, and D-pad.
- `styles.css` — responsive arcade visual design.
- `game.js` — all game logic (classic script, runs over both `http://` and
  `file://`).
- `server.mjs` — dependency-free Node static server for local verification.

## Verification

Both scripts pass `node --check`:

```sh
node --check game.js
node --check server.mjs
```
