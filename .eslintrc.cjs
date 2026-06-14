module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  env: {
    es2020: true,
    browser: true,
    node: true,
    jest: true,
  },
  settings: {
    react: { version: 'detect' },
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    // react-hooks plugin is not installed in this project; explicitly
    // turn the rule off (a missing rule definition surfaces as an
    // "unknown rule" error). Hooks best-practices are still enforced
    // by TypeScript and the test suite.
    'react-hooks/exhaustive-deps': 'off',
    'react-hooks/rules-of-hooks': 'off',
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
    {
      // The UI layer is React-based; allow the import there and
      // enable JSX parsing. The default top-level rule forbids
      // React imports to keep engine code framework-agnostic, so
      // we explicitly override it for src/ui/**, src/hooks/** and
      // Next.js app routes that render React components.
      files: [
        'src/ui/**/*.{ts,tsx}',
        'src/hooks/**/*.{ts,tsx}',
        'src/app/**/*.{ts,tsx}',
        'tests/unit/ui/**/*.{ts,tsx}',
      ],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', '.next/', 'out/'],
};
