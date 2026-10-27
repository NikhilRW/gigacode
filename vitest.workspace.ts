import { defineWorkspace } from 'vitest/config';

// Two projects: fast unit tests (no infra) and integration tests (real Postgres, Redis, MinIO).
export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['packages/*/test/**/*.unit.test.ts', 'apps/{api,worker}/test/**/*.unit.test.ts'],
    },
  },
  {
    test: {
      name: 'integration',
      include: ['packages/*/test/**/*.int.test.ts', 'apps/{api,worker}/test/**/*.int.test.ts'],
      testTimeout: 60_000,
      hookTimeout: 60_000,
      fileParallelism: false,
    },
  },
]);
