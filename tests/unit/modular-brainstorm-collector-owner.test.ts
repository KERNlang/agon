import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps collection and scout decisions out of the legacy adapter', () => {
  const source = readFileSync(new URL('../../packages/forge/src/brainstorm.ts', import.meta.url), 'utf8');
  expect(source).toContain('createBrainstormCollector');
  expect(source).toContain('createBrainstormScout');
  expect(source).not.toContain('const draftPromises =');
  expect(source).not.toContain('const scouts =');
  for (const file of ['collector.ts', 'scout.ts']) {
    const owner = readFileSync(new URL(`../../packages/mod-brainstorm/src/${file}`, import.meta.url), 'utf8');
    expect(owner).not.toMatch(/from ['"][^'"]*(?:agon-core|agon-forge|\/core\/|\/forge\/|\/cli\/)/);
  }
});
