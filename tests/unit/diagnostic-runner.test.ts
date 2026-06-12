import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  discoverChecker,
  parseCheckerOutput,
  fingerprintOf,
  normalizeMessage,
} from '../../packages/core/src/generated/diagnostics/checker-discovery.js';
import {
  DiagnosticRunner as Runner,
  normalizeEditedPath,
  renderDigestText,
  DEBOUNCE_MS,
  DIGEST_MAX_LINES,
  QUEUE_CAP,
} from '../../packages/core/src/generated/diagnostics/diagnostic-runner.js';
import type {
  DiagnosticDigest, SpawnLike,
} from '../../packages/core/src/generated/diagnostics/diagnostic-runner.js';
import type { DispatchResult } from '../../packages/core/src/generated/models/types.js';

// ──────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────

let fixtureRoot: string;

function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'diag-fixture-'));
  // Mark as a repo root so the upward walk halts here.
  writeFileSync(join(root, 'package-lock.json'), '{}');
  return root;
}

beforeEach(() => {
  fixtureRoot = makeFixture();
});

afterEach(() => {
  try { rmSync(fixtureRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

// A spawn fake that returns a scripted DispatchResult (or resolves after a delay).
function fakeSpawn(impl: (opts: SpawnLike) => Promise<DispatchResult> | DispatchResult) {
  return vi.fn(async (opts: SpawnLike) => impl(opts));
}

function tscResult(stdout: string, extra?: Partial<DispatchResult>): DispatchResult {
  return {
    exitCode: stdout.trim() ? 2 : 0,
    stdout,
    stderr: '',
    durationMs: 5,
    timedOut: false,
    ...extra,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Checker discovery
// ──────────────────────────────────────────────────────────────────────

describe('discoverChecker', () => {
  it('resolves .ts to nearest tsconfig.json upward (tsc --noEmit -p)', () => {
    const pkg = join(fixtureRoot, 'packages', 'core');
    mkdirSync(join(pkg, 'src'), { recursive: true });
    writeFileSync(join(pkg, 'tsconfig.json'), '{}');
    const file = join(pkg, 'src', 'foo.ts');
    writeFileSync(file, 'export const x = 1;');

    const plan = discoverChecker(file, fixtureRoot);
    expect(plan).not.toBeNull();
    expect(plan!.lang).toBe('ts');
    expect(plan!.cmd).toBe('npx');
    expect(plan!.args.slice(0, 3)).toEqual(['tsc', '--noEmit', '-p']);
    expect(plan!.packageDir).toBe(pkg);
    expect(plan!.args[3]).toBe(pkg);
  });

  it('resolves .tsx the same as .ts', () => {
    mkdirSync(join(fixtureRoot, 'app'), { recursive: true });
    writeFileSync(join(fixtureRoot, 'tsconfig.json'), '{}');
    const file = join(fixtureRoot, 'app', 'C.tsx');
    writeFileSync(file, 'export const C = () => null;');
    const plan = discoverChecker(file, fixtureRoot);
    expect(plan?.lang).toBe('ts');
    expect(plan?.packageDir).toBe(fixtureRoot);
  });

  it('resolves .py to ruff when ruff.toml is present', () => {
    const pkg = join(fixtureRoot, 'pysvc');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'ruff.toml'), '');
    const file = join(pkg, 'main.py');
    writeFileSync(file, 'x = 1');
    const plan = discoverChecker(file, fixtureRoot);
    expect(plan?.lang).toBe('py');
    expect(plan?.cmd).toBe('ruff');
    expect(plan?.args[0]).toBe('check');
    expect(plan?.packageDir).toBe(pkg);
  });

  it('resolves .py to ruff via pyproject [tool.ruff]', () => {
    const pkg = join(fixtureRoot, 'pyproj');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'pyproject.toml'), '[tool.ruff]\nline-length = 100\n');
    const file = join(pkg, 'm.py');
    writeFileSync(file, 'x = 1');
    const plan = discoverChecker(file, fixtureRoot);
    expect(plan?.cmd).toBe('ruff');
  });

  it('falls back to pyright when only pyrightconfig.json present', () => {
    const pkg = join(fixtureRoot, 'pyr');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'pyrightconfig.json'), '{}');
    const file = join(pkg, 'm.py');
    writeFileSync(file, 'x = 1');
    const plan = discoverChecker(file, fixtureRoot);
    expect(plan?.cmd).toBe('pyright');
    expect(plan?.lang).toBe('py');
  });

  it('returns null for a .ts file with no tsconfig anywhere', () => {
    const file = join(fixtureRoot, 'loose.ts');
    writeFileSync(file, 'export const x = 1;');
    expect(discoverChecker(file, fixtureRoot)).toBeNull();
  });

  it('returns null for an unknown extension', () => {
    const file = join(fixtureRoot, 'README.md');
    writeFileSync(file, '# hi');
    expect(discoverChecker(file, fixtureRoot)).toBeNull();
  });

  it('returns null for a .py file with no python config', () => {
    const file = join(fixtureRoot, 'orphan.py');
    writeFileSync(file, 'x = 1');
    expect(discoverChecker(file, fixtureRoot)).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Output parsing + fingerprinting
// ──────────────────────────────────────────────────────────────────────

describe('parseCheckerOutput + fingerprint', () => {
  const pkgDir = '/abs/pkg';

  it('parses tsc lines into diagnostics', () => {
    const stdout = [
      "src/foo.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      'Found 1 error.',
    ].join('\n');
    const lines = parseCheckerOutput(stdout, '', 'ts', 'npx tsc --noEmit', pkgDir);
    expect(lines).toHaveLength(1);
    expect(lines[0].relPath).toBe('src/foo.ts');
    expect(lines[0].line).toBe(10);
    expect(lines[0].col).toBe(5);
    expect(lines[0].code).toBe('TS2322');
    expect(lines[0].fingerprint).toContain('src/foo.ts|TS2322|');
  });

  it('parses ruff lines', () => {
    const stdout = 'pysvc/main.py:3:1: F401 `os` imported but unused';
    const lines = parseCheckerOutput(stdout, '', 'py', 'ruff check', pkgDir);
    expect(lines).toHaveLength(1);
    expect(lines[0].code).toBe('F401');
    expect(lines[0].line).toBe(3);
  });

  it('parses pyright error text lines (and ignores warnings)', () => {
    const stdout = [
      '  /abs/pkg/m.py:4:1 - error: "x" is not defined',
      '  /abs/pkg/m.py:9:2 - warning: unused variable',
    ].join('\n');
    const lines = parseCheckerOutput(stdout, '', 'py', 'pyright', pkgDir);
    expect(lines).toHaveLength(1);
    expect(lines[0].code).toBe('PYRIGHT');
    expect(lines[0].line).toBe(4);
  });

  it('fingerprint is line/col-independent (same error, different line → same fp)', () => {
    const a = fingerprintOf('src/foo.ts', 'TS2322', 'Type X is not assignable', pkgDir);
    const b = fingerprintOf('src/foo.ts', 'TS2322', 'Type X is not assignable', pkgDir);
    expect(a).toBe(b);
  });

  it('normalizeMessage strips absolute paths and collapses whitespace', () => {
    const m = normalizeMessage("Cannot find module '/abs/pkg/src/x.ts'   here", pkgDir);
    expect(m).not.toContain('/abs/pkg');
    expect(m).not.toMatch(/\s{2,}/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Runner — baseline diff (fingerprint introduced/ripple/pre-existing)
// ──────────────────────────────────────────────────────────────────────

function tsPkg(): { pkg: string; file: string } {
  // Build a fixture and return an edited .ts file with a resolvable tsconfig.
  const root = makeFixtureGlobal();
  const pkg = join(root, 'pkg');
  mkdirSync(join(pkg, 'src'), { recursive: true });
  writeFileSync(join(pkg, 'tsconfig.json'), '{}');
  const file = join(pkg, 'src', 'edited.ts');
  writeFileSync(file, 'export const x = 1;');
  return { pkg, file };
}

// fixtures created inside tests get cleaned via the module-level list.
const _extraFixtures: string[] = [];
function makeFixtureGlobal(): string {
  const root = mkdtempSync(join(tmpdir(), 'diag-rt-'));
  writeFileSync(join(root, 'package-lock.json'), '{}');
  _extraFixtures.push(root);
  return root;
}
afterEach(() => {
  while (_extraFixtures.length) {
    const r = _extraFixtures.pop()!;
    try { rmSync(r, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('DiagnosticRunner — fingerprint baseline diff', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('first run: edited-file errors always reported; other-file errors form baseline', async () => {
    const { pkg, file } = tsPkg();
    const edited = `${pkg}/src/edited.ts(2,1): error TS2304: Cannot find name 'foo'.`;
    const other = `${pkg}/src/other.ts(5,1): error TS2304: Cannot find name 'bar'.`;
    const spawnFn = fakeSpawn(() => tscResult(`${edited}\n${other}`));
    const persistFn = vi.fn();
    const runner = new Runner('eng', { spawnFn, persistFn });

    runner.noteEdit(file, 'call-1');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 5);

    const digests = runner.drainPending();
    expect(digests).toHaveLength(1);
    const d = digests[0];
    // edited file error reported as introduced; other-file error swallowed into baseline.
    expect(d.introduced.map((l) => l.relPath)).toContain('src/edited.ts');
    expect(d.ripple).toHaveLength(0);
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it('second run: pre-existing fingerprint filtered, NEW error in edited file = introduced', async () => {
    const { pkg, file } = tsPkg();
    const preexisting = `${pkg}/src/other.ts(5,1): error TS2304: Cannot find name 'bar'.`;
    // Run 1: only the pre-existing other-file error → becomes baseline.
    let stdout = preexisting;
    const spawnFn = fakeSpawn(() => tscResult(stdout));
    const runner = new Runner('eng', { spawnFn, persistFn: vi.fn() });

    runner.noteEdit(file, 'c1');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 5);
    runner.drainPending(); // first digest (baseline seal)

    // Run 2: the same pre-existing error (now at a DIFFERENT line) + a new edited-file error.
    const movedPreexisting = `${pkg}/src/other.ts(9,1): error TS2304: Cannot find name 'bar'.`;
    const newEdited = `${pkg}/src/edited.ts(3,7): error TS2322: Type mismatch.`;
    stdout = `${movedPreexisting}\n${newEdited}`;

    runner.noteEdit(file, 'c2');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 5);
    const d = runner.drainPending()[0];

    // pre-existing (moved) filtered out by line-independent fingerprint…
    expect(d.ripple.find((l) => l.relPath === 'src/other.ts')).toBeUndefined();
    // …new edited-file error kept as introduced.
    expect(d.introduced.map((l) => l.relPath)).toContain('src/edited.ts');
  });

  it('NEW error in a NON-edited file (ripple) is reported and marked', async () => {
    const { pkg, file } = tsPkg();
    const spawnFn = fakeSpawn(() => '');
    let stdout = '';
    spawnFn.mockImplementation(async () => tscResult(stdout));
    const runner = new Runner('eng', { spawnFn, persistFn: vi.fn() });

    // Run 1: clean → CLEAN_BASELINE.
    runner.noteEdit(file, 'c1');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 5);
    expect(runner.drainPending()[0].clean).toBe(true);

    // Run 2: a brand-new error in some OTHER file.
    stdout = `${pkg}/src/neighbor.ts(1,1): error TS2552: Cannot find name 'baz'.`;
    runner.noteEdit(file, 'c2');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 5);
    const d = runner.drainPending()[0];
    expect(d.ripple.map((l) => l.relPath)).toContain('src/neighbor.ts');
    expect(d.introduced).toHaveLength(0);
    expect(d.text).toContain('[ripple]');
  });

  it('CLEAN_BASELINE: clean first run, then every later error is new', async () => {
    const { pkg, file } = tsPkg();
    let stdout = '';
    const spawnFn = fakeSpawn(async () => tscResult(stdout));
    const runner = new Runner('eng', { spawnFn, persistFn: vi.fn() });

    runner.noteEdit(file, 'c1');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 5);
    const first = runner.drainPending()[0];
    expect(first.clean).toBe(true);
    expect(first.text).toContain('No new type/lint errors');

    stdout = `${pkg}/src/edited.ts(2,2): error TS2304: Cannot find name 'q'.`;
    runner.noteEdit(file, 'c2');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 5);
    const second = runner.drainPending()[0];
    expect(second.clean).toBe(false);
    expect(second.introduced).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Runner — lastVerifierStatus (Feature 2: compaction working-set verifier line)
// ──────────────────────────────────────────────────────────────────────

describe('DiagnosticRunner — lastVerifierStatus', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('null before any checker has run', () => {
    const runner = new Runner('eng', { spawnFn: fakeSpawn(() => tscResult('')), persistFn: vi.fn() });
    expect(runner.lastVerifierStatus()).toBeNull();
  });

  it('reports introduced errors and SURVIVES drainPending', async () => {
    const { pkg, file } = tsPkg();
    const edited = `${pkg}/src/edited.ts(2,1): error TS2304: Cannot find name 'foo'.`;
    const runner = new Runner('eng', { spawnFn: fakeSpawn(() => tscResult(edited)), persistFn: vi.fn() });

    runner.noteEdit(file, 'c1');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 5);
    runner.drainPending(); // drain — the status must still be available after this

    const status = runner.lastVerifierStatus();
    expect(status).toContain(pkg);
    expect(status).toMatch(/1 introduced error unresolved/);
  });

  it('reports clean when the run found no new errors', async () => {
    const { pkg, file } = tsPkg();
    const runner = new Runner('eng', { spawnFn: fakeSpawn(() => tscResult('')), persistFn: vi.fn() });

    runner.noteEdit(file, 'c1');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 5);

    expect(runner.lastVerifierStatus()).toBe(`${pkg}: clean`);
  });

  // codex 1.00: a TIMED-OUT run with no parsed errors must NOT report clean.
  // `clean` is derived only from introduced+ripple===0, so the timedOut check
  // must precede the clean check or an incomplete run reads as green.
  it('reports "check timed out (incomplete)" — NOT clean — for a timed-out run with no parsed errors', async () => {
    const { pkg, file } = tsPkg();
    const runner = new Runner('eng', {
      spawnFn: fakeSpawn(async () => tscResult('', { timedOut: true, exitCode: 124 })),
      persistFn: vi.fn(),
    });

    runner.noteEdit(file, 'c1');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 5);

    const status = runner.lastVerifierStatus();
    expect(status).toBe(`${pkg}: check timed out (incomplete)`);
    // Must NOT have fallen through to the clean branch despite empty counts.
    expect(status).not.toContain('clean');
  });
});

// ──────────────────────────────────────────────────────────────────────
// Runner — debounce coalescing
// ──────────────────────────────────────────────────────────────────────

describe('DiagnosticRunner — debounce coalescing', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('coalesces a burst of edits to one packageDir into a single run', async () => {
    const { file } = tsPkg();
    const spawnFn = fakeSpawn(async () => tscResult(''));
    const runner = new Runner('eng', { spawnFn, persistFn: vi.fn() });

    // Three edits inside the debounce window.
    runner.noteEdit(file, 'c1');
    await vi.advanceTimersByTimeAsync(100);
    runner.noteEdit(file, 'c2');
    await vi.advanceTimersByTimeAsync(100);
    runner.noteEdit(file, 'c3');
    // Not enough idle time yet.
    await vi.advanceTimersByTimeAsync(100);
    expect(spawnFn).not.toHaveBeenCalled();

    // Now let the window elapse from the LAST edit.
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Runner — budget timeout
// ──────────────────────────────────────────────────────────────────────

describe('DiagnosticRunner — budget timeout', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('a timed-out checker yields a timedOut digest and never throws', async () => {
    const { file } = tsPkg();
    const spawnFn = fakeSpawn(async () => tscResult('', { timedOut: true, exitCode: 124 }));
    const persistFn = vi.fn();
    const runner = new Runner('eng', { spawnFn, persistFn });

    runner.noteEdit(file, 'c1');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 5);
    const d = runner.drainPending()[0];
    expect(d.timedOut).toBe(true);
    expect(d.text).toContain('timed out');
    // timed-out → partial saved to disk.
    expect(persistFn).toHaveBeenCalled();
  });

  it('spawnFn rejecting degrades to an empty digest (never throws)', async () => {
    const { file } = tsPkg();
    const spawnFn = vi.fn(async () => { throw new Error('spawn exploded'); });
    const runner = new Runner('eng', { spawnFn, persistFn: vi.fn() });
    runner.noteEdit(file, 'c1');
    // Advancing must not throw even though the spawn rejects internally.
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 5);
    const d = runner.drainPending()[0];
    expect(d.clean).toBe(true);
    expect(d.introduced).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Runner — queue cap + newest-wins
// ──────────────────────────────────────────────────────────────────────

describe('DiagnosticRunner — drain queue', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('newest-wins per packageDir: re-running the same package replaces its un-drained digest', async () => {
    const { pkg, file } = tsPkg();
    let stdout = `${pkg}/src/edited.ts(1,1): error TS2304: Cannot find name 'a'.`;
    const spawnFn = fakeSpawn(async () => tscResult(stdout));
    const runner = new Runner('eng', { spawnFn, persistFn: vi.fn() });

    runner.noteEdit(file, 'c1');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 5);
    // Do NOT drain. Run again with different output.
    stdout = `${pkg}/src/edited.ts(2,1): error TS2552: Cannot find name 'b'.`;
    runner.noteEdit(file, 'c2');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 5);

    const digests = runner.drainPending();
    // Only ONE digest for the package — the newest.
    expect(digests).toHaveLength(1);
    expect(digests[0].introduced[0].code).toBe('TS2552');
  });

  it('queue caps at QUEUE_CAP digests across distinct packages', async () => {
    const persistFn = vi.fn();
    // Build QUEUE_CAP + 2 distinct packages and enqueue a digest for each.
    const runner = new Runner('eng', {
      spawnFn: fakeSpawn(async (o) => tscResult(`${o.cwd}/src/x.ts(1,1): error TS1: e`)),
      persistFn,
    });
    const files: string[] = [];
    for (let i = 0; i < QUEUE_CAP + 2; i++) {
      const root = makeFixtureGlobal();
      const pkg = join(root, `p${i}`);
      mkdirSync(join(pkg, 'src'), { recursive: true });
      writeFileSync(join(pkg, 'tsconfig.json'), '{}');
      const f = join(pkg, 'src', 'edited.ts');
      writeFileSync(f, 'export const x=1;');
      files.push(f);
    }
    for (const f of files) {
      runner.noteEdit(f, 'c');
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 5);
    }
    const digests = runner.drainPending();
    expect(digests.length).toBeLessThanOrEqual(QUEUE_CAP);
    expect(digests.length).toBe(QUEUE_CAP);
  });

  it('drainPending clears the queue (idempotent second drain is empty)', async () => {
    const { file } = tsPkg();
    const runner = new Runner('eng', {
      spawnFn: fakeSpawn(async () => tscResult('')),
      persistFn: vi.fn(),
    });
    runner.noteEdit(file, 'c1');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 5);
    expect(runner.drainPending()).toHaveLength(1);
    expect(runner.drainPending()).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Runner — digest truncation (20-line cap → full output to disk)
// ──────────────────────────────────────────────────────────────────────

describe('DiagnosticRunner — digest truncation', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('caps the digest at DIGEST_MAX_LINES and saves full output to disk', async () => {
    const { pkg, file } = tsPkg();
    // Emit DIGEST_MAX_LINES + 5 distinct edited-file errors.
    const lines: string[] = [];
    for (let i = 0; i < DIGEST_MAX_LINES + 5; i++) {
      lines.push(`${pkg}/src/edited.ts(${i + 1},1): error TS230${i}: Cannot find name 'n${i}'.`);
    }
    const persistFn = vi.fn();
    const runner = new Runner('eng', {
      spawnFn: fakeSpawn(async () => tscResult(lines.join('\n'))),
      persistFn,
    });
    runner.noteEdit(file, 'c1');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 5);
    const d = runner.drainPending()[0];
    expect(d.truncated).toBe(true);
    expect(d.fullResultId).toMatch(/^diag-\d+$/);
    expect(persistFn).toHaveBeenCalledWith('eng', d.fullResultId, 'Diagnostic', expect.any(String));
    // digest text shows at most DIGEST_MAX_LINES error rows (+ header + footer).
    const rows = d.text.split('\n').filter((l) => l.includes('error TS'));
    expect(rows.length).toBeLessThanOrEqual(DIGEST_MAX_LINES);
    expect(d.text).toContain('RetrieveResult');
  });
});

// ──────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────

describe('pure helpers', () => {
  it('normalizeEditedPath strips packageDir prefix → forward-slashed relative', () => {
    expect(normalizeEditedPath('/a/b/pkg/src/x.ts', '/a/b/pkg')).toBe('src/x.ts');
    expect(normalizeEditedPath('./src/x.ts', '/a/b/pkg')).toBe('src/x.ts');
  });

  it('renderDigestText: clean → green note; with errors → header + rows', () => {
    expect(renderDigestText('/p', [], [], true, false, null, false)).toContain('No new');
    const lns = [{ relPath: 'src/x.ts', line: 1, col: 2, code: 'TS1', message: 'oops', raw: '', fingerprint: '' }];
    const t = renderDigestText('/p', lns, [], false, false, null, false);
    expect(t).toContain('[diagnostics — /p]');
    expect(t).toContain('src/x.ts(1,2): TS1 oops');
  });
});

// ──────────────────────────────────────────────────────────────────────
// Optional integration test — real tsc (gated on AGON_IT=1)
// ──────────────────────────────────────────────────────────────────────

describe('DiagnosticRunner — integration (real tsc)', () => {
  it.skipIf(process.env.AGON_IT !== '1')(
    'runs real tsc against a tmpdir fixture with a deliberate type error',
    async () => {
      // Fixture lives INSIDE the repo tree so `npx tsc` resolves the hoisted
      // TypeScript (a tmpdir outside the repo has no node_modules → npx fetches
      // the wrong "tsc" package).
      const root = mkdtempSync(join(process.cwd(), '.tmp-diag-it-'));
      try {
        writeFileSync(join(root, 'package-lock.json'), '{}');
        writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
          compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
          include: ['*.ts'],
        }));
        const file = join(root, 'broken.ts');
        // Deliberate type error: string assigned to number.
        writeFileSync(file, 'export const n: number = "not a number";\n');

        const runner = new Runner('it-eng', {}); // real spawn + real persist
        runner.noteEdit(file, 'c1');
        // Real tsc is slow → wait on real time. Use a polling loop.
        const deadline = Date.now() + 60_000;
        let digests: DiagnosticDigest[] = [];
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 250));
          const d = runner.drainPending();
          if (d.length > 0) { digests = d; break; }
        }
        expect(digests.length).toBeGreaterThan(0);
        const d = digests[0];
        expect(d.lang).toBe('ts');
        // The edited file's deliberate error must surface as introduced.
        expect(d.introduced.some((l) => l.relPath === 'broken.ts')).toBe(true);
      } finally {
        try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    },
    90_000,
  );
});
