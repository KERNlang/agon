import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, InvocationContext, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from './implementation.js';

function repo(alreadySolved = false): string {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-forge-mod-'));
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
  const candidatePaths: string[] = [];
  const dispatch = vi.fn(async (engineId: string, prompt: string, context: InvocationContext) => {
    if (prompt.includes('AGON_FORGE_HEALTHY')) return { engineId, exitCode: 0, stdout: 'AGON_FORGE_HEALTHY', stderr: '', timedOut: false };
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
  const mod = await createMod(services);
  await mod.activate(registrar, services);
  const context = { invocationId: 'forge-test', cwd, platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };
  return { command: command!, context, dispatch, record, finish, writeArtifact, debug, candidatePaths };
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
    expect(h.debug).toHaveBeenCalledWith('forge arena cleanup', expect.objectContaining({ cleanupComplete: true }));
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

  it('skips an unhealthy engine visibly instead of silently shrinking the panel', async () => {
    const h = await harness(repo());
    h.dispatch.mockImplementation(async (engineId: string, prompt: string, context: InvocationContext) => {
      if (prompt.includes('AGON_FORGE_HEALTHY')) return engineId === 'beta'
        ? { engineId, exitCode: 1, stdout: '', stderr: 'auth failed', timedOut: false }
        : { engineId, exitCode: 0, stdout: 'AGON_FORGE_HEALTHY', stderr: '', timedOut: false };
      writeFileSync(join(context.cwd, 'solved.txt'), 'alpha\n');
      return { engineId, exitCode: 0, stdout: 'done', stderr: '', timedOut: false };
    });
    const out = await h.command.run({ task: 'create solved.txt', test: 'test -f solved.txt', engines: 'alpha,beta' }, h.context) as any;
    expect(out.exitCode).toBe(0);
    expect(out.result.skippedEngines).toEqual([{ engineId: 'beta', reason: 'auth failed' }]);
    expect(h.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: false }), expect.anything());
  });

  it('accepts substantive validation output when explicitly allowed and preserves quiet/provenance output', async () => {
    const h = await harness(repo());
    h.dispatch.mockImplementation(async (engineId: string, prompt: string) => prompt.includes('AGON_FORGE_HEALTHY')
      ? { engineId, exitCode: 0, stdout: 'AGON_FORGE_HEALTHY', stderr: '', timedOut: false }
      : { engineId, exitCode: 0, stdout: 'A grounded validation report with useful findings.', stderr: '', timedOut: false });
    const out = await h.command.run({ task: 'validate behavior', mode: 'validate', requireDiff: true, acceptReviewOutput: true, engines: 'alpha', quiet: true, provenance: true }, h.context) as any;
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('/tmp/forge-run');
    expect(out.result).toMatchObject({ winner: 'alpha', acceptReviewOutput: true, provenance: { kind: 'forge' } });
    expect(h.writeArtifact).toHaveBeenCalledWith(expect.anything(), 'provenance.json', expect.any(String), expect.anything());
  });

  it('aborts unfinished competitors after the requested passing quorum', async () => {
    const h = await harness(repo());
    h.dispatch.mockImplementation(async (engineId: string, prompt: string, context: InvocationContext) => {
      if (prompt.includes('AGON_FORGE_HEALTHY')) return { engineId, exitCode: 0, stdout: 'AGON_FORGE_HEALTHY', stderr: '', timedOut: false };
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
