import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('assembles Brainstorm once in its physical mod, leaving only host effects in forge', () => {
  const legacy = readFileSync(new URL('../../packages/forge/src/brainstorm.ts', import.meta.url), 'utf8');
  expect(legacy).toContain('createBrainstormRuntime');
  for (const factory of ['createBrainstormWorkflow', 'createBrainstormCollector', 'createBrainstormScout', 'createBrainstormScoring']) {
    expect(legacy.includes(factory)).toBe(false);
  }
  const runtime = readFileSync(new URL('../../packages/mod-brainstorm/src/runtime.ts', import.meta.url), 'utf8');
  expect(runtime).not.toMatch(/from ['"][^'"]*(?:agon-core|agon-forge|\/core\/|\/forge\/|\/cli\/)/);
});
