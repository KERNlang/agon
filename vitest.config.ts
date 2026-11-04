import { defineConfig } from 'vitest/config';
import { availableParallelism } from 'node:os';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    testTimeout: 30_000,
    // Bound filesystem-heavy suites without reducing concurrency inside tests.
    maxWorkers: Math.min(8, availableParallelism()),
    // Filesystem-heavy teardown can remove thousands of fixture files. Keep
    // hooks on the same explicit budget as tests so full-suite I/O load does
    // not turn successful assertions into teardown flakes.
    hookTimeout: 30_000,
    setupFiles: ['./tests/setup.ts'],
  },
});
