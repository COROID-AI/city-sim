# Sprite assets

This directory holds the optional PNG sprites used by `src/engine/Renderer.ts`
to replace the procedural rectangle fallbacks. The renderer is designed to
work with no assets on disk: when a sprite is missing or fails to load
(network error, 404 in jsdom, offline build), the renderer falls back to
plain colored rectangles and never throws.

## Expected files

The renderer looks up sprites by key under `/assets/sprites/{key}.png` where
`{key}` is one of:

| Key         | Used for                                 |
|-------------|------------------------------------------|
| `ground`    | Base terrain tiles                       |
| `road`      | Road tiles                               |
| `water`     | Water tiles (placeholder for later)      |
| `park`      | Park / leisure tiles (placeholder)       |
| `lot`       | Vacant lots (placeholder)                |
| `building`  | Building footprint (unit-sized only)     |
| `citizen`   | Citizens (placeholder for later)         |

The URL base is exported as `SPRITE_BASE` from `src/engine/sprites.ts` and
can be overridden by callers (e.g. tests, theming) via
`tryLoadSprites(base)`.

## Resolution

The renderer is purely best-effort:

1. `tryLoadSprites()` walks the known keys and creates an `HTMLImageElement`
   for each.
2. On `load`, the atlas slot is populated; on `error`, the slot stays `null`.
3. The renderer checks each slot before drawing and falls back to the
   palette-colored procedural rectangle whenever the slot is null.

So **adding a sprite is an enhancement, not a requirement.** The simulation
renders correctly with this directory empty.
