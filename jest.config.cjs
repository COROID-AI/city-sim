/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2020',
          module: 'CommonJS',
          moduleResolution: 'node',
          ignoreDeprecations: '6.0',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          lib: ['ES2020', 'DOM'],
          baseUrl: '.',
          paths: { '@/*': ['src/*'] },
          types: ['jest', 'node'],
        },
        isolatedModules: true,
      },
    ],
  },
};
