import js from '@eslint/js'
import globals from 'globals'

export default [
  { ignores: ['node_modules/', 'data/', 'dist/', 'public/vendor/', 'apps/'] },
  js.configs.recommended,
  { languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node } },
  { files: ['public/**/*.js'], languageOptions: { globals: { ...globals.browser, Hls: 'readonly', cast: 'readonly', chrome: 'readonly' } } },
  { files: ['e2e/**/*.js'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  { files: ['public/sw.js'], languageOptions: { globals: globals.serviceworker } },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: globals.node } },
  { rules: { 'no-empty': ['error', { allowEmptyCatch: true }], 'no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_' }] } }
]
