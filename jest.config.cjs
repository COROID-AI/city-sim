/**
 * Jest configuration for the city-sim unit test suite.
 *
 * The unit tests live in `tests/unit/**`.
 *
 * Playwright e2e specs are explicitly excluded so Jest never tries to
 * parse Playwright's `test()` API as a Jest test.
 */
module.exports = {
  testEnvironment: 'jsdom',
  rootDir: '.',
  roots: ['<rootDir>/tests/unit', '<rootDir>/src'],
  testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
  testPathIgnorePatterns: [
    '<rootDir>/tests/e2e/',
    '<rootDir>/node_modules/',
    '<rootDir>/dist/',
    '<rootDir>/.next/',
    '<rootDir>/out/',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@/engine/utils$': '<rootDir>/src/engine/utils.ts',
    '^@/engine/types$': '<rootDir>/src/engine/types.ts',
    '^@/engine/(.*)$': '<rootDir>/src/engine/$1',
    '^@/ui/(.*)$': '<rootDir>/src/ui/$1',
  },
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2020',
          module: 'CommonJS',
          moduleResolution: 'Node',
          esModuleInterop: true,
          jsx: 'react-jsx',
          strict: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          isolatedModules: true,
          baseUrl: '.',
          paths: {
            '@/*': ['src/*'],
          },
        },
        diagnostics: { ignoreCodes: [151001] },
      },
    ],
  },
  collectCoverageFrom: [
    'src/systems/**/*.ts',
    'src/entities/**/*.ts',
    '!src/systems/**/*.d.ts',
    '!src/systems/**/index.ts',
    '!src/entities/**/index.ts',
    '!src/systems/CommuteDispatcher.ts',
    '!src/systems/SimEvents.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      statements: 80,
      branches: 70,
    },
    './src/systems/EconomySystem.ts': { lines: 80, functions: 60, statements: 80 },
    './src/systems/TimeSystem.ts': { lines: 80, functions: 80, statements: 80 },
    './src/systems/EventBus.ts': { lines: 80, functions: 60, statements: 80 },
    './src/systems/NeedSystem.ts': { lines: 80, functions: 80, statements: 80 },
  },
};
