import globals from 'globals';
import react from 'eslint-plugin-react';

const rules = {
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-undef': 'error',
  'no-constant-condition': 'warn',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-self-assign': 'error',
  'no-unreachable': 'warn',
};

export default [
  {
    // public/ is not ignored wholesale any more: everything in it except sw.js
    // is a static asset that no `files` pattern matches, so it is never linted,
    // while sw.js now is. (ESLint cannot un-ignore a file inside an ignored
    // directory, so the blanket public/** ignore had to go.)
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.{js,jsx}', 'server/**/*.js', 'scripts/**/*.mjs'],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: { ...rules, 'react/jsx-uses-vars': 'error' },
  },
  {
    // The service worker runs in a different global scope (`self`, `clients`,
    // `registration`) and used to be excluded from every check, so a typo in it
    // would only ever surface as a push that silently did nothing.
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.serviceworker,
      },
    },
    rules,
  },
];
