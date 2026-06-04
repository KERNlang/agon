import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';

// Mocked execFile: tests can flip `execFileMock` between cases to simulate
// different registry responses (success, malformed, unreachable). vi.mock is
// hoisted to the top of the file by Vitest, so the factory references a
// `vi.hoisted` value rather than a top-level const.
const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return { ...actual, execFile: execFileMock };
});

// Imported AFTER the mock so the module picks up the stubbed execFile.
import {
  parseSemver,
  semverGte,
  checkForUpdate,
  loadDismissedVersion,
  saveDismissedVersion,
} from '../../packages/cli/src/generated/services/update-check.js';

function makeFakeChild(stdout: string, exitCode: number = 0) {
  // The service uses execFile's callback signature (err, stdout, stderr). Fire
  // the callback synchronously inside the mock factory — no setImmediate —
  // so the awaiting promise resolves immediately and the test has no
  // dangling timers. The service ALSO attaches `child.on('error', ...)` and
  // tracks an optional exit handler; we expose the same surface so nothing
  // the service touches is `undefined`.
  const handlers: { [k: string]: Array<(...a: any[]) => void> } = {};
  const child: any = {
    on(event: string, cb: any) {
      (handlers[event] = handlers[event] || []).push(cb);
      return child;
    },
    kill() { /* no-op */ },
  };
  // Fire the registered 'error'/'exit' listeners only if the service asks for
  // them — execFile's own callback does not require an exit event, and we
  // want to mimic a fast successful run.
  return {
    child,
    fireExit(code: number | null = exitCode) {
      for (const cb of handlers.exit || []) cb(code);
    },
    fireError(err: Error) {
      for (const cb of handlers.error || []) cb(err);
    },
  };
}

describe('update-check service', () => {
  describe('parseSemver', () => {
    it('parses a clean x.y.z', () => {
      expect(parseSemver('1.2.3')).toEqual([1, 2, 3, 0]);
    });
    it('strips a leading v', () => {
      expect(parseSemver('v0.1.3')).toEqual([0, 1, 3, 0]);
    });
    it('treats missing minor/patch as zero', () => {
      expect(parseSemver('1.2')).toEqual([1, 2, 0, 0]);
      expect(parseSemver('1')).toEqual([1, 0, 0, 0]);
    });
    it('flags a prerelease', () => {
      expect(parseSemver('1.0.0-rc.1')).toEqual([1, 0, 0, 1]);
      expect(parseSemver('1.0.0-rc.1')[3]).toBe(1);
      expect(parseSemver('1.0.0')[3]).toBe(0);
    });
    it('rejects garbage', () => {
      expect(parseSemver('')).toBeNull();
      expect(parseSemver('latest')).toBeNull();
      expect(parseSemver('1.0.0.0-extra-garbage')).toBeNull();
      expect(parseSemver(null as any)).toBeNull();
    });
  });

  describe('semverGte', () => {
    const cases: Array<{ a: string; b: string; expected: boolean; note: string }> = [
      { a: '0.1.3', b: '0.1.2', expected: true,  note: 'patch bump newer' },
      { a: '0.1.3', b: '0.1.3', expected: true,  note: 'identical versions' },
      { a: '0.1.3', b: '0.1.4', expected: false, note: 'older patch' },
      { a: '1.0.0', b: '0.9.9', expected: true,  note: 'major bump newer' },
      { a: '0.1.3', b: '0.2.0', expected: false, note: 'older minor' },
      { a: '1.0.0', b: '1.0.0-rc.1', expected: true,  note: 'stable > prerelease of same triple' },
      { a: '1.0.0-rc.1', b: '1.0.0', expected: false, note: 'prerelease < stable of same triple' },
      { a: '1.0.0-rc.2', b: '1.0.0-rc.1', expected: true,  note: 'higher prerelease > lower' },
      { a: '1.0.0-rc.2', b: '1.0.0-rc.10', expected: false, note: 'numeric prerelease compared numerically (rc.2 < rc.10)' },
      { a: '1.0.0-rc.10', b: '1.0.0-rc.2', expected: true,  note: 'rc.10 > rc.2 (not lexical)' },
      { a: '1.0.0-rc.1', b: '1.0.0-rc.1', expected: true,  note: 'identical prereleases are >=' },
      { a: '1.0.0-alpha', b: '1.0.0-beta', expected: false, note: 'alpha < beta' },
      { a: 'v2.0.0', b: '1.9.9', expected: true,  note: 'v-prefix tolerated on left' },
      { a: 'garbage', b: '1.0.0', expected: false, note: 'garbage fails closed' },
      { a: '1.0.0', b: 'garbage', expected: false, note: 'garbage fails closed (right)' },
    ];
    for (const c of cases) {
      it(`${c.note} — semverGte(${c.a}, ${c.b}) === ${c.expected}`, () => {
        expect(semverGte(c.a, c.b)).toBe(c.expected);
      });
    }
  });

  describe('dismissal persistence', () => {
    let home = '';
    beforeEach(() => {
      home = setupTestAgonHome('update-check');
    });
    afterEach(() => {
      cleanupTestAgonHome(home);
    });

    it('returns "" when the state file is missing', async () => {
      expect(await loadDismissedVersion()).toBe('');
    });
    it('round-trips a saved version', async () => {
      await saveDismissedVersion('0.2.0');
      expect(await loadDismissedVersion()).toBe('0.2.0');
    });
    it('overwrites a previous dismissal', async () => {
      await saveDismissedVersion('0.2.0');
      await saveDismissedVersion('0.3.0');
      expect(await loadDismissedVersion()).toBe('0.3.0');
    });
    it('tolerates a corrupt state file', async () => {
      const path = join(home, 'update-state.json');
      writeFileSync(path, '{ not valid json', 'utf-8');
      expect(await loadDismissedVersion()).toBe('');
    });
    it('ignores a state file with the wrong shape', async () => {
      const path = join(home, 'update-state.json');
      writeFileSync(path, JSON.stringify({ dismissedFor: 42 }), 'utf-8');
      expect(await loadDismissedVersion()).toBe('');
    });
  });

  describe('checkForUpdate', () => {
    beforeEach(() => {
      execFileMock.mockReset();
    });

    // Helper: install a one-shot execFile mock that fires the service's
    // callback with the given stdout (or with an Error) before returning the
    // fake child. Synchronous so the awaiting Promise resolves on the same
    // tick — no dangling timers, no setImmediate in the test.
    function stubExecFile(stdout: string, exitErr?: Error) {
      execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        const fake = makeFakeChild(stdout);
        if (exitErr) {
          // Mimic execFile's "error" path: the callback fires with the error
          // and an empty stdout.
          if (typeof cb === 'function') cb(exitErr, '');
        } else if (typeof cb === 'function') {
          cb(null, stdout);
        }
        return fake.child;
      });
    }

    it('returns hasUpdate=true when registry reports a newer version', async () => {
      stubExecFile('0.2.0\n');
      const result = await checkForUpdate('0.1.3', { packageName: '@kernlang/agon', registryTimeoutMs: 1000 });
      expect(result.hasUpdate).toBe(true);
      expect(result.latestVersion).toBe('0.2.0');
      expect(result.currentVersion).toBe('0.1.3');
      expect(result.error).toBe('');
    });

    it('returns hasUpdate=false when versions match', async () => {
      stubExecFile('0.1.3\n');
      const result = await checkForUpdate('0.1.3', { packageName: '@kernlang/agon', registryTimeoutMs: 1000 });
      expect(result.hasUpdate).toBe(false);
      expect(result.latestVersion).toBe('0.1.3');
    });

    it('returns hasUpdate=false for older registry versions (we never downgrade)', async () => {
      stubExecFile('0.0.9\n');
      const result = await checkForUpdate('0.1.3', { packageName: '@kernlang/agon', registryTimeoutMs: 1000 });
      expect(result.hasUpdate).toBe(false);
      expect(result.latestVersion).toBe('0.0.9');
    });

    it('returns error when npm view returns empty stdout', async () => {
      stubExecFile('', new Error('exit 1'));
      const result = await checkForUpdate('0.1.3', { packageName: '@kernlang/agon', registryTimeoutMs: 1000 });
      expect(result.error).toBe('registry-unreachable');
      expect(result.hasUpdate).toBe(false);
    });

    it('returns error when npm view returns a malformed version', async () => {
      stubExecFile('not-a-version\n');
      const result = await checkForUpdate('0.1.3', { packageName: '@kernlang/agon', registryTimeoutMs: 1000 });
      expect(result.error).toBe('malformed-registry-version');
      expect(result.hasUpdate).toBe(false);
    });

    it('treats a thrown execFile as registry-unreachable', async () => {
      // runNpmViewVersion's inner try/catch converts a synchronous throw
      // (e.g. spawn ENOENT) into an empty stdout + the 'registry-unreachable'
      // sentinel. That is the correct fail-closed behavior — we never want
      // a missing npm binary to crash the boot effect.
      execFileMock.mockImplementation(() => { throw new Error('spawn ENOENT'); });
      const result = await checkForUpdate('0.1.3', { packageName: '@kernlang/agon', registryTimeoutMs: 1000 });
      expect(result.hasUpdate).toBe(false);
      expect(result.error).toBe('registry-unreachable');
    });

    it('defaults to @kernlang/agon and 5s timeout when opts is undefined', async () => {
      stubExecFile('0.2.0\n');
      const result = await checkForUpdate('0.1.3', undefined);
      expect(result.latestVersion).toBe('0.2.0');
      const call = execFileMock.mock.calls[0];
      expect(call[0]).toBe('npm');
      expect(call[1]).toEqual(['view', '@kernlang/agon', 'version']);
      expect(call[2] && call[2].timeout).toBe(5000);
    });
  });
});

// Regression guard: the update prompt in app.kern used to ship a choice with
// key '__other' meaning "dismiss this version." That collided with the
// question-row sentinel that signals "open the inline text editor" (added
// concurrently in output.kern / keyboard.kern). If '__other' ever re-appears
// as an update-prompt choice key, picking "Don't ask again" would open a
// blank text box instead of dismissing. The compiler won't catch it because
// both sides are typed `any`/`string` — only this guard does.
describe('update prompt sentinel collision guard', () => {
  it('app.kern does not use the __other sentinel as an update-prompt choice key', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const appKernPath = join(__dirname, '../../packages/cli/src/kern/surfaces/app.kern');
    const src = await readFile(appKernPath, 'utf8');

    // Anchor on the triggerUpdatePrompt choices array itself (the literal
    // `const choices = [` inside that callback) so the order of rows is
    // irrelevant — the guard cares only that the four intent keys exist and
    // that `__other` does NOT. The array literal is the only one in app.kern
    // whose keys we care about; permission prompts use a different shape.
    const promptMarker = "const current = info.currentVersion || VERSION;";
    const blockStart = src.indexOf(promptMarker);
    expect(blockStart, "expected to find the triggerUpdatePrompt choices array in app.kern").toBeGreaterThan(-1);
    const arrayStart = src.indexOf('const choices = [', blockStart);
    expect(arrayStart, "expected to find `const choices = [` after the update-prompt marker").toBeGreaterThan(-1);
    const blockEnd = src.indexOf('];', arrayStart) + 2;
    const choicesBlock = src.slice(arrayStart, blockEnd);
    expect(choicesBlock).not.toMatch(/key:\s*'__other'/);
    for (const expectedKey of ['update', 'changelog', 'later', 'dismiss']) {
      expect(choicesBlock).toContain(`key: '${expectedKey}'`);
    }
  });
});
