import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ModServices } from '@kernlang/agon-mod-api';
import { runGoal, runGoalSupervisor } from './implementation.js';

function repo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-goal-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd });
  execFileSync('git', ['config', 'user.email', 'g@example.invalid'], { cwd });
  execFileSync('git', ['config', 'user.name', 'G'], { cwd });
  writeFileSync(join(cwd, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd });
  execFileSync('git', ['commit', '-m', 'base'], { cwd });
  return cwd;
}

function harness() {
  const state = new Map<string, any>();
  const dispatch = vi.fn(async (_id: string, prompt: string, context: any, options: any) => {
    if (options.mode === 'agent') {
      if (prompt.includes('TASK first')) writeFileSync(join(context.cwd, 'first.ts'), 'export const first = true;\n');
      else writeFileSync(join(context.cwd, 'second.ts'), 'export const second = true;\n');
      return { exitCode: 0, stdout: 'done', stderr: '', timedOut: false };
    }
    return { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```', stderr: '', timedOut: false };
  });
  const finish = vi.fn(async () => undefined);
  const writeArtifact = vi.fn(async () => undefined);
  const services = {
    identity: { id: 'agon.goal', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` },
    source: 'bundled',
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    receipts: { record: vi.fn(async () => 'goal-r') },
    permissions: { check: vi.fn(async () => 'allow') },
    state: {
      read: vi.fn(async (key: string) => state.get(key)),
      write: vi.fn(async (key: string, value: any) => { state.set(key, value); }),
    },
    runs: {
      start: vi.fn(async (mode: string) => ({ id: `${mode}-run`, path: `/tmp/${mode}-run`, mode, startedAt: '2026-01-01T00:00:00Z' })),
      finish, writeArtifact,
    },
    engines: { listActive: vi.fn(async () => ['builder', 'reviewer']), dispatch },
  } as unknown as ModServices;
  return { state, dispatch, finish, writeArtifact, services };
}

const context = (cwd: string) => ({
  invocationId: 'g', cwd, platform: 'darwin-arm64' as const,
  signal: new AbortController().signal, config: {},
});

describe('physical goal mod', () => {
  it('runs dependency-ordered work, gates/mutates/reviews it, commits on goal branch, and leaves source untouched', async () => {
    const cwd = repo(); const h = harness();
    const out = await runGoal({
      intent: 'build two', gate: 'test -f base.txt',
      tasks: [{ id: 'first', source: 'make first' }, { id: 'second', source: 'make second', dependsOn: ['first'] }],
      engine: 'builder', reviewEngines: 'reviewer', requireTests: false,
    }, context(cwd), h.services);
    expect(out, JSON.stringify(out)).toMatchObject({ exitCode: 0 });
    expect((out.result as any).state.tasks.map((task: any) => task.status)).toEqual(['done', 'done']);
    expect(existsSync(join(cwd, 'first.ts'))).toBe(false);
    expect(execFileSync('git', ['rev-list', '--count', 'main..goal/build-two'], { cwd, encoding: 'utf8' }).trim()).toBe('2');
    expect(execFileSync('git', ['log', '-1', '--pretty=%B', 'goal/build-two'], { cwd, encoding: 'utf8' })).not.toContain('Co-Authored-By');
    expect((h.services.receipts.record as any).mock.calls.filter(([kind]: [string]) => kind === 'mutation-assessment')).toHaveLength(2);
    expect(h.writeArtifact).toHaveBeenCalledWith(expect.anything(), 'result.json', expect.any(String), expect.anything());
    expect(h.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: true }), expect.anything());

    const status = await runGoal({ id: 'build-two', status: true }, context(cwd), h.services);
    expect(status).toMatchObject({ exitCode: 0, result: { counts: { done: 2 } } });
  });

  it('keeps push/PR as an explicit operator promotion plan and performs no network action', async () => {
    const cwd = repo(); const h = harness();
    const out = await runGoal({ intent: 'publish later', gate: 'test -f base.txt', engine: 'builder', reviewEngines: 'reviewer', requireTests: false, push: true, pr: true }, context(cwd), h.services);
    expect(out).toMatchObject({ exitCode: 0 });
    expect((out.result as any).promotion).toMatchObject({ requiresOperatorApproval: true, pushRequested: true, prRequested: true });
  });

  it('refuses a red base, protected branch, missing resume, and invalid dependency graph', async () => {
    const cwd = repo(); const h = harness();
    expect((await runGoal({ intent: 'x', gate: 'false' }, context(cwd), h.services)).failure?.code).toBe('GOAL_BASELINE_RED');
    expect((await runGoal({ intent: 'x', gate: 'true', branch: 'main' }, context(cwd), h.services)).stderr).toContain('goal/*');
    expect((await runGoal({ id: 'missing', resume: true }, context(cwd), h.services)).stderr).toContain('unknown goal');
    expect((await runGoal({ intent: 'x', gate: 'true', tasks: [{ id: 'x', dependsOn: ['missing'] }] }, context(cwd), h.services)).stderr).toContain('unknown task');
  });

  it('stops a strict non-discriminating task oracle before spending an engine call', async () => {
    const cwd = repo(); const h = harness();
    const out = await runGoal({ intent: 'strict oracle', gate: 'true', tasks: [{ id: 'x', source: 'x', verify: 'true' }], oracleGate: 'strict' }, context(cwd), h.services);
    expect(out.exitCode).toBe(1);
    expect((out.result as any).state).toMatchObject({ status: 'stopped', stopReason: 'strict-oracle' });
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('honors the metered budget before starting the next task', async () => {
    const cwd = repo(); const h = harness();
    h.dispatch.mockImplementation(async (_id: string, _prompt: string, invocation: any, options: any) => {
      if (options.mode === 'agent') writeFileSync(join(invocation.cwd, 'first.txt'), 'yes\n');
      return options.mode === 'agent'
        ? { exitCode: 0, stdout: 'done', stderr: '', timedOut: false, costUsd: 0.6 }
        : { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```', stderr: '', timedOut: false };
    });
    const out = await runGoal({ intent: 'budgeted', gate: 'true', budget: 0.5, requireTests: false, tasks: [{ id: 'first', source: 'one' }, { id: 'second', source: 'two', dependsOn: ['first'] }] }, context(cwd), h.services);
    expect((out.result as any).state).toMatchObject({ status: 'stopped', stopReason: 'budget' });
    expect((out.result as any).state.tasks.map((task: any) => task.status)).toEqual(['done', 'queued']);
  });

  it('owns bounded supervised re-exec and resumes after a transient crash', async () => {
    const h = harness();
    const runChild = vi.fn()
      .mockResolvedValueOnce({ exitCode: 137, outputTail: 'killed' })
      .mockResolvedValueOnce({ exitCode: 0, outputTail: 'done' });
    const wait = vi.fn(async () => undefined);
    const out = await runGoalSupervisor(
      { intent: 'overnight', gate: 'true', supervised: true, maxRestarts: '3' },
      { nodeExec: '/node', agonEntry: '/agon.js', runChild, wait, interrupted: () => false },
    );
    expect(out.exitCode).toBe(0);
    expect(out.result).toEqual({ restarts: 1, reason: 'clean exit — terminal state reached' });
    expect(runChild).toHaveBeenCalledTimes(2);
    expect(runChild.mock.calls[0][0]).toEqual(['goal', 'overnight', '--gate', 'true', '--resume']);
    expect(wait).toHaveBeenCalledWith(5000);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('lets an independent judge clear a panel finding before commit', async () => {
    const cwd = repo(); const h = harness();
    h.dispatch.mockImplementation(async (_id: string, prompt: string, invocation: any, options: any) => {
      if (options.mode === 'agent') {
        writeFileSync(join(invocation.cwd, 'first.txt'), 'yes\n');
        return { exitCode: 0, stdout: 'done', stderr: '', timedOut: false };
      }
      if (prompt.startsWith('Adjudicate')) return { exitCode: 0, stdout: '{"blocking":false,"reason":"false positive"}', stderr: '', timedOut: false };
      return { exitCode: 0, stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[{"file":"first.txt","lines":"1","severity":"blocking","blocking":true,"confidence":0.9,"problem":"claimed issue","minimalFix":"none"}]\n```', stderr: '', timedOut: false };
    });
    const out = await runGoal({ intent: 'judge review', gate: 'true', requireTests: false, engine: 'builder', reviewEngines: 'reviewer', judge: 'reviewer' }, context(cwd), h.services);
    expect(out.exitCode).toBe(0);
    expect((out.result as any).state.events.some((entry: any) => entry.type === 'review-adjudicated' && entry.detail.includes('cleared'))).toBe(true);
  });
});
