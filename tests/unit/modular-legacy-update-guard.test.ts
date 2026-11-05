import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runManagedUpdate } from '../../packages/cli/src/commands/update.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('legacy updater modular guard', () => {
  it('contains no active-process global npm installation path', () => {
    const source = readFileSync(new URL('../../packages/cli/src/commands/update.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/npm\s+install\s+-g|['"]install['"]\s*,\s*['"]-g['"]/);
    expect(source).toContain('runManagedSetup');
  });

  it('rejects a version outside the content-bound bundled release set before staging', async () => {
    await expect(runManagedUpdate('9.9.9')).rejects.toThrow(/bundled release set/);
  });

  it('does not report success or restage the old release when npm has a newer version', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 })));
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await runManagedUpdate(undefined, { plan: true });
    const printed = output.mock.calls.flat().join('\n');
    output.mockRestore();
    expect(code).toBe(1);
    expect(printed).toContain('npm install -g @kernlang/agon@9.9.9');
    expect(printed).not.toContain('"status"');
  });

  it('the update banner action calls no updater export that has been removed', () => {
    const app = readFileSync(new URL('../../packages/cli/src/surfaces/app.tsx', import.meta.url), 'utf8');
    expect(app).not.toMatch(/commands\/update\.js/);
    expect(app).toContain('newerReleaseInstruction(latest)');
  });
});
