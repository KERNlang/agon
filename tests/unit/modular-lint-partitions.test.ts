import { describe, expect, it } from 'vitest';
import { partitionLintFiles } from '../../scripts/lint-workspaces.mjs';

describe('typed lint process partitions', () => {
  it('assigns every discovered file exactly once, including new packages and root tooling', () => {
    const files = ['packages/core/src/a.ts', 'packages/new-mod/src/b.ts', 'tests/new.test.ts', 'eslint.config.mjs'];
    const groups = partitionLintFiles(files);
    expect([...groups.values()].flat().sort()).toEqual([...files].sort());
    expect(groups.get('packages/new-mod')).toEqual(['packages/new-mod/src/b.ts']);
    expect(groups.get('other')).toEqual(['eslint.config.mjs', 'tests/new.test.ts']);
    expect([...partitionLintFiles([...files].reverse())]).toEqual([...groups]);
  });
  it('refuses duplicate coverage instead of masking discovery mistakes', () => {
    expect(() => partitionLintFiles(['a.ts', 'a.ts'])).toThrow(/duplicate/);
  });
});
