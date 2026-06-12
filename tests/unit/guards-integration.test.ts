// ── P1+P2 GuardPipeline — CLI-facing integration tests (Wiring D4) ─────
//
// These drive the SAME fake-dispatch session harness as
// persistent-session.test.ts: createResumeSession (API path) with
// apiStreamDispatchWithHistory mocked per turn + a fake onToolCall. They assert
// the PROGRAM-PLAN behaviors of the GuardPipeline as wired into the session loop
// (Wiring D3, packages/core/session-resume.kern), against the contract at
// docs/p1p2-guardpipeline-contract.md.
//
// DEPENDENCY ON D3 (concurrent): these tests exercise the invariants/shadow
// branches of the session loop. They are written to the CONTRACT, not to a
// half-landed loop — if a test fails because D3's wiring isn't fully landed yet,
// it is the wiring that is behind, not the test. The overseer re-runs after D3
// lands. (As of writing, D3's branches are present in session-resume.kern, so
// these are expected to pass; the grounded-write/evidence/info-gain/shadow paths
// are all wired.)
//
// SKIPPED — test (c) diagnostic digest: the contract's seventh integration test
// (an introduced-error DiagnosticRunner digest landing in the next dispatch's
// context) needs a FAKE spawn injected into the per-session DiagnosticRunner so
// no real `tsc` runs in a unit test. createResumeSession instantiates
// `new DiagnosticRunner(config.engine.id)` with NO spawn-injection seam on
// PersistentSessionConfig (session-resume.kern:308), so the runner uses the
// default real spawnWithTimeout → real tsc, which is too slow/flaky for a unit
// test and cannot be faked through config. See the it.skip below + the report:
// D3 (or a follow-up) must expose a config seam (e.g.
// PersistentSessionConfig.diagnosticDeps?.spawnFn) threaded into the runner ctor.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';
import { vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DispatchResult } from '../../packages/core/src/generated/models/types.js';
import type { SpawnLike } from '../../packages/core/src/generated/diagnostics/diagnostic-runner.js';

const apiStreamDispatchWithHistoryMock = vi.hoisted(() => vi.fn());

vi.mock('../../packages/core/src/generated/api/dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/core/src/generated/api/dispatch.js')>();
  return {
    ...actual,
    apiStreamDispatchWithHistory: apiStreamDispatchWithHistoryMock,
  };
});

// ── Scripted dispatch helpers ─────────────────────────────────────────
// Each yields a display-only <tool> marker into the text AND returns the
// structured tool_call part in the done value (the harness executes from the
// structured part). Mirrors persistent-session.test.ts's streamStructuredToolCall.
async function* streamStructuredToolCall(toolName: string, input: Record<string, unknown>, toolCallId = 'call_sdk_1') {
  yield `\n<tool name="${toolName}">${JSON.stringify(input)}</tool>\n`;
  return { parts: [{ kind: 'tool_call', toolName, toolCallId, args: input }] };
}

// Reads an explicit set of files in one step (structured parts so the loop
// executes them). Used for the info-gain stall ladder (same-set re-reads stall).
async function* streamReadSet(paths: string[], seq: number) {
  const text = paths.map(p => `<tool name="Read">${JSON.stringify({ file_path: p })}</tool>`).join('\n');
  const parts = paths.map((p, i) => ({
    kind: 'tool_call',
    toolName: 'Read',
    toolCallId: `call_r_${seq}_${i}`,
    args: { file_path: p },
  }));
  yield `Looking at the files again.\n${text}`;
  return { parts };
}

// Issues ONE Glob call (read-only) with a `path` search-dir arg + a pattern.
// The `path` arg is a DIRECTORY that never appears in the Glob's RESULT (the
// result is the matched FILES) — exactly the shape that, before FIX 1, evaded
// the info-gain stall ladder: currentStepReadPaths was built from the raw `path`
// arg, which is never in everReadPaths (Glob only records RESULT paths), so
// `currentStepReadPaths ⊆ everReadPaths` was perpetually false and a duplicate
// Glob loop never counted as a stall. With FIX 1 the arg-path is dropped
// (readCallPath returns null for Glob), so a duplicate Glob is an empty set →
// trivially ⊆ → stalls on its zero info-gain (same cache key, same result paths).
async function* streamGlob(pattern: string, dir: string, seq: number) {
  const args = { pattern, path: dir };
  yield `\n<tool name="Glob">${JSON.stringify(args)}</tool>\n`;
  return { parts: [{ kind: 'tool_call', toolName: 'Glob', toolCallId: `call_g_${seq}`, args }] };
}

async function* streamText(text: string) {
  yield text;
  return {};
}

function apiEngine(id: string, guards?: 'strict' | 'invariants' | 'shadow') {
  return {
    id,
    api: { baseURL: 'https://example.invalid', apiKeyEnv: 'TEST_KEY', model: 'api-test' },
    ...(guards ? { guards } : {}),
  } as any;
}

async function drain(gen: AsyncGenerator<any>) {
  const chunks: any[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

afterEach(() => {
  apiStreamDispatchWithHistoryMock.mockReset();
});

// A real existing file in the repo root (cwd during vitest) → fileExists() true,
// so grounded-write blocks an unread Edit of it. A net-new path under tmpdir does
// not exist → grounded-write always allows.
const EXISTING_PATH = 'package.json';
const NETNEW_PATH = `/tmp/agon-guards-netnew-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`;

describe('GuardPipeline integration — invariants mode', () => {
  it('(a) grounded-write: blocks an Edit to a never-read EXISTING path, passes after a Read; net-new Edit passes immediately', async () => {
    const home = setupTestAgonHome('guards-gw-invariants');
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');

      apiStreamDispatchWithHistoryMock
        // Step 1: Edit an EXISTING file we have NOT read → blocked.
        .mockImplementationOnce(() => streamStructuredToolCall('Edit', { file_path: EXISTING_PATH, old_string: 'a', new_string: 'b' }, 'call_e1'))
        // Step 2: Read that file (records it into the registry).
        .mockImplementationOnce(() => streamStructuredToolCall('Read', { file_path: EXISTING_PATH }, 'call_r1'))
        // Step 3: re-issue the SAME edit → now passes (read-then-edit).
        .mockImplementationOnce(() => streamStructuredToolCall('Edit', { file_path: EXISTING_PATH, old_string: 'a', new_string: 'b' }, 'call_e2'))
        // Step 4: Edit a NET-NEW (non-existent) path → passes immediately.
        .mockImplementationOnce(() => streamStructuredToolCall('Edit', { file_path: NETNEW_PATH, old_string: '', new_string: 'export const x = 1;' }, 'call_e3'))
        // Step 5: finish.
        .mockImplementationOnce(() => streamText('All set.'));

      const executed: Array<{ name: string; path: string }> = [];
      const session = createResumeSession({
        engine: apiEngine('api-gw-inv', 'invariants'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        nativeTools: [
          { type: 'function', function: { name: 'Edit', description: 'e', parameters: { type: 'object', properties: {} } } },
          { type: 'function', function: { name: 'Read', description: 'r', parameters: { type: 'object', properties: {} } } },
        ] as any,
        onToolCall: async (name: string, args: Record<string, unknown>) => {
          executed.push({ name, path: String((args as any).file_path ?? '') });
          return name === 'Read' ? 'file contents here' : 'ok';
        },
        toolLoopBaseBudget: 8,
        toolLoopMaxBudget: 8,
      });

      await session.start();
      await drain(session.send({ message: 'edit the manifest', toolLoopBaseBudget: 8, toolLoopMaxBudget: 8 }));

      // The first Edit (never-read existing path) was BLOCKED — onToolCall never
      // ran for it, and the next dispatch's history carries the block feedback.
      const history = session.getMessageHistory();
      const blockedMsg = history.find((m: any) => m.role === 'tool' && /\[BLOCKED: grounded-write\]/.test(String(m.content)));
      expect(blockedMsg).toBeDefined();
      expect(String(blockedMsg!.content)).toContain('have not read it this session');

      // The blocked first edit did NOT execute; the Read did; the post-read edit DID.
      const editExecs = executed.filter(e => e.name === 'Edit');
      const readExecs = executed.filter(e => e.name === 'Read');
      expect(readExecs.length).toBe(1);
      // Two edits executed: the post-read existing-file edit + the net-new edit.
      // (The first existing-file edit was blocked before onToolCall.)
      expect(editExecs.length).toBe(2);
      expect(editExecs.some(e => e.path.endsWith('package.json'))).toBe(true);
      expect(editExecs.some(e => e.path === NETNEW_PATH)).toBe(true);
    } finally {
      cleanupTestAgonHome(home);
    }
  }, 20000);

  it('(b) read-then-edit in ONE turn: Read then Edit the same path in a single step → no block', async () => {
    const home = setupTestAgonHome('guards-readthenedit');
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');

      apiStreamDispatchWithHistoryMock
        // ONE step batching a Read THEN an Edit of the same existing path.
        .mockImplementationOnce(async function* () {
          yield `<tool name="Read">${JSON.stringify({ file_path: EXISTING_PATH })}</tool>\n<tool name="Edit">${JSON.stringify({ file_path: EXISTING_PATH, old_string: 'a', new_string: 'b' })}</tool>`;
          return {
            parts: [
              { kind: 'tool_call', toolName: 'Read', toolCallId: 'call_rb', args: { file_path: EXISTING_PATH } },
              { kind: 'tool_call', toolName: 'Edit', toolCallId: 'call_eb', args: { file_path: EXISTING_PATH, old_string: 'a', new_string: 'b' } },
            ],
          };
        })
        .mockImplementationOnce(() => streamText('Done.'));

      const executed: string[] = [];
      const session = createResumeSession({
        engine: apiEngine('api-rte-inv', 'invariants'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        nativeTools: [
          { type: 'function', function: { name: 'Edit', description: 'e', parameters: { type: 'object', properties: {} } } },
          { type: 'function', function: { name: 'Read', description: 'r', parameters: { type: 'object', properties: {} } } },
        ] as any,
        onToolCall: async (name: string) => { executed.push(name); return name === 'Read' ? 'contents' : 'ok'; },
        toolLoopBaseBudget: 4,
        toolLoopMaxBudget: 4,
      });

      await session.start();
      await drain(session.send({ message: 'read then edit', toolLoopBaseBudget: 4, toolLoopMaxBudget: 4 }));

      // Both tools executed; no grounded-write block message in history.
      expect(executed).toContain('Read');
      expect(executed).toContain('Edit');
      const history = session.getMessageHistory();
      expect(history.some((m: any) => /\[BLOCKED: grounded-write\]/.test(String(m.content)))).toBe(false);
    } finally {
      cleanupTestAgonHome(home);
    }
  }, 20000);

  it('(c) DiagnosticRunner digest lands in the next dispatch context', async () => {
    // The Edit triggers the per-session DiagnosticRunner with an INJECTED fake
    // spawnFn (config.diagnosticDeps.spawnFn — the seam D3 now exposes) producing
    // one introduced tsc error in the edited file; a subsequent dispatch's
    // messageHistory carries a tool-role message starting '[diagnostics —'.
    //
    // Timing: the runner debounces 400ms per packageDir, so real time must pass
    // between the Edit (which fires noteEdit) and a drain. We use REAL timers
    // (fake timers would freeze the session loop's own awaits) and have the
    // second, final-text dispatch await ~700ms before yielding — during which the
    // debounce fires + the fake spawn resolves + the digest enqueues. The
    // final-text path drains pending diagnostics into history before finalizing.
    const home = setupTestAgonHome('guards-diag-digest');

    // Fixture package: a tsconfig.json (so discoverChecker resolves a tsc plan)
    // under a repo-root marker (package-lock.json halts the upward walk). The
    // EDITED file is net-new (does not exist) → grounded-write allows the Edit,
    // and discoverChecker keys off the .ts extension + the upward tsconfig, not
    // the file's existence.
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'diag-it-'));
    writeFileSync(join(fixtureRoot, 'package-lock.json'), '{}');
    const pkg = join(fixtureRoot, 'pkg');
    mkdirSync(join(pkg, 'src'), { recursive: true });
    writeFileSync(join(pkg, 'tsconfig.json'), '{}');
    const editedPath = join(pkg, 'src', 'edited.ts'); // net-new

    // Fake spawn: tsc-shaped stdout naming the edited file → one introduced error.
    // toRelPath strips the packageDir prefix → 'src/edited.ts', matching
    // normalizeEditedPath(editedPath, pkg) so the runner classifies it introduced.
    const spawnCalls: SpawnLike[] = [];
    const spawnFn = vi.fn(async (opts: SpawnLike): Promise<DispatchResult> => {
      spawnCalls.push(opts);
      const errLine = `${pkg}/src/edited.ts(2,5): error TS2304: Cannot find name 'foo'.`;
      return { exitCode: 2, stdout: errLine, stderr: '', durationMs: 3, timedOut: false };
    });

    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');

      apiStreamDispatchWithHistoryMock
        // Step 1: a net-new Edit → grounded-write allows; noteEdit arms the runner.
        .mockImplementationOnce(() => streamStructuredToolCall('Edit', { file_path: editedPath, old_string: '', new_string: 'export const x = 1;' }, 'call_diag_e'))
        // Step 2: final text — but await > debounce(400)+slack so by this turn's
        // drain the digest has been produced. No tools → final-text drain path.
        .mockImplementationOnce(async function* () {
          await new Promise((r) => setTimeout(r, 700));
          yield 'Edited the file.';
          return {};
        });

      const session = createResumeSession({
        engine: apiEngine('api-diag-inv', 'invariants'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        nativeTools: [
          { type: 'function', function: { name: 'Edit', description: 'e', parameters: { type: 'object', properties: {} } } },
        ] as any,
        onToolCall: async () => 'ok',
        diagnosticDeps: { spawnFn },
        toolLoopBaseBudget: 4,
        toolLoopMaxBudget: 4,
      });

      await session.start();
      await drain(session.send({ message: 'edit it', toolLoopBaseBudget: 4, toolLoopMaxBudget: 4 }));

      // The injected fake spawn ran (no real tsc), and the introduced-error
      // digest landed as a tool-role message beginning '[diagnostics —'.
      expect(spawnFn).toHaveBeenCalled();
      const history = session.getMessageHistory();
      const diagIdx = history.findIndex((m: any) => m.role === 'tool' && /^\[diagnostics —/.test(String(m.content)));
      expect(diagIdx).toBeGreaterThanOrEqual(0);
      const diagMsg = history[diagIdx] as any;
      expect(String(diagMsg.content)).toContain('src/edited.ts');
      // FIX 4: the digest tool message is now provider-correct — it is preceded by
      // an assistant message carrying a matching tool_calls entry (no orphan tool
      // message, which OpenAI/Anthropic reject). The ids line up (diag-<n>).
      const diagId = String(diagMsg.tool_call_id);
      expect(diagId).toMatch(/^diag-\d+$/);
      const pairedAssistant = history[diagIdx - 1] as any;
      expect(pairedAssistant?.role).toBe('assistant');
      expect(Array.isArray(pairedAssistant?.tool_calls)).toBe(true);
      expect(pairedAssistant.tool_calls.some((tc: any) => tc.id === diagId && tc.function?.name === 'Diagnostic')).toBe(true);
    } finally {
      cleanupTestAgonHome(home);
      try { rmSync(fixtureRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }, 20000);

  it('(d) info-gain: same-file-set re-reads fire the stall nudge; reading DIFFERENT files never does', async () => {
    // 4 consecutive STALL steps (STALL_NUDGE_STEP = 4) fire the nudge. Step 1
    // establishes the read set (new info → not a stall); steps 2-5 re-read the
    // SAME set (no new info → stalls 1..4) → nudge at the 4th stall.
    const home = setupTestAgonHome('guards-infogain-same');
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');

      apiStreamDispatchWithHistoryMock
        .mockImplementationOnce(() => streamReadSet(['src/a.ts', 'src/b.ts'], 1)) // establish
        .mockImplementationOnce(() => streamReadSet(['src/a.ts', 'src/b.ts'], 2)) // stall 1
        .mockImplementationOnce(() => streamReadSet(['src/a.ts', 'src/b.ts'], 3)) // stall 2
        .mockImplementationOnce(() => streamReadSet(['src/a.ts', 'src/b.ts'], 4)) // stall 3
        .mockImplementationOnce(() => streamReadSet(['src/a.ts', 'src/b.ts'], 5)) // stall 4 → nudge
        .mockImplementationOnce(() => streamText('Done after the nudge.'));

      const session = createResumeSession({
        engine: apiEngine('api-ig-same', 'invariants'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        onToolCall: async () => 'same contents',
        toolLoopBaseBudget: 8,
        toolLoopMaxBudget: 8,
      });

      await session.start();
      const chunks = await drain(session.send({ message: 'spin', toolLoopBaseBudget: 8, toolLoopMaxBudget: 8 }));

      // The info-gain stall nudge fired (status chunk) for the same-set re-reads.
      expect(chunks.some((c: any) => c.type === 'status' && /information-gain nudge/.test(String(c.content)))).toBe(true);
    } finally {
      cleanupTestAgonHome(home);
    }
  }, 20000);

  it('(d2) info-gain: 4 DIFFERENT file sets read in a row → NO stall nudge', async () => {
    const home = setupTestAgonHome('guards-infogain-diff');
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');

      apiStreamDispatchWithHistoryMock
        .mockImplementationOnce(() => streamReadSet(['src/a.ts'], 1))
        .mockImplementationOnce(() => streamReadSet(['src/b.ts'], 2))
        .mockImplementationOnce(() => streamReadSet(['src/c.ts'], 3))
        .mockImplementationOnce(() => streamReadSet(['src/d.ts'], 4))
        .mockImplementationOnce(() => streamText('Done — all fresh reads.'));

      const session = createResumeSession({
        engine: apiEngine('api-ig-diff', 'invariants'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        onToolCall: async () => 'fresh contents',
        toolLoopBaseBudget: 8,
        toolLoopMaxBudget: 8,
      });

      await session.start();
      const chunks = await drain(session.send({ message: 'fresh reads', toolLoopBaseBudget: 8, toolLoopMaxBudget: 8 }));

      // Each step introduced a NEW file path → no stall → no nudge, no hard stop.
      expect(chunks.some((c: any) => c.type === 'status' && /information-gain nudge/.test(String(c.content)))).toBe(false);
      expect(chunks.some((c: any) => c.type === 'error' && /information-gain hard stop/.test(String(c.content)))).toBe(false);
      expect(chunks.some((c: any) => c.type === 'text' && /all fresh reads/.test(String(c.content)))).toBe(true);
    } finally {
      cleanupTestAgonHome(home);
    }
  }, 20000);

  it('(d3) FIX 1: 4 identical Glob steps (path-arg search dir) fire the stall nudge — the search loop no longer evades the ladder', async () => {
    // BEFORE FIX 1: a Glob with a `path` arg added that search DIRECTORY to
    // currentStepReadPaths, but the registry only ever records Glob RESULT paths,
    // so the directory was never in everReadPaths → the subset check failed → the
    // identical Glob loop was never a stall and the ladder was evaded. With FIX 1
    // the Glob arg-path is dropped (readCallPath → null for Glob), so a duplicate
    // Glob step is an EMPTY set (trivially ⊆ everReadPaths) and stalls on its zero
    // info-gain (same cache key + same result paths). Step 1 establishes (new
    // info), steps 2-5 are stalls 1..4 → nudge at the 4th (STALL_NUDGE_STEP = 4).
    const home = setupTestAgonHome('guards-fix1-glob-loop');
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');

      // Identical Glob every step: same pattern + same search dir → same cache key.
      // Its RESULT is a fixed file list under that dir (the dir itself is NOT in it).
      // Step 1 establishes the cache key (new info). Step 2 is NOT yet a stall: the
      // result-path info-gain channel has a built-in ONE-STEP LAG (a step's Glob
      // result paths feed the NEXT step's computeInfoGain), so step 2 sees step 1's
      // result paths as new info. From step 3 on, both the cache key AND the result
      // paths are already seen → zero gain → stalls 1..4 across steps 3-6 → nudge at
      // the 4th stall (step 6). This lag is why the Glob loop needs one more step
      // than the Read loop in (d) to reach the same nudge.
      const GLOB_DIR = '/repo/src';
      const GLOB_RESULT = ['/repo/src/a.ts', '/repo/src/b.ts'].join('\n');
      apiStreamDispatchWithHistoryMock
        .mockImplementationOnce(() => streamGlob('**/*.ts', GLOB_DIR, 1)) // establish key
        .mockImplementationOnce(() => streamGlob('**/*.ts', GLOB_DIR, 2)) // lag: result paths new
        .mockImplementationOnce(() => streamGlob('**/*.ts', GLOB_DIR, 3)) // stall 1
        .mockImplementationOnce(() => streamGlob('**/*.ts', GLOB_DIR, 4)) // stall 2
        .mockImplementationOnce(() => streamGlob('**/*.ts', GLOB_DIR, 5)) // stall 3
        .mockImplementationOnce(() => streamGlob('**/*.ts', GLOB_DIR, 6)) // stall 4 → nudge
        .mockImplementationOnce(() => streamText('Done after the nudge.'));

      const session = createResumeSession({
        engine: apiEngine('api-fix1-glob', 'invariants'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        nativeTools: [
          { type: 'function', function: { name: 'Glob', description: 'g', parameters: { type: 'object', properties: {} } } },
        ] as any,
        // Every identical Glob returns the SAME result file list → no new info.
        onToolCall: async () => GLOB_RESULT,
        toolLoopBaseBudget: 10,
        toolLoopMaxBudget: 10,
      });

      await session.start();
      const chunks = await drain(session.send({ message: 'glob loop', toolLoopBaseBudget: 10, toolLoopMaxBudget: 10 }));

      // The info-gain stall nudge fired for the identical-Glob search loop.
      expect(chunks.some((c: any) => c.type === 'status' && /information-gain nudge/.test(String(c.content)))).toBe(true);
    } finally {
      cleanupTestAgonHome(home);
    }
  }, 20000);

  it('(d4) FIX 1: Glob steps with DIFFERENT patterns each step → NO stall nudge (new cache keys = real info gain)', async () => {
    // A Glob with a NEW pattern each step yields a new cache key (full-arg key) →
    // computeInfoGain counts it → gain > 0 → not a stall. The search loop guard
    // must not false-positive on genuine narrowing/widening searches.
    const home = setupTestAgonHome('guards-fix1-glob-diff');
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');

      const GLOB_DIR = '/repo/src';
      apiStreamDispatchWithHistoryMock
        .mockImplementationOnce(() => streamGlob('**/*.ts', GLOB_DIR, 1))
        .mockImplementationOnce(() => streamGlob('**/*.tsx', GLOB_DIR, 2))
        .mockImplementationOnce(() => streamGlob('**/*.kern', GLOB_DIR, 3))
        .mockImplementationOnce(() => streamGlob('**/*.json', GLOB_DIR, 4))
        .mockImplementationOnce(() => streamText('Done — all distinct searches.'));

      let n = 0;
      const session = createResumeSession({
        engine: apiEngine('api-fix1-glob-diff', 'invariants'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        nativeTools: [
          { type: 'function', function: { name: 'Glob', description: 'g', parameters: { type: 'object', properties: {} } } },
        ] as any,
        // Distinct patterns → distinct result file lists too (extra info gain).
        onToolCall: async () => `/repo/src/file_${n++}.ts`,
        toolLoopBaseBudget: 8,
        toolLoopMaxBudget: 8,
      });

      await session.start();
      const chunks = await drain(session.send({ message: 'distinct globs', toolLoopBaseBudget: 8, toolLoopMaxBudget: 8 }));

      // Each step's new pattern is new info → no stall → no nudge, no hard stop.
      expect(chunks.some((c: any) => c.type === 'status' && /information-gain nudge/.test(String(c.content)))).toBe(false);
      expect(chunks.some((c: any) => c.type === 'error' && /information-gain hard stop/.test(String(c.content)))).toBe(false);
      expect(chunks.some((c: any) => c.type === 'text' && /all distinct searches/.test(String(c.content)))).toBe(true);
    } finally {
      cleanupTestAgonHome(home);
    }
  }, 20000);

  it('(h) FIX 2: compaction persists readPaths — a restart after compact() keeps grounded reads', async () => {
    // BEFORE FIX 2: doCompact()'s saveSessionState omitted readPaths, so a restart
    // right after a compaction forgot every grounded read (and falsely re-blocked
    // edits of files read this session). This test grounds several reads in an
    // invariants + sessionContinuity session, triggers compact(), then reloads the
    // persisted state and asserts readPaths survived the compaction save.
    const prevDisable = process.env.AGON_DISABLE_LLM_COMPACTION;
    process.env.AGON_DISABLE_LLM_COMPACTION = '1'; // deterministic regex summary — no HTTP
    const home = setupTestAgonHome('guards-fix2-compact-readpaths');
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
      const { loadSessionState } = await import('../../packages/core/src/generated/signals/session-store.js');
      const { canonicalizePath } = await import('../../packages/core/src/generated/guards/read-path-registry.js');

      const ENGINE_ID = 'api-fix2-compact';
      // Read enough DISTINCT existing files across steps that messageHistory grows
      // well past COMPACT_KEEP_TAIL (8) so doCompact has an `old` segment to fold.
      const files = ['package.json', 'tsconfig.json', 'README.md', 'CLAUDE.md', 'package-lock.json', 'vitest.config.ts'];
      const mock = apiStreamDispatchWithHistoryMock;
      for (let i = 0; i < files.length; i++) {
        mock.mockImplementationOnce(() => streamReadSet([files[i]], i + 1));
      }
      mock.mockImplementationOnce(() => streamText('Read them all.'));

      const session = createResumeSession({
        engine: apiEngine(ENGINE_ID, 'invariants'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        sessionContinuity: true, // persistence ON so compact() saves to disk
        onToolCall: async () => 'file contents here',
        toolLoopBaseBudget: 10,
        toolLoopMaxBudget: 10,
      });

      await session.start();
      await drain(session.send({ message: 'read the configs', toolLoopBaseBudget: 10, toolLoopMaxBudget: 10 }));

      // Sanity: enough history accumulated that compaction will have an old segment.
      expect(session.getMessageHistory().length).toBeGreaterThan(9);

      // Compact in place — this is the save path FIX 2 patched.
      const result = await session.compact();
      expect(result.method).not.toBe('none'); // it actually folded an old segment

      // Reload the persisted state: readPaths must carry the grounded reads.
      const reloaded = loadSessionState(ENGINE_ID);
      expect(reloaded).not.toBeNull();
      expect(Array.isArray(reloaded!.readPaths)).toBe(true);
      expect(reloaded!.readPaths.length).toBeGreaterThan(0);
      // At least one of the read files (canonicalized) survived the compaction save.
      const canonRead = new Set(reloaded!.readPaths);
      expect(files.some(f => canonRead.has(canonicalizePath(f)))).toBe(true);
    } finally {
      if (prevDisable === undefined) delete process.env.AGON_DISABLE_LLM_COMPACTION;
      else process.env.AGON_DISABLE_LLM_COMPACTION = prevDisable;
      cleanupTestAgonHome(home);
    }
  }, 25000);

  it('(e) evidence: a completion claim with NO successful mutating tool → ONE corrective injection then pass-through', async () => {
    const home = setupTestAgonHome('guards-evidence-claim');
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');

      let claimDispatches = 0;
      apiStreamDispatchWithHistoryMock.mockImplementation(async function* () {
        claimDispatches++;
        // Both dispatches make the same unsupported completion claim, no tools.
        yield 'All done, the bug is fixed.';
        return {};
      });

      const session = createResumeSession({
        engine: apiEngine('api-evid-claim', 'invariants'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        onToolCall: async () => 'unused',
        toolLoopBaseBudget: 4,
        toolLoopMaxBudget: 4,
      });

      await session.start();
      const chunks = await drain(session.send({ message: 'fix the bug', toolLoopBaseBudget: 4, toolLoopMaxBudget: 4 }));

      // The evidence invariant nudged once (status chunk) and injected the
      // corrective [EVIDENCE] user message; then it passed through (exhausted).
      const evidenceStatuses = chunks.filter((c: any) => c.type === 'status' && /evidence invariant/.test(String(c.content)));
      expect(evidenceStatuses.length).toBe(1);
      const history = session.getMessageHistory();
      expect(history.some((m: any) => m.role === 'user' && /\[EVIDENCE\]/.test(String(m.content)))).toBe(true);
      // It re-dispatched once (the corrective continue), then accepted the claim.
      expect(claimDispatches).toBe(2);
      expect(chunks.some((c: any) => c.type === 'text' && /All done, the bug is fixed/.test(String(c.content)))).toBe(true);
    } finally {
      cleanupTestAgonHome(home);
    }
  }, 20000);

  it('(a2) FIX 1: a Read in turn 1 grounds an Edit of the same path in turn 2 (SAME in-process session, no sessionContinuity)', async () => {
    // The ReadPathRegistry is now ONE instance per session object, shared across
    // send() calls — NOT recreated per send(). So a read in turn 1 must still
    // ground a grounded-write check in turn 2 even with sessionContinuity OFF
    // (the default), which never touches disk. Before FIX 1 the per-send registry
    // forgot turn 1's read and wrongly BLOCKED the turn-2 edit.
    const home = setupTestAgonHome('guards-fix1-cross-turn');
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');

      const executed: Array<{ name: string; path: string }> = [];
      const session = createResumeSession({
        engine: apiEngine('api-fix1-xturn', 'invariants'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        nativeTools: [
          { type: 'function', function: { name: 'Edit', description: 'e', parameters: { type: 'object', properties: {} } } },
          { type: 'function', function: { name: 'Read', description: 'r', parameters: { type: 'object', properties: {} } } },
        ] as any,
        onToolCall: async (name: string, args: Record<string, unknown>) => {
          executed.push({ name, path: String((args as any).file_path ?? '') });
          return name === 'Read' ? 'file contents here' : 'ok';
        },
        // NOTE: sessionContinuity is NOT set → defaults off (no disk persistence).
        toolLoopBaseBudget: 4,
        toolLoopMaxBudget: 4,
      });

      await session.start();

      // ── Turn 1: Read the existing file, then finish. ──
      apiStreamDispatchWithHistoryMock
        .mockImplementationOnce(() => streamStructuredToolCall('Read', { file_path: EXISTING_PATH }, 'call_t1_r'))
        .mockImplementationOnce(() => streamText('Read it.'));
      await drain(session.send({ message: 'read the manifest', toolLoopBaseBudget: 4, toolLoopMaxBudget: 4 }));

      apiStreamDispatchWithHistoryMock.mockReset();

      // ── Turn 2 (SAME session object): Edit that same path, then finish. ──
      // The hoisted registry still remembers turn 1's read → NOT blocked.
      apiStreamDispatchWithHistoryMock
        .mockImplementationOnce(() => streamStructuredToolCall('Edit', { file_path: EXISTING_PATH, old_string: 'a', new_string: 'b' }, 'call_t2_e'))
        .mockImplementationOnce(() => streamText('Edited.'));
      const turn2 = await drain(session.send({ message: 'now edit it', toolLoopBaseBudget: 4, toolLoopMaxBudget: 4 }));

      // The turn-2 Edit executed (the cross-turn read grounded it) and NO
      // grounded-write block landed this turn.
      expect(executed.some(e => e.name === 'Edit' && e.path.endsWith('package.json'))).toBe(true);
      expect(turn2.some((c: any) => c.type === 'status' && /grounded-write: read the file/.test(String(c.content)))).toBe(false);
      const history = session.getMessageHistory();
      expect(history.some((m: any) => /\[BLOCKED: grounded-write\]/.test(String(m.content)))).toBe(false);
    } finally {
      cleanupTestAgonHome(home);
    }
  }, 20000);

  it('(g) write-spin: re-issuing the SAME unread Edit 3× hard-stops the loop with the write-spin error', async () => {
    // R3 FIX 4: a model re-issuing the same ungrounded Edit gets a grounded-write
    // block every step (the info-gain ladder only watches read-only steps). The
    // write-spin ladder bounds it: on the 3rd consecutive identical-blocked-set
    // block, the loop hard-stops with the write-spin error text.
    const home = setupTestAgonHome('guards-write-spin-stop');
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');

      // The model NEVER reads — it just re-issues the same unread Edit forever.
      apiStreamDispatchWithHistoryMock.mockImplementation(() =>
        streamStructuredToolCall('Edit', { file_path: EXISTING_PATH, old_string: 'a', new_string: 'b' }, `call_ws_${Math.random()}`),
      );

      const executed: string[] = [];
      const session = createResumeSession({
        engine: apiEngine('api-write-spin', 'invariants'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        nativeTools: [
          { type: 'function', function: { name: 'Edit', description: 'e', parameters: { type: 'object', properties: {} } } },
          { type: 'function', function: { name: 'Read', description: 'r', parameters: { type: 'object', properties: {} } } },
        ] as any,
        onToolCall: async (name: string, args: Record<string, unknown>) => {
          executed.push(name);
          return name === 'Read' ? 'file contents here' : 'ok';
        },
        toolLoopBaseBudget: 12,
        toolLoopMaxBudget: 12,
      });

      await session.start();
      const chunks = await drain(session.send({ message: 'edit the manifest', toolLoopBaseBudget: 12, toolLoopMaxBudget: 12 }));

      // The loop hard-stopped with the write-spin error text (3rd identical block).
      const stopErr = chunks.find((c: any) => c.type === 'error' && /kept re-issuing writes to unread file\(s\)/.test(String(c.content)));
      expect(stopErr).toBeDefined();
      expect(String(stopErr!.content)).toContain('instead of reading them first');
      // No Edit ever executed (every re-issue was an ungrounded block).
      expect(executed.filter(n => n === 'Edit').length).toBe(0);
      // The loop stopped well before the 12-step budget (3 blocks, not 12).
      const history = session.getMessageHistory();
      expect(history.some((m: any) => m.role === 'assistant' && /write-spin hard stop/.test(String(m.content)))).toBe(true);
    } finally {
      cleanupTestAgonHome(home);
    }
  }, 20000);

  it('(g3) codex FIX 2: interleaving a RetrieveResult (NOT a grounding read) does NOT reset the write-spin — still hard-stops', async () => {
    // RetrieveResult is in READ_TOOLS (for the solo-coding gate) but it only
    // re-fetches a cached tool result — it grounds NOTHING. Before FIX 2 the
    // write-spin reset counted any READ_TOOLS member as recovery, so a model
    // interleaving a RetrieveResult between identical ungrounded Edits would dodge
    // the hard stop forever. With FIX 2 only Read/Grep/Glob count, so the spin
    // still trips on the 3rd identical-blocked-set block.
    const home = setupTestAgonHome('guards-write-spin-retrieve');
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');

      // Each step issues BOTH the blocked unread Edit AND a RetrieveResult — the
      // RetrieveResult must NOT count as a grounding read for the write-spin reset.
      async function* streamEditPlusRetrieve(seq: number) {
        const edit = { file_path: EXISTING_PATH, old_string: 'a', new_string: 'b' };
        yield `\n<tool name="Edit">${JSON.stringify(edit)}</tool>\n<tool name="RetrieveResult">${JSON.stringify({ id: 'nope' })}</tool>\n`;
        return {
          parts: [
            { kind: 'tool_call', toolName: 'Edit', toolCallId: `call_wsr_e_${seq}`, args: edit },
            { kind: 'tool_call', toolName: 'RetrieveResult', toolCallId: `call_wsr_r_${seq}`, args: { id: 'nope' } },
          ],
        };
      }
      let seq = 0;
      apiStreamDispatchWithHistoryMock.mockImplementation(() => streamEditPlusRetrieve(seq++));

      const executed: string[] = [];
      const session = createResumeSession({
        engine: apiEngine('api-write-spin-retrieve', 'invariants'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        nativeTools: [
          { type: 'function', function: { name: 'Edit', description: 'e', parameters: { type: 'object', properties: {} } } },
          { type: 'function', function: { name: 'Read', description: 'r', parameters: { type: 'object', properties: {} } } },
        ] as any,
        onToolCall: async (name: string, args: Record<string, unknown>) => {
          executed.push(name);
          return name === 'Read' ? 'file contents here' : 'ok';
        },
        toolLoopBaseBudget: 12,
        toolLoopMaxBudget: 12,
      });

      await session.start();
      const chunks = await drain(session.send({ message: 'edit the manifest', toolLoopBaseBudget: 12, toolLoopMaxBudget: 12 }));

      // The RetrieveResult never reset the spin → it hard-stopped (3rd identical block).
      const stopErr = chunks.find((c: any) => c.type === 'error' && /kept re-issuing writes to unread file\(s\)/.test(String(c.content)));
      expect(stopErr).toBeDefined();
      const history = session.getMessageHistory();
      expect(history.some((m: any) => m.role === 'assistant' && /write-spin hard stop/.test(String(m.content)))).toBe(true);
      // The Edit was never executed (every re-issue stayed an ungrounded block).
      expect(executed.filter(n => n === 'Edit').length).toBe(0);
    } finally {
      cleanupTestAgonHome(home);
    }
  }, 20000);

  it('(g2) write-spin: interleaving a Read of the path resets the spin — the edit passes, NO hard stop', async () => {
    // R3 FIX 4: a Read executing in the batch (or a later step) resets the
    // write-spin counter and grounds the path, so the subsequent Edit passes and
    // the loop never hard-stops.
    const home = setupTestAgonHome('guards-write-spin-recover');
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');

      apiStreamDispatchWithHistoryMock
        // Step 1: Edit the unread existing path → blocked (write-spin count = 1).
        .mockImplementationOnce(() => streamStructuredToolCall('Edit', { file_path: EXISTING_PATH, old_string: 'a', new_string: 'b' }, 'call_wr_e1'))
        // Step 2: the model READS the path (recovery) → grounds it, resets the spin.
        .mockImplementationOnce(() => streamStructuredToolCall('Read', { file_path: EXISTING_PATH }, 'call_wr_r'))
        // Step 3: re-issue the SAME Edit → now grounded → passes.
        .mockImplementationOnce(() => streamStructuredToolCall('Edit', { file_path: EXISTING_PATH, old_string: 'a', new_string: 'b' }, 'call_wr_e2'))
        // Step 4: finish.
        .mockImplementationOnce(() => streamText('Edited it.'));

      const executed: Array<{ name: string; path: string }> = [];
      const session = createResumeSession({
        engine: apiEngine('api-write-recover', 'invariants'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        nativeTools: [
          { type: 'function', function: { name: 'Edit', description: 'e', parameters: { type: 'object', properties: {} } } },
          { type: 'function', function: { name: 'Read', description: 'r', parameters: { type: 'object', properties: {} } } },
        ] as any,
        onToolCall: async (name: string, args: Record<string, unknown>) => {
          executed.push({ name, path: String((args as any).file_path ?? '') });
          return name === 'Read' ? 'file contents here' : 'ok';
        },
        toolLoopBaseBudget: 8,
        toolLoopMaxBudget: 8,
      });

      await session.start();
      const chunks = await drain(session.send({ message: 'edit the manifest', toolLoopBaseBudget: 8, toolLoopMaxBudget: 8 }));

      // No write-spin hard stop fired.
      expect(chunks.some((c: any) => c.type === 'error' && /kept re-issuing writes to unread file\(s\)/.test(String(c.content)))).toBe(false);
      // The post-read Edit executed (the Read grounded the path).
      expect(executed.some(e => e.name === 'Read')).toBe(true);
      expect(executed.some(e => e.name === 'Edit' && e.path.endsWith('package.json'))).toBe(true);
      expect(chunks.some((c: any) => c.type === 'text' && /Edited it/.test(String(c.content)))).toBe(true);
    } finally {
      cleanupTestAgonHome(home);
    }
  }, 20000);

  it('(a3) codex FIX 1: a cross-engine conversation handoff carries readPaths → engine B can Edit the path engine A read without a block', async () => {
    // Engine A reads EXISTING_PATH and hands off via saveConversation(..., readPaths).
    // Engine B boots under sessionContinuity, takes the CROSS-ENGINE restore branch,
    // and restores the registry from conversation.readPaths (the replayed history's
    // tool_calls were flattened to text by stripEngineArtifacts, so derivation is
    // impossible — readPaths is the only channel). Engine B's Edit of that path is
    // therefore grounded and NOT blocked.
    const home = setupTestAgonHome('guards-fix1-cross-engine-handoff');
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
      const { saveConversation } = await import('../../packages/core/src/generated/signals/session-store.js');
      const { canonicalizePath } = await import('../../packages/core/src/generated/guards/read-path-registry.js');

      // ── Engine A's handoff: a stripped-style conversation + the serialized
      //    read set (canonical, exactly what getReadPaths() would produce). ──
      saveConversation(
        [
          { role: 'user', content: 'read the manifest' },
          // Tool calls here get flattened to a text marker on save AND load — they
          // carry NO read-path information by the time engine B sees them.
          { role: 'assistant', content: null, tool_calls: [{ id: 'a1', function: { name: 'Read', arguments: JSON.stringify({ file_path: EXISTING_PATH }) } }] },
          { role: 'tool', content: 'manifest contents', tool_call_id: 'a1' },
        ],
        'engine-a',
        [canonicalizePath(EXISTING_PATH)],
      );

      const executed: Array<{ name: string; path: string }> = [];
      const session = createResumeSession({
        engine: apiEngine('engine-b', 'invariants'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        sessionContinuity: true, // boot from the cross-engine conversation store
        nativeTools: [
          { type: 'function', function: { name: 'Edit', description: 'e', parameters: { type: 'object', properties: {} } } },
          { type: 'function', function: { name: 'Read', description: 'r', parameters: { type: 'object', properties: {} } } },
        ] as any,
        onToolCall: async (name: string, args: Record<string, unknown>) => {
          executed.push({ name, path: String((args as any).file_path ?? '') });
          return name === 'Read' ? 'file contents here' : 'ok';
        },
        toolLoopBaseBudget: 4,
        toolLoopMaxBudget: 4,
      });

      await session.start();

      // Engine B's FIRST action: Edit the path engine A read — must NOT be blocked.
      apiStreamDispatchWithHistoryMock
        .mockImplementationOnce(() => streamStructuredToolCall('Edit', { file_path: EXISTING_PATH, old_string: 'a', new_string: 'b' }, 'call_b_e'))
        .mockImplementationOnce(() => streamText('Edited.'));
      const chunks = await drain(session.send({ message: 'now edit it', toolLoopBaseBudget: 4, toolLoopMaxBudget: 4 }));

      // The Edit executed (cross-engine readPaths grounded it) and NO grounded-write
      // block fired this turn.
      expect(executed.some(e => e.name === 'Edit' && e.path.endsWith('package.json'))).toBe(true);
      expect(chunks.some((c: any) => c.type === 'status' && /grounded-write: read the file/.test(String(c.content)))).toBe(false);
      const history = session.getMessageHistory();
      expect(history.some((m: any) => /\[BLOCKED: grounded-write\]/.test(String(m.content)))).toBe(false);
    } finally {
      cleanupTestAgonHome(home);
    }
  }, 20000);

  it('(e2) evidence: a completion claim WITH a successful Edit that turn → NO injection', async () => {
    const home = setupTestAgonHome('guards-evidence-supported');
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');

      apiStreamDispatchWithHistoryMock
        // Step 1: a successful net-new Edit (a mutating tool result = evidence).
        .mockImplementationOnce(() => streamStructuredToolCall('Edit', { file_path: NETNEW_PATH, old_string: '', new_string: 'export const y = 2;' }, 'call_ev_e'))
        // Step 2: claim completion — now SUPPORTED by the edit → no nudge.
        .mockImplementationOnce(() => streamText('All done, the bug is fixed.'));

      const session = createResumeSession({
        engine: apiEngine('api-evid-ok', 'invariants'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        nativeTools: [
          { type: 'function', function: { name: 'Edit', description: 'e', parameters: { type: 'object', properties: {} } } },
        ] as any,
        onToolCall: async () => 'ok',
        toolLoopBaseBudget: 4,
        toolLoopMaxBudget: 4,
      });

      await session.start();
      const chunks = await drain(session.send({ message: 'fix the bug', toolLoopBaseBudget: 4, toolLoopMaxBudget: 4 }));

      // No evidence nudge — the successful Edit IS the evidence for the claim.
      expect(chunks.some((c: any) => c.type === 'status' && /evidence invariant/.test(String(c.content)))).toBe(false);
      const history = session.getMessageHistory();
      expect(history.some((m: any) => m.role === 'user' && /\[EVIDENCE\]/.test(String(m.content)))).toBe(false);
    } finally {
      cleanupTestAgonHome(home);
    }
  }, 20000);
});

describe('GuardPipeline integration — shadow mode', () => {
  it('(f) shadow: the grounded-write scenario is NOT blocked, but the counters file records a grounded-write fire', async () => {
    const prevTelemetry = process.env.AGON_GUARD_TELEMETRY;
    process.env.AGON_GUARD_TELEMETRY = '1';
    const home = setupTestAgonHome('guards-shadow-gw');
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
      const { readGuardCounters } = await import('../../packages/core/src/telemetry.js');

      apiStreamDispatchWithHistoryMock
        // Edit an EXISTING file we never read — would BLOCK under invariants, but
        // shadow downgrades the block to allow (records the would-have-fired).
        .mockImplementationOnce(() => streamStructuredToolCall('Edit', { file_path: EXISTING_PATH, old_string: 'a', new_string: 'b' }, 'call_sh_e'))
        .mockImplementationOnce(() => streamText('Edited.'));

      const executed: string[] = [];
      const session = createResumeSession({
        engine: apiEngine('api-shadow-gw', 'shadow'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        nativeTools: [
          { type: 'function', function: { name: 'Edit', description: 'e', parameters: { type: 'object', properties: {} } } },
        ] as any,
        onToolCall: async (name: string) => { executed.push(name); return 'ok'; },
        toolLoopBaseBudget: 4,
        toolLoopMaxBudget: 4,
      });

      await session.start();
      await drain(session.send({ message: 'edit unread', toolLoopBaseBudget: 4, toolLoopMaxBudget: 4 }));

      // Shadow NEVER blocks: the edit executed and no block feedback landed.
      expect(executed).toContain('Edit');
      const history = session.getMessageHistory();
      expect(history.some((m: any) => /\[BLOCKED: grounded-write\]/.test(String(m.content)))).toBe(false);

      // …but telemetry recorded the would-have-fired grounded-write fire.
      const counters = readGuardCounters();
      const cell = counters?.byEngineGuard?.['api-shadow-gw']?.['grounded-write'];
      expect(cell?.fires).toBe(1);
    } finally {
      if (prevTelemetry === undefined) delete process.env.AGON_GUARD_TELEMETRY;
      else process.env.AGON_GUARD_TELEMETRY = prevTelemetry;
      cleanupTestAgonHome(home);
    }
  }, 20000);
});
