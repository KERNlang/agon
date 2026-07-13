import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { shouldUseCompanionForAgent, buildCommand, resolveArgs, computeEngineIsolation, resolveClaudePtyExtraArgs, answerChannelMode, fileChannelInstruction, readAnswerChannelFile, setupFileAnswerChannel, createStringSet } from '../../packages/adapter-cli/src/generated/adapter-helpers.js';

describe('adapter helper routing', () => {
  it('creates a real string Set for repeated baseline-diff membership checks', () => {
    const values = createStringSet(['diff --git a/a.ts b/a.ts', 'diff --git a/a.ts b/a.ts']);
    expect(values).toBeInstanceOf(Set);
    expect(values.size).toBe(1);
    expect(values.has('diff --git a/a.ts b/a.ts')).toBe(true);
    expect(values.has('diff --git a/b.ts b/b.ts')).toBe(false);
  });

  it('uses one-shot agent companion only for JSON-RPC engines', () => {
    expect(shouldUseCompanionForAgent({ id: 'codex', companion: { protocol: 'jsonrpc' } } as any)).toBe(true);
    expect(shouldUseCompanionForAgent({ id: 'gemini', companion: { protocol: 'acp' } } as any)).toBe(false);
    expect(shouldUseCompanionForAgent({ id: 'claude', companion: { protocol: 'stream-json' } } as any)).toBe(false);
    expect(shouldUseCompanionForAgent({ id: 'plain' } as any)).toBe(false);
  });
});

describe('cwd templating (worktree isolation)', () => {
  it('resolveArgs substitutes {cwd} with the dispatch directory', () => {
    expect(resolveArgs(['run', '--dir', '{cwd}', '{prompt}'], { cwd: '/wt/x', prompt: 'hi' }))
      .toEqual(['run', '--dir', '/wt/x', 'hi']);
  });

  // Regression: opencode ignores the spawn cwd / attaches to a shared server in
  // the launch repo, so its CLI args MUST carry an explicit --dir <worktree> or
  // engine writes leak into the parent repo (goal --cwd isolation bug).
  it('opencode CLI command pins --dir to the dispatch cwd in every mode', () => {
    const opencode = {
      id: 'opencode',
      agent: { args: ['run', '--dir', '{cwd}', '{prompt}'] },
      exec: { args: ['run', '--dir', '{cwd}', '--format', 'json', '{prompt}'] },
      review: { args: ['run', '--dir', '{cwd}', '--format', 'json', '{prompt}'] },
    } as any;
    for (const mode of ['agent', 'exec', 'review'] as const) {
      const { args } = buildCommand(opencode, mode, 'do it', '/wt/task-7', 180, 'opencode');
      const i = args.indexOf('--dir');
      expect(i).toBeGreaterThanOrEqual(0);
      expect(args[i + 1]).toBe('/wt/task-7');
    }
  });
});

// The pure planner (planEngineIsolation) is covered in engine-isolation.test.ts;
// this exercises the ADAPTER wrapper that materialises the clean dir, seeds
// file creds, and computes `authenticated` from the on-disk authMarker — the
// actual runtime path. Hermetic: AGON_HOME (→ agonPath('pure', id)) and the
// engine's real config home are both redirected to temp dirs.
describe('computeEngineIsolation (auth-gated clean-dir materialisation)', () => {
  let agonHome: string;
  let codexRealHome: string;
  const savedAgonHome = process.env.AGON_HOME;
  const savedIsolation = process.env.AGON_ENGINE_ISOLATION;
  const savedCodexHome = process.env.CODEX_HOME;

  const claude = {
    id: 'claude',
    isolationHints: { configEnv: 'CLAUDE_CONFIG_DIR', strictMcpArgs: ['--strict-mcp-config'], authFiles: [], authMarker: '.claude.json' },
  } as any;
  const codex = {
    id: 'codex',
    isolationHints: { configEnv: 'CODEX_HOME', personalPaths: ['~/.codex'], authFiles: ['auth.json'], authMarker: 'auth.json' },
  } as any;

  beforeEach(() => {
    agonHome = mkdtempSync(join(tmpdir(), 'agon-iso-home-'));
    codexRealHome = mkdtempSync(join(tmpdir(), 'agon-iso-codex-'));
    process.env.AGON_HOME = agonHome;
    delete process.env.AGON_ENGINE_ISOLATION; // default → workspace-pure
    process.env.CODEX_HOME = codexRealHome;    // engine's "real" config home (seed source)
  });
  afterEach(() => {
    if (savedAgonHome === undefined) delete process.env.AGON_HOME; else process.env.AGON_HOME = savedAgonHome;
    if (savedIsolation === undefined) delete process.env.AGON_ENGINE_ISOLATION; else process.env.AGON_ENGINE_ISOLATION = savedIsolation;
    if (savedCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = savedCodexHome;
    rmSync(agonHome, { recursive: true, force: true });
    rmSync(codexRealHome, { recursive: true, force: true });
  });

  // NOTE: every dispatch now also carries AGON_DISPATCH_DEPTH (recursion guard marker),
  // so even "inherit" returns an env containing just that marker (no isolation keys).
  it('claude with NO marker in the clean dir → inherit (only the dispatch-depth marker)', () => {
    const iso = computeEngineIsolation(claude, {});
    expect(iso.plan.isolate).toBe(false);
    expect(iso.env).toMatchObject({ AGON_DISPATCH_DEPTH: expect.any(String) });
    expect(iso.env?.CLAUDE_CONFIG_DIR).toBeUndefined();
    // The clean dir is still created (ready for `agon login claude`).
    expect(existsSync(join(agonHome, 'pure', 'claude'))).toBe(true);
  });

  it('claude WITH the .claude.json marker → isolate (clean CLAUDE_CONFIG_DIR)', () => {
    const cleanDir = join(agonHome, 'pure', 'claude');
    mkdirSync(cleanDir, { recursive: true });
    writeFileSync(join(cleanDir, '.claude.json'), '{}');
    const iso = computeEngineIsolation(claude, {});
    expect(iso.plan.isolate).toBe(true);
    expect(iso.env).toMatchObject({ CLAUDE_CONFIG_DIR: cleanDir, AGON_DISPATCH_DEPTH: expect.any(String) });
    expect(iso.argsExtra).toEqual(['--strict-mcp-config']);
  });

  it('codex seeds auth.json from the real home, then isolates on the marker', () => {
    writeFileSync(join(codexRealHome, 'auth.json'), '{"token":"x"}');
    const iso = computeEngineIsolation(codex, {});
    const cleanDir = join(agonHome, 'pure', 'codex');
    expect(iso.plan.isolate).toBe(true);
    expect(iso.env).toMatchObject({ CODEX_HOME: cleanDir, AGON_DISPATCH_DEPTH: expect.any(String) });
    expect(existsSync(join(cleanDir, 'auth.json'))).toBe(true); // seeded
  });

  it('codex with a STALE clean auth.json but no source → drops the stale copy and inherits', () => {
    const cleanDir = join(agonHome, 'pure', 'codex');
    mkdirSync(cleanDir, { recursive: true });
    writeFileSync(join(cleanDir, 'auth.json'), '{"token":"stale"}'); // leftover from a prior login
    // codexRealHome has NO auth.json (signed out) → stale copy must be removed.
    const iso = computeEngineIsolation(codex, {});
    expect(existsSync(join(cleanDir, 'auth.json'))).toBe(false); // cleaned
    expect(iso.plan.isolate).toBe(false);                        // marker gone → inherit
    expect(iso.env).toMatchObject({ AGON_DISPATCH_DEPTH: expect.any(String) });
    expect(iso.env?.CODEX_HOME).toBeUndefined();
  });

  it('an empty-string authMarker is treated as "no marker" (assume authed), not a falsy bypass', () => {
    const emptyMarker = { id: 'em', isolationHints: { configEnv: 'EM_HOME', authFiles: [], authMarker: '' } } as any;
    const iso = computeEngineIsolation(emptyMarker, {});
    // No real marker to satisfy, but an empty marker must not silently pass as a
    // "found" file — it's normalised to no-marker ⇒ assume authed ⇒ isolate.
    expect(iso.plan.isolate).toBe(true);
    expect(iso.env).toMatchObject({ EM_HOME: join(agonHome, 'pure', 'em'), AGON_DISPATCH_DEPTH: expect.any(String) });
  });

  it('inherit mode (AGON_ENGINE_ISOLATION=inherit) overrides everything → no isolation', () => {
    process.env.AGON_ENGINE_ISOLATION = 'inherit';
    const cleanDir = join(agonHome, 'pure', 'claude');
    mkdirSync(cleanDir, { recursive: true });
    writeFileSync(join(cleanDir, '.claude.json'), '{}'); // even fully authed
    const iso = computeEngineIsolation(claude, {});
    expect(iso.plan.isolate).toBe(false);
    expect(iso.env).toMatchObject({ AGON_DISPATCH_DEPTH: expect.any(String) });
    expect(iso.env?.CLAUDE_CONFIG_DIR).toBeUndefined();
  });

  it('stamps an incrementing AGON_DISPATCH_DEPTH so a dispatched engine cannot recurse into agon', () => {
    const prior = process.env.AGON_DISPATCH_DEPTH;
    try {
      delete process.env.AGON_DISPATCH_DEPTH;
      expect(computeEngineIsolation(claude, {}).env?.AGON_DISPATCH_DEPTH).toBe('1');
      process.env.AGON_DISPATCH_DEPTH = '1';
      expect(computeEngineIsolation(claude, {}).env?.AGON_DISPATCH_DEPTH).toBe('2');
    } finally {
      if (prior === undefined) delete process.env.AGON_DISPATCH_DEPTH;
      else process.env.AGON_DISPATCH_DEPTH = prior;
    }
  });
});

// Reasoning effort + "defer to the CLI's own config by default" (model/effort
// are only forced when the user explicitly picks them in agon; otherwise the
// CLI uses its own setting — which also keeps agon working if the /model probe
// ever breaks because the CLI changed its TUI).
describe('reasoning effort + respect-CLI-own-config', () => {
  it('claude-style effort applies as [--effort, level]', () => {
    const eng = {
      id: 'claude-test', exec: { args: ['--print', '{prompt}'] },
      effort: { flag: '--effort', levels: ['low', 'high'], default: 'high' },
    } as any;
    const { args } = buildCommand(eng, 'exec', 'hi', '/wt', 180, 'claude');
    const i = args.indexOf('--effort');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe('high');
  });

  it('codex-style effort applies as [-c, key=level]', () => {
    const eng = {
      id: 'codex-test', exec: { args: ['exec', '{prompt}'] },
      effort: { configKey: 'model_reasoning_effort', levels: ['low', 'high'], default: 'high' },
    } as any;
    const { args } = buildCommand(eng, 'exec', 'hi', '/wt', 180, 'codex');
    const i = args.indexOf('-c');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe('model_reasoning_effort=high');
  });

  it('no effort is forced when the engine has no default and nothing is picked (uses the CLI own setting)', () => {
    const eng = {
      id: 'codex-noeffort', exec: { args: ['exec', '{prompt}'] },
      effort: { configKey: 'model_reasoning_effort', levels: ['low', 'high'] },
    } as any;
    const { args } = buildCommand(eng, 'exec', 'hi', '/wt', 180, 'codex');
    expect(args).not.toContain('-c');
    expect(args).toEqual(['exec', 'hi']);
  });

  it('no --model is forced when there is no default and nothing is picked (defers to the CLI config)', () => {
    const eng = {
      id: 'codex-nomodeldefault', model: { configKey: 'codex_model', flag: '--model' },
      exec: { args: ['exec', '{prompt}'] },
    } as any;
    const { args } = buildCommand(eng, 'exec', 'hi', '/wt', 180, 'codex');
    expect(args).not.toContain('--model');
    expect(args).toEqual(['exec', 'hi']);
  });

  // The interactive (pty) claude path must honor a /models pick too — not just
  // the --print fallback. resolveClaudePtyExtraArgs builds the launch flags it
  // forwards to the pty exec.
  it('claude pty path forwards [--model, X, --effort, Y] when explicitly set', () => {
    const eng = {
      id: 'claude-ptytest',
      model: { configKey: 'agon_pty_test_model', flag: '--model', default: 'opus' },
      effort: { flag: '--effort', levels: ['low', 'high'], default: 'high' },
    } as any;
    expect(resolveClaudePtyExtraArgs(eng, '/wt')).toEqual(['--model', 'opus', '--effort', 'high']);
  });

  it('claude pty path forwards nothing when nothing is picked (defers to claude own config)', () => {
    const eng = {
      id: 'claude-ptynone',
      model: { configKey: 'agon_pty_test_model_unset', flag: '--model' },
      effort: { flag: '--effort', levels: ['low', 'high'] },
    } as any;
    expect(resolveClaudePtyExtraArgs(eng, '/wt')).toEqual([]);
  });
});

describe('answer-channel (file mode)', () => {
  const saved = process.env.AGON_CLAUDE_ANSWER_CHANNEL;
  afterEach(() => {
    if (saved === undefined) delete process.env.AGON_CLAUDE_ANSWER_CHANNEL;
    else process.env.AGON_CLAUDE_ANSWER_CHANNEL = saved;
  });

  it('answerChannelMode defaults to file (on) and opts out only on off/0/false', () => {
    // ON by default — unset and any non-off/mcp value resolve to 'file'.
    delete process.env.AGON_CLAUDE_ANSWER_CHANNEL;
    expect(answerChannelMode()).toBe('file');
    for (const v of ['file', '1', 'true', 'on', 'FILE', '', 'nonsense']) {
      process.env.AGON_CLAUDE_ANSWER_CHANNEL = v;
      expect(answerChannelMode()).toBe('file');
    }
    process.env.AGON_CLAUDE_ANSWER_CHANNEL = 'mcp';
    expect(answerChannelMode()).toBe('mcp');
    for (const v of ['off', '0', 'false', 'OFF']) {
      process.env.AGON_CLAUDE_ANSWER_CHANNEL = v;
      expect(answerChannelMode()).toBe('off');
    }
  });

  it('fileChannelInstruction embeds the exact answer-file path + Write directive', () => {
    const out = fileChannelInstruction('/tmp/ac/answer.md');
    expect(out).toContain('/tmp/ac/answer.md');
    expect(out).toContain('Write tool');
  });

  it('readAnswerChannelFile: absent/empty → "" ; raw markdown → raw ; {text} JSON → text', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-test-'));
    try {
      const missing = join(dir, 'nope.md');
      expect(readAnswerChannelFile(missing)).toBe('');

      const empty = join(dir, 'empty.md');
      writeFileSync(empty, '   \n  ');
      expect(readAnswerChannelFile(empty)).toBe('');

      const raw = join(dir, 'raw.md');
      writeFileSync(raw, '# Hello\n\nclean answer');
      expect(readAnswerChannelFile(raw)).toBe('# Hello\n\nclean answer');

      const jsonEnv = join(dir, 'env.json');
      writeFileSync(jsonEnv, JSON.stringify({ text: 'delivered via mcp' }));
      expect(readAnswerChannelFile(jsonEnv)).toBe('delivered via mcp');

      // A markdown doc that happens to start with '{' but isn't a {text} envelope → returned raw.
      const braceMd = join(dir, 'brace.md');
      writeFileSync(braceMd, '{not json at all');
      expect(readAnswerChannelFile(braceMd)).toBe('{not json at all');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('setupFileAnswerChannel appends the instruction and points at a fresh writable file', () => {
    const { prompt, answerFile, dir } = setupFileAnswerChannel('Original prompt body.');
    try {
      expect(prompt.startsWith('Original prompt body.')).toBe(true);
      expect(prompt).toContain(answerFile);
      expect(answerFile.startsWith(dir)).toBe(true);
      expect(existsSync(dir)).toBe(true);
      // Round-trip: a write to answerFile is read back authoritatively.
      writeFileSync(answerFile, 'the answer');
      expect(readAnswerChannelFile(answerFile)).toBe('the answer');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
