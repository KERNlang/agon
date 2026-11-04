
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('keeps the built public declarations usable without source-path aliases', () => {
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc',
    '--ignoreConfig', '--strict', '--noEmit', '--skipLibCheck', 'false', '--module', 'NodeNext',
    '--target', 'ES2022', '--esModuleInterop', '--resolveJsonModule', '--types', 'node',
    'tests/fixtures/modular-brainstorm-engine-consumer.mts'], {
    encoding: 'utf8', timeout: 15_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
