import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';

export default [
  js.configs.recommended,
  prettierConfig,
  {
    files: ['**/*.js', '**/*.mjs'],
    plugins: {
      prettier: prettierPlugin,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        // Node.js 18+ globals
        fetch: 'readonly',
        // Runtime-specific globals
        Bun: 'readonly',
        Deno: 'readonly',
        // Additional globals used in this project
        globalThis: 'readonly',
        AbortController: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        Uint8Array: 'readonly',
      },
    },
    rules: {
      // Prettier integration
      'prettier/prettier': 'error',

      // Code quality rules
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-debugger': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],

      // Best practices
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-arrow-callback': 'error',
      'no-duplicate-imports': 'error',

      // ES6+ features
      'arrow-body-style': ['error', 'as-needed'],
      'object-shorthand': ['error', 'always'],
      'prefer-template': 'error',

      // Async/await
      'no-async-promise-executor': 'error',
      'require-await': 'warn',

      // Comments and documentation
      'spaced-comment': ['error', 'always', { markers: ['/'] }],

      // Complexity rules
      complexity: ['warn', 15],
      'max-depth': ['warn', 5],
      'max-lines-per-function': [
        'warn',
        {
          max: 150,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      'max-params': ['warn', 6],
      'max-statements': ['warn', 60],
      'max-lines': ['error', 1500],
    },
  },
  {
    files: ['test/**/*.js', 'test/**/*.mjs', '**/*.test.js', '**/*.test.mjs'],
    rules: {
      'require-await': 'off',
    },
  },
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      '*.min.js',
      '.eslintcache',
    ],
  },
];
