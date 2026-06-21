import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextPlugin from 'eslint-plugin-react';
import nextHooks from 'eslint-plugin-react-hooks';
import nextCore from 'eslint-config-next';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', '.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      react: nextPlugin,
      'react-hooks': nextHooks,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: '18.3' },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
  // Next.js core-web-vitals rules (flat-config compatible subset)
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
  prettierConfig,
);
