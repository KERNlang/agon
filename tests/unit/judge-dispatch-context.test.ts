import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiCalls: Array<{ prompt: string; systemPrompt?: string }> = [];

vi.mock('@kernlang/agon-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kernlang/agon-core')>();
  return {
    ...actual,
    apiDispatch: async (_config: unknown, prompt: string, _timeout: number, _signal?: AbortSignal, systemPrompt?: string) => {
      apiCalls.push({ prompt, systemPrompt });
      return { exitCode: 0, stdout: 'RANK: P1 > P2', stderr: '', durationMs: 1, timedOut: false };
    },
  };
});

import { DEFAULT_AGON_CONFIG, EngineRegistry, sessionContext } from '@kernlang/agon-core';
import type { DispatchOptions, EngineDefinition } from '@kernlang/agon-core';
import { CliAdapter } from '../../packages/adapter-cli/src/adapter.js';
import { buildApiAgentContext } from '../../packages/adapter-cli/src/execution-plan.js';
import { judgeTribunal } from '../../packages/forge/src/rating-judge.js';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

const KEY_ENV = 'AGON_TEST_JUDGE_CONTEXT_KEY';
const INSTRUCTION_MARKER = 'INSTRUCTION-MARKER-7f3a';
const DIFF_MARKER = 'DIFF-MARKER-9c1e';

const apiEngine = (id: string): EngineDefinition => ({
  schemaVersion: 3, id, displayName: id, isLocal: false, tier: 'user', timeout: 30,
  exec: { args: [] }, api: { baseUrl: 'https://api.example.test/v1', apiKeyEnv: KEY_ENV, model: `${id}-model` },
} as EngineDefinition);

describe('project context stays out of judge ballots', () => {
  let home: string;
  let repo: string;
  let out: string;
  let registry: EngineRegistry;

  beforeEach(() => {
    home = setupTestAgonHome('judge-dispatch-context');
    repo = mkdtempSync(join(tmpdir(), 'agon-judge-context-repo-'));
    out = mkdtempSync(join(tmpdir(), 'agon-judge-context-out-'));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { cwd: repo, stdio: 'ignore' });
    git('init', '-q');
    writeFileSync(join(repo, 'AGENTS.md'), `# Rules\n${INSTRUCTION_MARKER}\n`);
    writeFileSync(join(repo, 'app.txt'), 'first\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    writeFileSync(join(repo, 'app.txt'), `first\n${DIFF_MARKER}\n`);
    mkdirSync(join(out, 'ballots'), { recursive: true });
    vi.stubEnv(KEY_ENV, 'test-key');
    registry = new EngineRegistry();
    for (const id of ['alpha', 'beta', 'gamma']) registry.register(apiEngine(id));
    sessionContext.invalidate();
    apiCalls.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    sessionContext.invalidate();
    cleanupTestAgonHome(home);
    rmSync(repo, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  const dispatchOptions = (extra: Partial<DispatchOptions> = {}): DispatchOptions => ({
    engine: registry.get('alpha'), prompt: 'p', cwd: repo, mode: 'exec', timeout: 10, outputDir: out, ...extra,
  });

  it('the API backend of dispatch() adds project instructions and the diff by default, and includeProjectContext:false leaves them out', async () => {
    const adapter = new CliAdapter(registry);
    await adapter.dispatch(dispatchOptions());
    await adapter.dispatch(dispatchOptions({ systemPrompt: 'judge', includeProjectContext: false }));
    expect(apiCalls[0].systemPrompt).toContain(INSTRUCTION_MARKER);
    expect(apiCalls[0].systemPrompt).toContain(DIFF_MARKER);
    expect(apiCalls[1].systemPrompt).toBe('judge');
  });

  it('the API agent context honours includeProjectContext:false the same way', () => {
    expect(buildApiAgentContext(dispatchOptions()).systemPrompt).toContain(DIFF_MARKER);
    const bare = buildApiAgentContext(dispatchOptions({ systemPrompt: 'judge', includeProjectContext: false })).systemPrompt;
    expect(bare).toBe('judge');
  });

  it('every judge ballot reaches the API with no project instructions and no diff context', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scores = await judgeTribunal({
      judging: 'shadow', question: 'Ship it?', failed: [], rng: () => 0.5, outputDir: out, cwd: repo, adapter: new CliAdapter(registry), registry,
      positions: ['alpha', 'beta', 'gamma'].map((engineId) => ({ engineId, position: 'Participant', arguments: [`argument of ${engineId}`] })),
      config: { ...DEFAULT_AGON_CONFIG },
    });
    expect(scores).toHaveLength(3);
    expect(apiCalls).toHaveLength(3);
    for (const call of apiCalls) {
      const sent = `${call.systemPrompt ?? ''}\n${call.prompt}`;
      expect(call.systemPrompt).toMatch(/impartial judge/);
      expect(sent).not.toContain('PROJECT CONTEXT');
      expect(sent).not.toContain(INSTRUCTION_MARKER);
      expect(sent).not.toContain(DIFF_MARKER);
    }
  });
});
