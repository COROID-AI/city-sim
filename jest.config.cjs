/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': '<rootDir>/jest.style-mock.cjs',
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
          lib: ['dom', 'dom.iterable', 'esnext'],
          moduleResolution: 'node',
          skipLibCheck: true,
          strict: true,
          paths: {
            '@/*': ['./src/*'],
          },
          baseUrl: '.',
        },
      },
    ],
  },
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/', '<rootDir>/dist/'],
  collectCoverageFrom: ['src/engine/**/*.ts', 'src/systems/**/*.ts'],
};

module.exports = config;
