import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps collection and scout decisions out of the legacy adapter', () => {
  const runtime = readFileSync(new URL('../../packages/mod-brainstorm/src/runtime.ts', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../../packages/forge/src/brainstorm.ts', import.meta.url), 'utf8');
  expect(runtime).toContain('createBrainstormCollector');
  expect(runtime).toContain('createBrainstormScout');
  expect(source).not.toContain('const draftPromises =');
  expect(source).not.toContain('const scouts =');
  for (const file of ['collector.ts', 'scout.ts']) {
    const owner = readFileSync(new URL(`../../packages/mod-brainstorm/src/${file}`, import.meta.url), 'utf8');
    expect(owner).not.toMatch(/from ['"][^'"]*(?:agon-core|agon-forge|\/core\/|\/forge\/|\/cli\/)/);
  }
});
