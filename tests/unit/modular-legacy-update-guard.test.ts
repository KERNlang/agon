import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runManagedUpdate } from '../../packages/cli/src/commands/update.js';

describe('legacy updater modular guard', () => {
  it('contains no active-process global npm installation path', () => {
    const source = readFileSync(new URL('../../packages/cli/src/commands/update.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/npm\s+install\s+-g|['"]install['"]\s*,\s*['"]-g['"]/);
    expect(source).toContain('runManagedSetup');
  });

  it('rejects a version outside the content-bound bundled release set before staging', async () => {
    await expect(runManagedUpdate('9.9.9')).rejects.toThrow(/bundled release set/);
  });
});
