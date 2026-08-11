# Tetris

A web-based Tetris game built with TypeScript + Vite. All assets are local —
nothing is fetched from a CDN.

## Play

```
npm install
npm run dev      # local dev server
npm run build    # type-check + production build to dist/
npm run preview  # serve the production build
npm test         # run the unit test suite (Vitest)
```

## Controls

| Key | Action |
| --- | --- |
| ← / → (or A / D) | Move (DAS 170 ms, ARR 50 ms) |
| ↓ (or S) | Soft drop |
| Space | Hard drop |
| ↑ / X | Rotate clockwise |
| Z | Rotate counter-clockwise |
| C / Shift | Hold |
| P / Esc | Pause |
| Enter | Start / restart |

## Rules

- **SRS rotation with the published Guideline wall-kick tables.** Pieces rotate
  inside their bounding boxes (4×4 for I, 3×3 for J/L/S/T/Z, 2×2 for O) and
  the kick tables slide the box against walls, floors, and stacks. Kicks are
  stored in the Guideline y-up frame and negated when applied to the
  row-space board. Inverse kick pairs are exact negations, so a CW rotation
  followed by CCW is always lossless in free space. A rotation that finds no
  valid kick leaves the piece unchanged (it never clips).
- **7-bag randomizer** — every bag is a fresh permutation of the seven
  tetrominoes; no droughts or repeats across bag boundaries.
- **Scoring** — Guideline singles/doubles/triples/tetrises (100/300/500/800
  × level), +1 per soft-dropped row, +2 per hard-dropped row.
- **Gravity** — 1000 ms/row at level 1, ×0.85 per level, floor 40 ms. Levels
  up every 10 lines.
- **Lock delay** — 500 ms, reset by successful player moves/rotations, capped
  at 15 resets per grounding so a piece can never stall forever.
- **Hold** — once per piece; the hold slot returns after the piece locks.
- **Ghost piece**, **Next 3** preview, **line-clear flash** (skipped under
  `prefers-reduced-motion`), **auto-pause** when the tab is hidden.
- **Game over** — block-out (spawn collision) or lock-out (a piece locks fully
  above the visible field).

## Rendering

The board, hold, and next panels are drawn on `<canvas>` with crisp
beveled blocks: light top/left edges, dark bottom/right edges, a top sheen,
and a 1 px outline per block, over a dark field with a faint grid. The canvas
is scaled for `devicePixelRatio` (capped at 2×) so blocks stay sharp on
retina displays. No icon fonts, no external images, no CDN requests.

## Architecture

```
src/
  game/
    types.ts        DOM-free shared types
    constants.ts    dimensions, palette, timing, scoring tables
    tetrominoes.ts  spawn shapes + canonical rotation states
    board.ts        board grid, collision, line clears, ghost drop
    srs.ts          published SRS wall-kick tables + rotation resolver
    bag.ts          7-bag randomizer
    scoring.ts      Guideline scoring + gravity curve
    engine.ts       frame-rate independent game engine (lock delay etc.)
    input.ts        DAS/ARR auto-repeat + keyboard wiring
    renderer.ts     beveled canvas renderer (board/hold/next)
    storage.ts      high score persistence (localStorage)
  main.ts           app bootstrap + HUD + overlay + rAF loop
  style.css         dark theme (system-font only)
tests/              Vitest suites: bag, board, scoring, srs, engine, input
```

The game core (`src/game/*`) is DOM-free so the entire rules engine — SRS
kicks, 7-bag, lock delay, scoring, DAS/ARR timing — is unit tested in Node.