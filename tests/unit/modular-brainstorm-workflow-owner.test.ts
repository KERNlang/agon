import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('the legacy Brainstorm entrypoint delegates workflow ownership to its physical mod', () => {
  const runtime = readFileSync(new URL('../../packages/mod-brainstorm/src/runtime.ts', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../../packages/forge/src/brainstorm.ts', import.meta.url), 'utf8');
  expect(runtime).toContain('createBrainstormWorkflow');
  expect(source).not.toContain('const brainstormId =');
  expect(source).not.toContain('const expandPrompt =');
  const owner = readFileSync(new URL('../../packages/mod-brainstorm/src/workflow.ts', import.meta.url), 'utf8');
  expect(owner).not.toMatch(/from ['"][^'"]*(?:agon-core|agon-forge|\/core\/|\/forge\/|\/cli\/)/);
});
