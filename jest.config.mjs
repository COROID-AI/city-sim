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
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
          esModuleInterop: true,
          module: 'commonjs',
          target: 'ES2020',
          moduleResolution: 'node',
          skipLibCheck: true,
          strict: true,
          paths: { '@/*': ['./src/*'] },
        },
        diagnostics: false,
      },
    ],
  },
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  collectCoverageFrom: [
    'src/config/years.ts',
    'src/store/**/*.ts',
    'src/utils/**/*.ts',
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
