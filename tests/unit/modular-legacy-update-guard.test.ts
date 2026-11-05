import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runManagedSetup } from '../../packages/cli/src/commands/setup.js';
import { runManagedUpdate, updateCommand } from '../../packages/cli/src/commands/update.js';

vi.mock('../../packages/cli/src/commands/setup.js', () => ({ runManagedSetup: vi.fn(async () => {}) }));
vi.mock('node:child_process', async (importActual) => ({
  ...await importActual<typeof import('node:child_process')>(),
  execFile: (_file: string, _args: string[], _options: unknown, callback: (error: Error) => void) => {
    queueMicrotask(() => callback(new Error('npm unavailable')));
    return { on: () => {} };
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(runManagedSetup).mockClear();
  process.exitCode = undefined;
});

function stubRegistry(version: string | null) {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (version === null) throw new Error('network down');
    return new Response(JSON.stringify({ version }), { status: 200 });
  }));
}

describe('legacy updater modular guard', () => {
  it('contains no active-process global npm installation path', () => {
    const source = readFileSync(new URL('../../packages/cli/src/commands/update.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/npm\s+install\s+-g|['"]install['"]\s*,\s*['"]-g['"]/);
    expect(source).toContain('runManagedSetup');
  });

  it('rejects a version outside the content-bound bundled release set before staging', async () => {
    await expect(runManagedUpdate('9.9.9')).rejects.toThrow(/bundled release set/);
  });

  it('exits 1 with the install command instead of restaging the old release when npm has a newer version', async () => {
    stubRegistry('9.9.9');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await updateCommand.run({ args: {} });
    expect(process.exitCode).toBe(1);
    expect(errors.mock.calls.flat().join('\n')).toContain('npm install -g @kernlang/agon@9.9.9');
    expect(runManagedSetup).not.toHaveBeenCalled();
  });

  it('does not restage and report success when the registry cannot be reached', async () => {
    stubRegistry(null);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runManagedUpdate(undefined)).toBe(1);
    expect(runManagedSetup).not.toHaveBeenCalled();
  });

  it('still reinstalls from the local cache offline without asking the registry', async () => {
    stubRegistry('9.9.9');
    expect(await runManagedUpdate(undefined, { offline: true })).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(runManagedSetup).toHaveBeenCalledOnce();
  });

  it('the update banner action no longer imports the removed updater export', () => {
    const app = readFileSync(new URL('../../packages/cli/src/surfaces/app.tsx', import.meta.url), 'utf8');
    expect(app).not.toMatch(/commands\/update\.js/);
  });
});
