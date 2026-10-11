import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('assembles Brainstorm once in its physical mod, leaving only host effects in forge', () => {
  const legacy = readFileSync(new URL('../../packages/forge/src/brainstorm.ts', import.meta.url), 'utf8');
  expect(legacy).toContain('createBrainstormRuntime');
  expect(legacy).toContain('createBrainstormEngineServices');
  expect(legacy).not.toMatch(/selectSeat:|selectWinner:|preflight:|updateRatings:|dispatchSeatWithRetry|\.adapter\.dispatch/);
  for (const factory of ['createBrainstormWorkflow', 'createBrainstormCollector', 'createBrainstormScout', 'createBrainstormScoring']) {
    expect(legacy.includes(factory)).toBe(false);
  }
  const runtime = readFileSync(new URL('../../packages/mod-brainstorm/src/runtime.ts', import.meta.url), 'utf8');
  expect(runtime).not.toMatch(/from ['"][^'"]*(?:agon-core|agon-forge|\/core\/|\/forge\/|\/cli\/)/);
});

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
