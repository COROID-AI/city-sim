# Tetris

A browser-based Tetris game controlled entirely with the arrow keys.

## Controls

| Key | Action |
| --- | ------ |
| &larr; / &rarr; | Move the block left / right |
| &uarr; | Turn (rotate) the block |
| &darr; | Soft drop |

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

Play the game: open `index.html` in your browser (after building).

## Project Structure

```
.
├── index.html        # Game page: canvas#board + arrow-key instructions
├── src/
│   └── main.ts       # Entrypoint: loads the game module and starts the loop
├── tsconfig.json     # TypeScript config (strict, ES2020, DOM)
├── jest.config.mjs   # ts-jest preset, jsdom environment
└── package.json
```
