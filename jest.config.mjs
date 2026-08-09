/**
 * Jest configuration for the Tetris game modules.
 *
 * Only the unit tests under `src/game/__tests__` and
 * `src/input/__tests__` are collected. The Vite entry point (`src/main.ts`,
 * which side-imports `src/game/loop`) and `vite.config.ts` are
 * intentionally ignored.
 */
const config = {
  testMatch: [
    '<rootDir>/src/game/__tests__/**/*.test.ts',
    '<rootDir>/src/input/__tests__/**/*.test.ts',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/src/main.ts',
    '<rootDir>/vite.config.ts',
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  clearMocks: true,
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        // The app tsconfig targets Vite (ESNext modules); Jest runs CommonJS,
        // so override the module settings for the test build only.
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node10',
          noEmit: false,
        },
      },
    ],
  },
};

export default config;