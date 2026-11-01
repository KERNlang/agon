import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult, InvocationContext, Json, ModServices } from '@kernlang/agon-mod-api';
import { runReview } from '../../packages/mod-review/src/implementation.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function repo(path = 'src/a.ts', change = true): string {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-review-parity-'));
  roots.push(cwd);
  const git = (...args: string[]) => execFileSync('git', args, { cwd });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  mkdirSync(join(cwd, dirname(path)), { recursive: true });
  writeFileSync(join(cwd, path), 'export const a = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  if (change) writeFileSync(join(cwd, path), 'export const a = maybe!.value;\n');
  return cwd;
}

const block = (findings: unknown[]) => `Review prose.\n<!--AGON_REVIEW_FINDINGS_v1-->\n\`\`\`json\n${JSON.stringify(findings)}\n\`\`\``;
const finding = (lines: string) => ({
  file: 'src/a.ts', lines, severity: 'important', blocking: false, confidence: 0.75,
  problem: 'unsafe non-null assertion on maybe', minimalFix: 'guard it',
});
type Reply = Record<string, Json>;
const reply = (stdout: string, extra: Reply = {}): Reply => ({
  exitCode: 0, stdout, cleanedText: stdout, stderr: '', timedOut: false, finishReason: 'stop', ...extra,
});

interface HostOptions {
  active?: string[];
  identities?: Record<string, string>;
  describe?: boolean;
  projectContext?: boolean;
  dispatch?: (engineId: string, prompt: string) => Reply | Promise<Reply>;
}

function host(options: HostOptions = {}) {
  const active = options.active ?? ['alpha', 'beta'];
  const dispatch = vi.fn(async (engineId: string, prompt: string) => ({
    engineId, ...(await (options.dispatch ?? (() => reply(block([]))))(engineId, prompt)),
  }));
  const writeArtifact = vi.fn(async () => undefined);
  const finish = vi.fn(async () => undefined);
  const services = {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    receipts: { record: vi.fn(async () => 'receipt') },
    runs: {
      start: vi.fn(async () => ({ id: 'run', path: '/runs/review', mode: 'review', startedAt: '2026-01-01T00:00:00Z' })),
      finish, writeArtifact,
    },
    engines: {
      listActive: vi.fn(async () => active),
      dispatch,
      ...(options.describe === false ? {} : {
        describe: vi.fn(async (ids: readonly string[]) => ids.map(id => ({
          id, binary: options.identities?.[id] ?? `${id}-cli`, backend: 'cli' as const,
        }))),
      }),
    },
    ...(options.projectContext === false ? {} : {
      context: { projectContext: vi.fn(async () => '## PROJECT CONTEXT\nParity project rules') },
    }),
  } as unknown as ModServices;
  return { services, dispatch, writeArtifact, finish };
}

function context(cwd: string): InvocationContext {
  return { invocationId: 'i', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} };
}

async function review(cwd: string, input: Record<string, Json>, h: ReturnType<typeof host>) {
  const out = await runReview(input, context(cwd), h.services) as CommandResult;
  return { out, result: out.result as any };
}

describe('mod-review parity with the legacy review pipeline', () => {
  it('seats every distinct adapter identity, including the primary, at high risk and writes the routing manifest', async () => {
    const active = ['e1', 'e2', 'e3', 'e4', 'e5', 'primary'];
    const h = host({ active });
    const { out, result } = await review(repo(), { risk: 'high', 'primary-engine': 'primary' }, h);
    expect(out.exitCode).toBe(0);
    expect([...result.engines].sort()).toEqual([...active].sort());
    expect(result.routing).toMatchObject({ risk: { final: 'high' }, primary: 'primary', shortfall: null });
    expect(h.dispatch).toHaveBeenCalledTimes(6);
    const manifestCall = h.writeArtifact.mock.calls.find(call => (call as unknown[])[1] === 'review-routing.json') as unknown[] | undefined;
    const manifest = JSON.parse(String(manifestCall?.[2]));
    expect(new Set(manifest.selected.map((c: any) => c.identityKey)).size).toBe(6);
    expect(result.routing.manifest).toBe(join('/runs/review', 'review-routing.json'));
  });

  it('seats only one of two engine ids that share an adapter identity', async () => {
    const h = host({ active: ['a', 'b', 'c'], identities: { a: 'shared-cli', b: 'shared-cli' } });
    const { result } = await review(repo(), { risk: 'medium', 'primary-engine': 'builder' }, h);
    expect(result.engines).toHaveLength(2);
    expect(result.engines).toContain('c');
    expect(result.engines.filter((id: string) => id === 'a' || id === 'b')).toHaveLength(1);
    expect(result.routing.excluded).toEqual([expect.objectContaining({ reason: 'duplicate-adapter-identity' })]);
  });

  it('never lowers a diff-inferred high risk when --risk low is requested', async () => {
    const h = host({ active: ['a', 'b', 'c'] });
    const { result } = await review(repo('auth/session.ts'), { risk: 'low', 'primary-engine': 'builder' }, h);
    expect(result.routing.risk).toMatchObject({ requested: 'low', final: 'high' });
    expect(result.routing.risk.triggers).toContain('sensitive-path:auth/session.ts');
    expect(result.engines).toHaveLength(3);
  });

  it('fails loudly on a routing shortfall when identities are verifiable', async () => {
    const h = host({ active: ['builder'] });
    const { out, result } = await review(repo(), { risk: 'medium', 'primary-engine': 'builder' }, h);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain('routing shortfall: 0/2');
    expect(result.routing.shortfall).toMatchObject({ required: 2, available: 0 });
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: false }), expect.anything());
  });

  it('returns without dispatch for an empty diff', async () => {
    const h = host();
    const { out } = await review(repo('src/a.ts', false), {}, h);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('No diff found');
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('still runs when the host offers neither describe nor project context', async () => {
    const h = host({ describe: false, projectContext: false });
    const { out, result } = await review(repo(), { risk: 'low', 'primary-engine': 'builder' }, h);
    expect(out.exitCode).toBe(0);
    expect(result.engines).toEqual(expect.arrayContaining(['alpha', 'beta']));
    expect(result.routing).toMatchObject({ identitiesVerifiable: false, risk: { final: 'high' } });
    expect(result.warnings.join('\n')).toContain('adapter identities are unverifiable');
    const prompt = String(h.dispatch.mock.calls[0][1]);
    expect(prompt).not.toContain('## PROJECT CONTEXT');
    expect(prompt).toContain('## CURRENT FILE CONTENTS');
  });

  it('grounds the seat prompt in project context and current file contents', async () => {
    const h = host();
    await review(repo(), { engines: 'alpha' }, h);
    const prompt = String(h.dispatch.mock.calls[0][1]);
    expect(prompt).toContain('## PROJECT CONTEXT\nParity project rules');
    expect(prompt).toContain('### src/a.ts\n```\nexport const a = maybe!.value;');
    expect(prompt).toContain('## REQUIRED MACHINE BLOCK');
  });

  it('clusters the same issue reported by two seats at lines 10 and 14 into one consensus finding', async () => {
    const h = host({ dispatch: engineId => reply(block([finding(engineId === 'alpha' ? '10' : '14')])) });
    const { out, result } = await review(repo(), { engines: 'alpha,beta' }, h);
    expect(result.consensus.findings).toHaveLength(1);
    expect(result.consensus.findings[0]).toMatchObject({ engines: ['alpha', 'beta'], pairVotes: 2, tier: 'verified' });
    expect(out.exitCode).toBe(2);
  });

  it('repairs a truncated seat exactly once and accepts the repaired findings', async () => {
    let calls = 0;
    const h = host({
      dispatch: (_engineId, prompt) => {
        calls += 1;
        if (prompt.startsWith('You previously produced this code review:')) return reply(JSON.stringify([finding('3')]));
        return reply('Partial review that stops mid-sentence and <!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[{"file":', { finishReason: 'length', engineFault: 'length' });
      },
    });
    const { result } = await review(repo(), { engine: 'alpha' }, h);
    expect(calls).toBe(2);
    expect(result.reviews[0]).toMatchObject({ status: 'ok', ok: true, repaired: true });
    expect(result.reviews[0].findings).toHaveLength(1);
  });

  it('re-asks the original prompt with a doubled budget when reasoning exhausts it with no text', async () => {
    const h = host({
      dispatch: (_engineId, prompt) => prompt.startsWith('You previously produced')
        ? reply('[]')
        : h.dispatch.mock.calls.length === 1
          ? reply('', { cleanedText: '', finishReason: 'length', engineFault: 'length', appliedMaxTokens: 16384, costUsd: 0.1 })
          : reply(block([finding('3')]), { appliedMaxTokens: 32768, costUsd: 0.2 }),
    });
    const { result } = await review(repo(), { engine: 'alpha' }, h);
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    expect(h.dispatch.mock.calls[1][1]).toBe(h.dispatch.mock.calls[0][1]);
    expect(h.dispatch.mock.calls[1][3]).toMatchObject({ maxTokens: 32768, mode: 'review' });
    expect(result.reviews[0]).toMatchObject({ status: 'ok', ok: true });
    expect(result.reviews[0].costUsd).toBeCloseTo(0.3);
  });

  it('labels a reasoning-exhausted seat length without a retry when the host reports no budget', async () => {
    const h = host({ dispatch: () => reply('', { cleanedText: '', finishReason: 'length', engineFault: 'length' }) });
    const { result } = await review(repo(), { engine: 'alpha' }, h);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(result.reviews[0]).toMatchObject({ status: 'length', ok: false });
  });

  it('labels the seat length when the doubled-budget retry is exhausted too', async () => {
    const h = host({ dispatch: () => reply('', { cleanedText: '', finishReason: 'length', engineFault: 'length', appliedMaxTokens: 8192 }) });
    const { result } = await review(repo(), { engine: 'alpha' }, h);
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    expect(result.reviews[0]).toMatchObject({ status: 'length', ok: false });
  });

  it('skips the budget retry when the aggregate deadline leaves less than one seat timeout', async () => {
    const h = host({
      dispatch: async () => {
        await new Promise(resolve => setTimeout(resolve, 25));
        return reply('', { cleanedText: '', finishReason: 'length', engineFault: 'length', appliedMaxTokens: 8192 });
      },
    });
    const { result } = await review(repo(), { engine: 'alpha', timeout: '5', deadline: '5' }, h);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(result.reviews[0]).toMatchObject({ status: 'length' });
  });

  it('leaves the seat timeout to the host review default and gates repair on the applied value', async () => {
    const h = host({
      dispatch: (_engineId, prompt) => prompt.startsWith('You previously produced')
        ? reply('[]', { appliedTimeoutSeconds: 600 })
        : reply('A prose review without any machine-readable block at all.', { appliedTimeoutSeconds: 600 }),
    });
    const { result } = await review(repo(), { engine: 'alpha' }, h);
    expect(h.dispatch.mock.calls[0][3]).not.toHaveProperty('timeoutSeconds');
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    expect(h.dispatch.mock.calls[1][3]).toMatchObject({ timeoutSeconds: 600 });
    expect(result.reviews[0]).toMatchObject({ status: 'ok', timeoutSeconds: 600, repaired: true });
    expect(h.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ timeoutSec: 600 }), expect.anything());
  });

  it('lets an explicit --timeout win over the host review default', async () => {
    const h = host({ dispatch: () => reply(block([]), { appliedTimeoutSeconds: 30 }) });
    const { result } = await review(repo(), { engine: 'alpha', timeout: '30' }, h);
    expect(h.dispatch.mock.calls[0][3]).toMatchObject({ timeoutSeconds: 30 });
    expect(result.reviews[0]).toMatchObject({ timeoutSeconds: 30 });
  });

  it('skips the repair when an explicit deadline is shorter than the host-applied seat timeout allows', async () => {
    const h = host({
      dispatch: async () => {
        await new Promise(resolve => setTimeout(resolve, 25));
        return reply('A prose review without any machine-readable block at all.', { appliedTimeoutSeconds: 5 });
      },
    });
    const { result } = await review(repo(), { engine: 'alpha', deadline: '5' }, h);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(result.reviews[0].error).toContain('aggregate review deadline');
  });

  it('rejects a non-positive deadline before dispatch', async () => {
    const h = host();
    const { out } = await review(repo(), { engine: 'alpha', deadline: '0' }, h);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain('deadline');
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('never repairs a timeout and discards a timed-out seat whose findings block is incomplete', async () => {
    const truncated = 'Review prose.\n<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[{"file":"src/a.ts","lines":"1"';
    const h = host({ dispatch: () => reply(truncated, { exitCode: 124, timedOut: true, engineFault: 'timeout' }) });
    const { out, result } = await review(repo(), { engine: 'alpha' }, h);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(out.exitCode).toBe(1);
    expect(result.reviews[0]).toMatchObject({ status: 'timeout', ok: false, findings: [] });
    expect(result.reviews[0]).not.toHaveProperty('partial');
    expect(h.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      engines: [expect.objectContaining({ id: 'alpha', status: 'timeout' })],
    }), expect.anything());
  });

  it('keeps findings a timed-out seat already emitted, labelled timeout and partial, without a repair', async () => {
    const h = host({ dispatch: () => reply(block([finding('1')]), {
      exitCode: 124, timedOut: true, engineFault: 'timeout', timeoutKind: 'ceiling', extendedSeconds: 1380,
      appliedTimeoutSeconds: 420, appliedCeilingSeconds: 1800,
    }) });
    const { out, result } = await review(repo(), { engine: 'alpha' }, h);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(out.exitCode).toBe(0);
    expect(result.reviews[0]).toMatchObject({
      status: 'timeout', ok: true, partial: true, timeoutKind: 'ceiling', extendedSeconds: 1380, ceilingSeconds: 1800,
    });
    expect(result.reviews[0].error).toContain('timed out');
    expect(result.findings).toHaveLength(1);
    expect(h.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      engines: [expect.objectContaining({ id: 'alpha', status: 'timeout' })],
    }), expect.anything());
  });

  it('sizes the aggregate repair deadline from the largest reported seat ceiling', async () => {
    const startedAt = Date.now();
    let elapsedMs = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => startedAt + elapsedMs);
    try {
      const h = host({
        dispatch: (_engineId, prompt) => {
          if (prompt.startsWith('You previously produced')) return reply('[]', { appliedTimeoutSeconds: 10, appliedCeilingSeconds: 100 });
          elapsedMs = 60_000;
          return reply('A prose review without any machine-readable block at all.', {
            appliedTimeoutSeconds: 10, appliedCeilingSeconds: 100, extendedSeconds: 50,
          });
        },
      });
      const { result } = await review(repo(), { engine: 'alpha' }, h);
      expect(h.dispatch).toHaveBeenCalledTimes(2);
      expect(result.reviews[0]).toMatchObject({ status: 'ok', repaired: true, ceilingSeconds: 100, extendedSeconds: 50 });
    } finally {
      clock.mockRestore();
    }
  });

  it('still gates the repair on the base timeout when no seat reports a ceiling', async () => {
    const startedAt = Date.now();
    let elapsedMs = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => startedAt + elapsedMs);
    try {
      const h = host({
        dispatch: () => {
          elapsedMs = 60_000;
          return reply('A prose review without any machine-readable block at all.', { appliedTimeoutSeconds: 10 });
        },
      });
      const { result } = await review(repo(), { engine: 'alpha' }, h);
      expect(h.dispatch).toHaveBeenCalledTimes(1);
      expect(result.reviews[0].error).toContain('aggregate review deadline');
    } finally {
      clock.mockRestore();
    }
  });

  it('caps the host wall-clock ceiling at an explicit --deadline', async () => {
    const h = host();
    await review(repo(), { engine: 'alpha', deadline: '900' }, h);
    expect(h.dispatch.mock.calls[0][3]).toMatchObject({ maxWallSeconds: 900 });
    const plain = host();
    await review(repo(), { engine: 'alpha' }, plain);
    expect(plain.dispatch.mock.calls[0][3]).not.toHaveProperty('maxWallSeconds');
  });

  it('caps the repair dispatch at an explicit --deadline too', async () => {
    const h = host({ dispatch: () => reply('A prose review without any machine-readable block at all.') });
    await review(repo(), { engine: 'alpha', timeout: '60', deadline: '900' }, h);
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    expect(h.dispatch.mock.calls[1][3]).toMatchObject({ maxWallSeconds: 900 });
  });

  it('keeps a truncated seat labelled length and partial when its block parses but the repair fails', async () => {
    const h = host({
      dispatch: (_engineId, prompt) => prompt.startsWith('You previously produced this code review:')
        ? reply('not json')
        : reply(block([finding('3')]), { finishReason: 'length', engineFault: 'length' }),
    });
    const { result } = await review(repo(), { engine: 'alpha' }, h);
    expect(result.reviews[0]).toMatchObject({ status: 'length', ok: true, partial: true });
    expect(result.reviews[0].findings).toHaveLength(1);
    expect(result.reviews[0].error).toContain('token limit');
  });

  it.each([
    ['rate_limit', { exitCode: 2, engineFault: 'rate_limit' }],
    ['auth', { exitCode: 1, engineFault: 'auth' }],
    ['empty', { stdout: '', cleanedText: '' }],
    ['error', { exitCode: 1 }],
  ] as const)('labels a %s seat distinctly and never ok', async (status, extra) => {
    const h = host({ dispatch: () => reply('', extra as Reply) });
    const { result } = await review(repo(), { engine: 'alpha' }, h);
    expect(result.reviews[0]).toMatchObject({ status, ok: false });
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it('labels the seat failed when the repair also fails', async () => {
    const h = host({ dispatch: () => reply('A prose review without any machine-readable block at all.') });
    const { out, result } = await review(repo(), { engine: 'alpha' }, h);
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    expect(out.exitCode).toBe(1);
    expect(result.reviews[0]).toMatchObject({ status: 'failed', ok: false });
    expect(result.reviews[0].error).toContain('repair');
  });

  it('skips the repair when the aggregate deadline leaves less than one seat timeout', async () => {
    const h = host({
      dispatch: async () => {
        await new Promise(resolve => setTimeout(resolve, 25));
        return reply('A prose review without any machine-readable block at all.');
      },
    });
    const { result } = await review(repo(), { engine: 'alpha', timeout: '5', deadline: '5' }, h);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(result.reviews[0]).toMatchObject({ status: 'failed' });
    expect(result.reviews[0].error).toContain('aggregate review deadline');
  });
});
