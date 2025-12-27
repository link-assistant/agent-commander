import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        globalThis: 'readonly',
        fetch: 'readonly',
        Deno: 'readonly',
        AbortController: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        Uint8Array: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
];
