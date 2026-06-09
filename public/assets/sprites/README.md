# Sprite assets

Drop optional PNG sprites into this folder. The renderer's
`SpriteLoader` looks for files named `{id}.png` (e.g. `citizen.png`,
`vehicle.png`, `tree.png`).

If a file is missing, the loader falls back to a small procedurally
generated icon so the simulation always renders. This means the
sprites directory may legitimately be empty in CI and during local
development — the app will look slightly different (procedural
shapes) but the simulation will work.

Supported dimensions: any, but 16×16 or 32×32 are recommended so the
existing draw size still looks correct on retina screens.

The folder is committed as empty; if you add art, please also commit
the PNGs in a follow-up PR. The renderer does not preload sprites.
