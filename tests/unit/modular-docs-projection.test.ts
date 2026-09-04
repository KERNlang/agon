import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const generator = resolve(root, 'scripts/generate-mode-docs.mjs');
const catalogPath = resolve(root, 'packages/mod-kernel/src/generated/first-party-surface-catalog.ts');

describe('generated docs projection', () => {
  it('renders the selected docs entry and refuses a catalog where it is disabled', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'agon-s6-docs-'));
    try {
      const output = join(temporary, 'modes.md');
      const positive = spawnSync(process.execPath, [generator], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, AGON_DOCS_OUTPUT_PATH: output },
      });
      expect(positive.status, positive.stderr).toBe(0);
      expect(readFileSync(output, 'utf8')).toBe(readFileSync(resolve(root, 'docs/modes.md'), 'utf8'));

      const edited = readFileSync(output, 'utf8').replace('# How to call Agon', '# Handwritten operator guide');
      writeFileSync(output, edited);
      const preserved = spawnSync(process.execPath, [generator], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, AGON_DOCS_OUTPUT_PATH: output },
      });
      expect(preserved.status, preserved.stderr).toBe(0);
      expect(readFileSync(output, 'utf8')).toContain('# Handwritten operator guide');

      const source = readFileSync(catalogPath, 'utf8');
      const prefix = 'Object.freeze(';
      const suffix = ') as readonly GeneratedSurfaceCatalogEntry[];';
      const start = source.indexOf(prefix);
      const end = source.lastIndexOf(suffix);
      const catalog = JSON.parse(source.slice(start + prefix.length, end));
      const disabledPath = join(temporary, 'disabled-catalog.ts');
      writeFileSync(disabledPath, `Object.freeze(${JSON.stringify(catalog.filter((entry: any) => entry.publicId !== 'docs/modes.md'))}) as readonly GeneratedSurfaceCatalogEntry[];`);
      const negative = spawnSync(process.execPath, [generator], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, AGON_SURFACE_CATALOG_PATH: disabledPath, AGON_DOCS_OUTPUT_PATH: join(temporary, 'should-not-exist.md') },
      });
      expect(negative.status).not.toBe(0);
      expect(negative.stderr).toContain('docs/modes.md is disabled or absent');
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
