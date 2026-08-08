/**
 * Jest configuration for the Browser Tetris project.
 *
 * - `roots` + `testMatch` restrict Jest to the `__tests__` directories under
 *   `src/`, and `testPathIgnorePatterns` additionally excludes the Vite entry
 *   (src/main.ts) and the Vite config, so the Vite entry is never run by Jest.
 * - `transform` uses ts-jest to compile and type-check the TypeScript game
 *   modules before running the tests.
 */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/src/main.ts',
    '<rootDir>/vite.config.ts',
  ],
  transform: {
    '^.+\\.ts$': ['ts-jest', {}],
  },
};