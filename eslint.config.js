/**
 * ESLint flat config for the Tetris project.
 * ECMAScript 2023, sourceType module, recommended rules.
 * Targets src/ and tests/.
 */

import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/', 'dist/', 'coverage/'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': 'off',
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ['tests/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
