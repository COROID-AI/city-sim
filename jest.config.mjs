/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Only run *.test.ts files under src/ — the Vite entry (src/main.ts) is ignored.
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        // Use a CommonJS tsconfig so Jest (which is not native-ESM here) can
        // load the compiled tests, while tsconfig.json stays Vite-friendly.
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
};
