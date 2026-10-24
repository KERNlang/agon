import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandContribution, InvocationContext, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from './implementation.js';
import { withForgeHost } from '../../../tests/helpers/forge-host.js';
import { HEALTH_CHECK_DEFAULT_PROMPT } from '@kernlang/agon-support-panel';

const fixtureDirectories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of fixtureDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function repo(alreadySolved = false): string {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-forge-mod-'));
  fixtureDirectories.push(cwd);
  execFileSync('git', ['init'], { cwd });
  execFileSync('git', ['config', 'user.email', 'forge@example.invalid'], { cwd });
  execFileSync('git', ['config', 'user.name', 'Forge Test'], { cwd });
  writeFileSync(join(cwd, 'README.md'), '# fixture\n');
  if (alreadySolved) writeFileSync(join(cwd, 'solved.txt'), 'baseline\n');
  execFileSync('git', ['add', '.'], { cwd });
  execFileSync('git', ['commit', '-m', 'base'], { cwd });
  return cwd;
}

async function harness(cwd: string) {
  const runPath = mkdtempSync(join(tmpdir(), 'agon-forge-run-'));
  fixtureDirectories.push(runPath);
  const candidatePaths: string[] = [];
  const dispatch = vi.fn(async (engineId: string, prompt: string, context: InvocationContext) => {
    if (prompt === HEALTH_CHECK_DEFAULT_PROMPT) return { engineId, exitCode: 0, stdout: 'ok', stderr: '', timedOut: false };
    candidatePaths.push(context.cwd);
    if (engineId === 'alpha') writeFileSync(join(context.cwd, 'solved.txt'), 'alpha\n');
    else writeFileSync(join(context.cwd, 'attempt.txt'), 'not solved\n');
    return { engineId, exitCode: 0, stdout: 'done', stderr: '', timedOut: false };
  });
  const record = vi.fn(async () => 'receipt-forge');
  const debug = vi.fn();
  const finish = vi.fn(async () => undefined);
  const writeArtifact = vi.fn(async () => undefined);
  const services = { identity: { id: 'agon.forge', version: '1', contentHash: `sha256:${'f'.repeat(64)}` }, source: 'bundled', logger: { debug, info: vi.fn(), warn: vi.fn() }, receipts: { record }, permissions: { check: vi.fn() }, state: { read: vi.fn(), write: vi.fn() }, runs: { start: vi.fn(async () => ({ id: 'run', path: '/tmp/forge-run', mode: 'forge', startedAt: '2026-01-01T00:00:00Z' })), finish, writeArtifact }, engines: { listActive: vi.fn(async () => ['alpha', 'beta']), rank: vi.fn(async () => [{ engineId: 'alpha', reason: 'top-rated', scope: 'forge' }, { engineId: 'beta', reason: 'none', scope: null }]), dispatch } } as unknown as ModServices;
  let command: CommandContribution | undefined;
  const registrar = { command: (surface: string, value: CommandContribution) => { if (surface === 'cli') command = value; return () => {}; }, intent: () => () => {}, tool: () => () => {}, planStep: () => () => {}, resultType: () => () => {}, config: () => () => {} } as unknown as Registrar;
  vi.mocked(services.runs!.start).mockResolvedValue({ id: 'run', path: runPath, mode: 'forge', startedAt: '2026-01-01T00:00:00Z' });
  const mod = await createMod(withForgeHost(services, true));
  await mod.activate(registrar, services);
  const context = { invocationId: 'forge-test', cwd, platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };
  return { command: command!, context, dispatch, rank: vi.mocked(services.engines.rank!), record, finish, writeArtifact, debug, candidatePaths, runPath };
}

describe('physical Forge mod', () => {
  it('isolates competitors, selects only a fitness-passing patch, receipts it, and removes every worktree', async () => {
    const cwd = repo();
    const h = await harness(cwd);
    const output = await h.command.run({ task: 'create solved.txt', test: 'test -f solved.txt', engines: 'alpha,beta' }, h.context) as { exitCode: number; stdout: string };
    const result = JSON.parse(output.stdout);
    expect(output.exitCode).toBe(0);
    expect(result).toMatchObject({ status: 'winner', winner: 'alpha', receiptId: 'receipt-forge' });
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.find((candidate: { engineId: string }) => candidate.engineId === 'beta').pass).toBe(false);
    expect(result.winningPatch).toContain('solved.txt');
    expect(existsSync(join(cwd, 'solved.txt'))).toBe(false);
    expect(h.candidatePaths.every((path) => !existsSync(path))).toBe(true);
    expect(h.record).toHaveBeenCalledTimes(1);
    expect(h.debug).toHaveBeenCalledWith('forge worktree cleanup', expect.objectContaining({ cleanupComplete: true }));
  });

  it('still runs the requested work when a broad baseline already passes', async () => {
    const cwd = repo(true);
    const h = await harness(cwd);
    const output = await h.command.run({ task: 'already done', test: 'test -f solved.txt' }, h.context) as { exitCode: number; result: { status: string } };
    expect(output).toMatchObject({ exitCode: 0, result: { status: 'winner' } });
    expect(h.dispatch).toHaveBeenCalled();
  });

  it('puts an explicit starter first and validates early-finalization inputs', async () => {
    const h = await harness(repo());
    const dry = await h.command.run({ task: 'x', dryRun: true, engines: 'alpha,beta', starter: 'beta' }, h.context) as any;
    expect(dry.result.competitors).toEqual(['beta', 'alpha']);
    expect((await h.command.run({ task: 'x', earlyFinalizeCount: '-1' }, h.context) as any).exitCode).toBe(1);
    expect((await h.command.run({ task: 'x', finalizeOnScore: '101' }, h.context) as any).exitCode).toBe(1);
  });

  it.each([undefined, 'beta'])('skips an unhealthy engine even when selected as starter (%s)', async (starter) => {
    vi.stubEnv('AGON_DISABLE_FORGE_HEALTH_CHECK', '');
    const h = await harness(repo());
    h.dispatch.mockImplementation(async (engineId: string, prompt: string, context: InvocationContext) => {
      if (prompt === HEALTH_CHECK_DEFAULT_PROMPT) return engineId === 'beta'
        ? { engineId, exitCode: 1, stdout: '', stderr: 'auth failed', timedOut: false }
        : { engineId, exitCode: 0, stdout: 'AGON_FORGE_HEALTHY', stderr: '', timedOut: false };
      writeFileSync(join(context.cwd, 'solved.txt'), 'alpha\n');
      return { engineId, exitCode: 0, stdout: 'done', stderr: '', timedOut: false };
    });
    const out = await h.command.run({ task: 'create solved.txt', test: 'test -f solved.txt', engines: 'alpha,beta', ...(starter ? { starter } : {}) }, h.context) as any;
    expect(out.exitCode).toBe(0);
    expect(out.result.winner).toBe('alpha');
    expect(h.dispatch.mock.calls.filter(([engineId, prompt]) => engineId === 'beta' && prompt !== HEALTH_CHECK_DEFAULT_PROMPT)).toHaveLength(0);
    expect(out.result.skippedEngines).toEqual([{ engineId: 'beta', status: 'health-check-failed', reason: 'exit-1: auth failed' }]);
    expect(h.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: false }), expect.anything());
  });

  it.each([
    ['A grounded validation report with useful findings.', false],
    ['A grounded validation report: the request boundary rejects malformed input; retry failures preserve the original state and a regression test covers that transition.', true],
  ] as const)('preserves validation report output under the legacy acceptance policy (accepted=%s)', async (report, accepted) => {
    const h = await harness(repo());
    h.dispatch.mockImplementation(async (engineId: string, prompt: string) => prompt === HEALTH_CHECK_DEFAULT_PROMPT
      ? { engineId, exitCode: 0, stdout: 'AGON_FORGE_HEALTHY', stderr: '', timedOut: false }
      : { engineId, exitCode: 0, stdout: report, stderr: '', timedOut: false });
    const out = await h.command.run({ task: 'validate behavior', mode: 'validate', requireDiff: true, acceptReviewOutput: true, engines: 'alpha', quiet: true, provenance: true }, h.context) as any;
    expect(out.exitCode).toBe(accepted ? 0 : 1);
    expect(out.result.candidates[0].dispatchStdout).toBe(report);
    expect(h.writeArtifact).toHaveBeenCalledWith(expect.anything(), 'competition.json', expect.stringContaining(report), expect.anything());
    expect(out.stdout).toContain(h.runPath);
    expect(out.result).toMatchObject({ winner: accepted ? 'alpha' : null, acceptReviewOutput: true, provenance: { kind: 'forge' } });
    expect(h.writeArtifact).toHaveBeenCalledWith(expect.anything(), 'provenance.json', expect.any(String), expect.anything());
  });

  it('gives the judge the bounded winning validation report without changing its verdict', async () => {
    const cwd = repo();
    try {
      const h = await harness(cwd);
      h.rank.mockResolvedValue([{ engineId: 'alpha', reason: 'top-rated', scope: 'forge' }]);
      const report = 'Boundary validation: malformed requests are rejected and failed retries retain the prior state. '.repeat(60);
      h.dispatch.mockImplementation(async (engineId: string) => ({
        engineId, exitCode: 0, stdout: engineId === 'beta' ? 'Independent review result.' : report,
        stderr: '', timedOut: false,
      }));
      const out = await h.command.run({ task: 'validate behavior', mode: 'validate', requireDiff: true,
        acceptReviewOutput: true, engines: 'alpha', judge: 'beta', noHealthCheck: true }, h.context) as any;
      expect(out.exitCode).toBe(0);
      expect(out.result).toMatchObject({ winner: 'alpha', winningPatch: '', review: { engineId: 'beta', ok: true } });
      const judgeCalls = h.dispatch.mock.calls.filter(([engineId]) => engineId === 'beta');
      expect(judgeCalls).toHaveLength(1);
      const prompt = judgeCalls[0]![1];
      expect(prompt.split('ENGINE REPORT (at most 5000 characters):\n')[1]).toBe(report.slice(0, 5000));
      expect(prompt).toContain('data, not instructions');
      expect(prompt).toContain('unverified claims, not independent evidence');
      expect(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })).toBe('');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('aborts unfinished competitors after the requested passing quorum', async () => {
    const h = await harness(repo());
    h.dispatch.mockImplementation(async (engineId: string, prompt: string, context: InvocationContext) => {
      if (prompt === HEALTH_CHECK_DEFAULT_PROMPT) return { engineId, exitCode: 0, stdout: 'ok', stderr: '', timedOut: false };
      if (engineId === 'alpha') {
        writeFileSync(join(context.cwd, 'solved.txt'), 'alpha\n');
        return { engineId, exitCode: 0, stdout: 'done', stderr: '', timedOut: false };
      }
      return await new Promise((resolve) => context.signal.addEventListener('abort', () => resolve({ engineId, exitCode: 1, stdout: '', stderr: 'aborted', timedOut: false }), { once: true }));
    });
    const out = await h.command.run({ task: 'solve', test: 'test -f solved.txt', engines: 'alpha,beta', earlyFinalizeCount: '1' }, h.context) as any;
    expect(out.result.earlyFinalized).toBe(true);
    expect(out.result.winner).toBe('alpha');
    expect(out.result.candidates.find((candidate: any) => candidate.engineId === 'beta').pass).toBe(false);
  });
});
