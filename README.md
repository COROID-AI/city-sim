# Snake

A polished, zero-build browser snake game written in vanilla HTML/CSS/JavaScript with a canvas renderer. No bundler, no framework, no external runtime dependencies — it loads directly in any modern browser.

## Running

```sh
npm start      # or: npm run dev
```

The game is then served at `http://127.0.0.1:3000` (the port comes from `process.env.PORT`, default `3000`).

You can also just open `index.html` in a browser — the game runs with no server at all.

## How to play

- **Steer** — Arrow keys or WASD (a 180-degree reversal is ignored).
- **Pause / resume** — Space (or the Resume button); Enter also resumes.
- **Start / restart** — Enter or Space on the start and game-over screens, or click Start Game / Play Again.
- **Touch devices** — on-screen D-pad buttons and swipe gestures on the playfield.
- **High score** — persisted across reloads via `localStorage`.

Eat the food to grow and score. Each level (every 3 foods) makes the snake move faster, up to a maximum speed. The game ends when the snake hits a wall or itself — or you win by filling the board.

## Accessibility

- All controls are real focusable `<button>` elements with visible focus outlines.
- Keyboard input is handled on `window`, and the playfield is a focusable `role="application"` surface.
- An ARIA live region announces score milestones and state changes.
- `prefers-reduced-motion` disables button transitions.

## Files

- `index.html` / `styles.css` / `game.js` — the game itself
- `server.js` — zero-dependency Node static server
- `package.json` — `npm start` / `npm run dev` scripts