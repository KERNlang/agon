import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';
import { join } from 'node:path';
import { writeFileSync, existsSync } from 'node:fs';

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
  isLinkedDevInstall,
  fetchLatestFromRegistry,
  resolveLatestVersion,
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

// Install a one-shot execFile mock that fires the service's callback with the
// given stdout (or an Error) before returning the fake child. Synchronous so the
// awaiting Promise resolves on the same tick. Module-scope so both the fallback
// tests and the resolveLatestVersion tests can use it.
function stubExecFile(stdout: string, exitErr?: Error) {
  execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
    const fake = makeFakeChild(stdout);
    if (exitErr) {
      if (typeof cb === 'function') cb(exitErr, '');
    } else if (typeof cb === 'function') {
      cb(null, stdout);
    }
    return fake.child;
  });
}

// Minimal Response-like stub for the global `fetch` the registry resolver uses.
function fetchResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body } as any;
}

describe('update-check service', () => {
  describe('isLinkedDevInstall', () => {
    it('returns a boolean, and detects the git checkout when one is present', () => {
      const result = isLinkedDevInstall();
      expect(typeof result).toBe('boolean');
      // Walking up from the module dir reaches a `.git` without crossing
      // node_modules — the "linked/dev build" signal. Guard the strong
      // assertion on actual `.git` presence so a rare .git-less export (e.g. a
      // CI tarball run) doesn't flake the suite; the normal local + CI checkout
      // case has `.git` at the repo root (cwd) and must report true.
      if (existsSync(join(process.cwd(), '.git'))) {
        expect(result).toBe(true);
      }
    });
  });

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

  describe('checkForUpdate (npm-view fallback path)', () => {
    beforeEach(() => {
      execFileMock.mockReset();
      // Force the PRIMARY direct-registry fetch to fail so these cases
      // deterministically exercise the `npm view` fallback — where the execFile
      // assertions below live.
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no direct egress'); }));
    });
    afterEach(() => vi.unstubAllGlobals());

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

    it('defaults to @kernlang/agon and ~5s timeout when opts is undefined', async () => {
      stubExecFile('0.2.0\n');
      const result = await checkForUpdate('0.1.3', undefined);
      expect(result.latestVersion).toBe('0.2.0');
      const call = execFileMock.mock.calls[0];
      expect(call[0]).toBe('npm');
      expect(call[1]).toEqual(['view', '@kernlang/agon', 'version']);
      // Shared budget: the fallback gets the 5s default MINUS the (negligible)
      // time the primary fetch already consumed — so it's ~5000, not exactly
      // 5000 (the fetch-throw burns ~0-1ms). Asserting an exact 5000 is a timing
      // race; assert it's the near-full remaining budget instead.
      expect(call[2] && call[2].timeout).toBeGreaterThan(4000);
      expect(call[2] && call[2].timeout).toBeLessThanOrEqual(5000);
    });
  });

  describe('fetchLatestFromRegistry (direct registry GET)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('reads .version from the keyless /latest manifest (scoped name URL-encoded)', async () => {
      const f = vi.fn(async () => fetchResponse({ version: '1.4.2' }));
      vi.stubGlobal('fetch', f);
      expect(await fetchLatestFromRegistry('@kernlang/agon', 1000)).toBe('1.4.2');
      // keyless, no `npm` binary: a plain GET to the encoded /latest endpoint
      expect(f.mock.calls[0][0]).toBe('https://registry.npmjs.org/@kernlang%2Fagon/latest');
    });

    it('returns "" on a non-2xx response', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => fetchResponse({}, false, 404)));
      expect(await fetchLatestFromRegistry('@kernlang/agon', 1000)).toBe('');
    });

    it('returns "" when the manifest has no version field', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => fetchResponse({ name: '@kernlang/agon' })));
      expect(await fetchLatestFromRegistry('@kernlang/agon', 1000)).toBe('');
    });

    it('returns "" (never throws) when fetch rejects', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
      expect(await fetchLatestFromRegistry('@kernlang/agon', 1000)).toBe('');
    });
  });

  describe('resolveLatestVersion (fetch first, npm-view fallback)', () => {
    beforeEach(() => execFileMock.mockReset());
    afterEach(() => vi.unstubAllGlobals());

    it('uses the direct fetch and never spawns npm when it succeeds', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => fetchResponse({ version: '2.0.0' })));
      expect(await resolveLatestVersion('@kernlang/agon', 1000)).toBe('2.0.0');
      expect(execFileMock).not.toHaveBeenCalled();
    });

    it('falls back to `npm view` when the direct fetch yields nothing', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('blocked'); }));
      stubExecFile('3.1.0\n');
      expect(await resolveLatestVersion('@kernlang/agon', 1000)).toBe('3.1.0');
      expect(execFileMock).toHaveBeenCalled();
    });

    it('shares one time budget: a fetch that exhausts it does NOT start a second full npm-view timeout', async () => {
      // fetch hangs until its own AbortController fires at the (tiny) budget, then
      // rejects. With the budget spent, the fallback must be skipped so the
      // worst-case startup latency can never double.
      vi.stubGlobal('fetch', vi.fn((_url: string, opts: any) => new Promise((_res, rej) => {
        opts?.signal?.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
      })));
      stubExecFile('9.9.9\n'); // would be returned IF the fallback wrongly ran
      const out = await resolveLatestVersion('@kernlang/agon', 60);
      expect(out).toBe('');
      expect(execFileMock).not.toHaveBeenCalled();
    });
  });

  describe('checkForUpdate (primary registry-fetch path)', () => {
    beforeEach(() => execFileMock.mockReset());
    afterEach(() => vi.unstubAllGlobals());

    // The exact work-PC scenario: on 0.2.0 with 0.2.1 published, the banner now
    // fires from a direct registry GET — no `npm` on PATH required.
    it('detects 0.2.0 -> 0.2.1 via the registry fetch WITHOUT spawning npm', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => fetchResponse({ version: '0.2.1' })));
      const result = await checkForUpdate('0.2.0', { packageName: '@kernlang/agon', registryTimeoutMs: 1000 });
      expect(result.hasUpdate).toBe(true);
      expect(result.latestVersion).toBe('0.2.1');
      expect(result.error).toBe('');
      expect(execFileMock).not.toHaveBeenCalled();
    });

    it('does not flag an update when the current version carries a v-prefix (v0.2.0 vs 0.2.0)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => fetchResponse({ version: '0.2.0' })));
      const result = await checkForUpdate('v0.2.0', { packageName: '@kernlang/agon', registryTimeoutMs: 1000 });
      expect(result.hasUpdate).toBe(false);
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
