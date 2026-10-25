// Lint rules (npm run lint). Type-aware rules need TypeScript's compiler API, which
// TypeScript 7 no longer ships, so `typescript` is pinned to 6.0.3 until typescript-eslint supports 7.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'docs/', '.playwright-mcp/', '.superpowers/'] },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    // `const { dropped: _x, ...rest } = obj` is how this codebase omits a key.
    rules: { '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }] },
  },
  { files: ['src/**'], languageOptions: { globals: globals.browser } },
  { files: ['tests/**', 'vite.config.ts', 'eslint.config.js'], languageOptions: { globals: globals.node } },
  // The build fills in __VERSION__ and __FILES__ (see the offline plugin in vite.config.ts).
  { files: ['src/sw.js'], languageOptions: { globals: { ...globals.serviceworker, __VERSION__: 'readonly', __FILES__: 'readonly' } } },
  {
    files: ['src/**/*.tsx'],
    // Only the classic hook rules: the plugin's v7 preset adds React Compiler rules this app doesn't use.
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
);
