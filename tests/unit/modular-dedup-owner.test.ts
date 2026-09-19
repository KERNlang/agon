import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';

it('retains the exact pre-extraction oracle body from 192ab0d3', () => {
  const fixture = readFileSync(new URL('../fixtures/modular-dedup-legacy.ts', import.meta.url), 'utf8');
  const body = fixture.slice(fixture.indexOf('\n') + 1);
  expect(createHash('sha256').update(body).digest('hex')).toBe('018cf770c252baf8a8b3b49dedc0d32bf7ca346de13b2e56d25221fb1577312e');
});

it('keeps the sidecar controller in shared dedup support, not the legacy workflow', () => {
  const legacy = readFileSync(new URL('../../packages/forge/src/dedup-bridge.ts', import.meta.url), 'utf8');
  expect(legacy).toContain("export { dedupBrainstormDrafts } from '@kernlang/agon-support-dedup'");
  expect(legacy).not.toContain('spawn(');
  const source = readFileSync(new URL('../../packages/support-dedup/src/brainstorm-dedup.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/from ['"][^'"]*(?:agon-core|agon-forge|\/core\/|\/forge\/)/);
  const core = readFileSync(new URL('../../packages/core/src/models/types.ts', import.meta.url), 'utf8');
  expect(core).not.toContain('export interface BrainstormGroup');
  expect(core).not.toContain('export interface BrainstormDedupStatus');
});
