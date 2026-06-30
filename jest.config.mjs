/**
 * Jest configuration.
 *
 * Uses ts-jest for TypeScript transpilation and the jsdom test environment
 * so React Three Fiber / browser globals are available during unit tests.
 * The `@/` path alias mirrors tsconfig.json.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  collectCoverageFrom: [
    'src/store/**/*.ts',
    'src/engine/**/*.ts',
    'src/systems/**/*.ts',
    '!**/*.test.ts',
    '!**/*.test.tsx',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
