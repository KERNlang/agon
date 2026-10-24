import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps scoring and parsing algorithms in the physical Brainstorm owner', () => {
  const runtime = readFileSync(new URL('../../packages/mod-brainstorm/src/runtime.ts', import.meta.url), 'utf8');
  const legacy = readFileSync(new URL('../../packages/forge/src/brainstorm.ts', import.meta.url), 'utf8');
  expect(runtime).toContain('createBrainstormScoring');
  for (const name of ['structuralScore', 'scoutScore', 'assignStances', 'fallbackParse']) {
    expect(legacy).not.toContain(`function ${name}(`);
  }
  expect(legacy).not.toContain('rawBid * 0.3');
  const policy = readFileSync(new URL('../../packages/mod-brainstorm/src/policy.ts', import.meta.url), 'utf8');
  expect(policy).not.toMatch(/from ['"][^'"]*(?:agon-core|agon-forge|\/core\/|\/forge\/|\/cli\/)/);
});
