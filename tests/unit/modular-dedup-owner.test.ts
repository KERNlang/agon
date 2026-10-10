import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const retired = join(root, 'packages/forge/src/dedup-bridge.ts');
function importsRetired(path: string, source: string): string[] {
  return ts.preProcessFile(source, true, true).importedFiles.map(item => item.fileName)
    .filter(name => name.startsWith('.') && resolve(dirname(path), name).replace(/\.js$/, '.ts') === retired);
}
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

it('retains the exact pre-extraction oracle body from 192ab0d3', () => {
  const fixture = readFileSync(new URL('../fixtures/modular-dedup-legacy.ts', import.meta.url), 'utf8');
  const body = fixture.slice(fixture.indexOf('\n') + 1);
  expect(createHash('sha256').update(body).digest('hex')).toBe('018cf770c252baf8a8b3b49dedc0d32bf7ca346de13b2e56d25221fb1577312e');
});

it('keeps the sidecar controller in shared dedup support, not the legacy workflow', () => {
  expect(existsSync(retired)).toBe(false);
  const source = readFileSync(new URL('../../packages/support-dedup/src/brainstorm-dedup.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/from ['"][^'"]*(?:agon-core|agon-forge|\/core\/|\/forge\/)/);
  const core = readFileSync(new URL('../../packages/core/src/models/types.ts', import.meta.url), 'utf8');
  expect(core).not.toContain('export interface BrainstormGroup');
  expect(core).not.toContain('export interface BrainstormDedupStatus');
});

it('leaves no production import edge to the retired dedup adapter', () => {
  const violations: string[] = [];
  for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    const directory = join(root, 'packages', entry.name, 'src');
    if (!entry.isDirectory() || !existsSync(directory)) continue;
    for (const path of sourceFiles(directory)) {
      for (const name of importsRetired(path, readFileSync(path, 'utf8'))) violations.push(`${path}: ${name}`);
    }
  }
  expect(violations).toEqual([]);
});

it('detects restored static, type, re-export and dynamic adapter imports', () => {
  const path = join(root, 'packages/forge/src/brainstorm.ts');
  for (const source of [
    "import { dedupBrainstormDrafts } from './dedup-bridge.js';",
    "import type { Dedup } from './dedup-bridge.js';",
    "export { dedupBrainstormDrafts } from './dedup-bridge.js';",
    "const dedup = import('./dedup-bridge.js');",
  ]) expect(importsRetired(path, source)).toHaveLength(1);
  expect(importsRetired(path, "import { dedupBrainstormDrafts } from '@kernlang/agon-support-dedup';")).toEqual([]);
});
