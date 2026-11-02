import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', 'apps/expo/**', 'apps/web/playwright-report/**', '.github/native-sim/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-eval': 'error',
      'no-restricted-imports': ['error', { paths: ['vm', 'node:vm', 'vm2', 'isolated-vm'] }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
