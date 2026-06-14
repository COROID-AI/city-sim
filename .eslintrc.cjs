module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  env: {
    es2020: true,
    browser: true,
    node: true,
    jest: true,
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['react', 'react-dom'],
            message: 'Engine layer must remain framework-agnostic.',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ['src/engine/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['react', 'react-dom', '@/components/*', '@/hooks/*', '@/app/*'],
                message: 'src/engine must not import from React, components, hooks, or app.',
              },
            ],
          },
        ],
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', '.next/', 'out/'],
};
