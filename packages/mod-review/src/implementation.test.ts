import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, CommandResult, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from './implementation.js';

function repo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-review-'));
  execFileSync('git', ['init'], { cwd });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd });
  writeFileSync(join(cwd, 'a.ts'), 'export const a = 1;\n');
  execFileSync('git', ['add', 'a.ts'], { cwd });
  execFileSync('git', ['commit', '-m', 'base'], { cwd });
  writeFileSync(join(cwd, 'a.ts'), 'export const a = maybe!.value;\n');
  return cwd;
}

async function setup(cwd: string, valid = true) {
  const dispatch = vi.fn(async (engineId: string) => ({
    engineId, exitCode: 0,
    stdout: valid ? 'Finding\n<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[{"file":"a.ts","lines":"1","severity":"blocking","blocking":true,"confidence":0.9,"problem":"unsafe assertion","minimalFix":"guard it"}]\n```' : 'unstructured',
    stderr: '', timedOut: false, costUsd: undefined as number | undefined,
  }));
  const record = vi.fn<ModServices['receipts']['record']>(async () => 'r');
  const finish = vi.fn(async () => undefined);
  const writeArtifact = vi.fn(async () => undefined);
  const runPath = join(cwd, '.runs', 'review');
  const services = {
    identity: { id: 'agon.review', version: '1', contentHash: `sha256:${'a'.repeat(64)}` },
    source: 'bundled',
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    receipts: { record },
    permissions: { check: vi.fn() },
    state: { read: vi.fn(), write: vi.fn() },
    runs: {
      start: vi.fn(async () => ({ id: 'run', path: runPath, mode: 'review', startedAt: '2026-01-01T00:00:00Z' })),
      finish, writeArtifact,
    },
    engines: { listActive: vi.fn(async () => ['alpha', 'beta', 'gamma']), dispatch },
  } as unknown as ModServices;
  let command: CommandContribution | undefined;
  const registrar = {
    command: (surface: string, value: CommandContribution) => { if (surface === 'cli') command = value; return () => {}; },
    intent: () => () => {}, tool: () => () => {}, planStep: () => () => {}, resultType: () => () => {}, config: () => () => {},
  } as unknown as Registrar;
  const mod = await createMod(services);
  await mod.activate(registrar, services);
  return {
    command: command!, dispatch, record, finish, writeArtifact, runPath,
    context: { invocationId: 'i', cwd, platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} },
  };
}

describe('physical review mod', () => {
  it.each(['valid', 'failed', 'timeout', 'malformed'])('retains reported seat costs for %s evidence', async (mode) => {
    const valid = mode === 'valid';
    const h = await setup(repo());
    h.dispatch.mockImplementation(async (engineId: string) => ({
      engineId, exitCode: mode === 'failed' ? 1 : 0,
      stdout: mode === 'malformed' ? 'not a review' : '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```',
      stderr: valid ? '' : 'provider failed after billed work', timedOut: mode === 'timeout',
      costUsd: engineId === 'alpha' ? 0.2 : 0.3,
    }));
    const out = await h.command.run({ engines: 'alpha,beta' }, h.context) as CommandResult;
    expect(out.exitCode).toBe(valid ? 0 : 1);
    expect((out.result as any).reviews.map((review: any) => review.costUsd)).toEqual([0.2, 0.3]);
    expect((out.result as any).reviews.map((review: any) => review.ok)).toEqual([valid, valid]);
  });

  it('resolves the diff, runs a risk-sized panel, parses evidence, and blocks on verified findings', async () => {
    const h = await setup(repo());
    const out = await h.command.run({ target: 'uncommitted', risk: 'medium', 'primary-engine': 'builder' }, h.context);
    const result = JSON.parse((out as { stdout: string }).stdout);
    expect(out).toMatchObject({ exitCode: 2 });
    expect(result).toMatchObject({ panelHealth: { requested: 2, responded: 2, degraded: false }, runDir: h.runPath });
    expect(result.consensus.blocking).toHaveLength(2);
    expect(h.record).toHaveBeenCalled();
    expect(h.writeArtifact).toHaveBeenCalledTimes(2);
    expect(h.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: false, mode: 'review' }), h.context);
  });

  it('runs mutation as advisory without changing the review verdict', async () => {
    const h = await setup(repo());
    const out = await h.command.run({ target: 'uncommitted', engine: 'alpha', mutate: true, 'mutate-test': 'true', 'mutate-lens': 'security' }, h.context) as CommandResult;
    const result = JSON.parse((out as { stdout: string }).stdout);
    expect(out.exitCode).toBe(2);
    expect(result.mutation).toMatchObject({ ok: true });
    expect(result.mutation).toMatchObject({ lens: 'security', engineCalls: 1 });
  });

  it.each([undefined, -1, Number.NaN, Number.POSITIVE_INFINITY])('does not turn invalid cost %s into credit or a non-finite total', async (costUsd) => {
    const h = await setup(repo());
    h.dispatch.mockResolvedValue({
      engineId: 'alpha', exitCode: 0,
      stdout: '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```',
      stderr: '', timedOut: false, costUsd,
    });
    const out = await h.command.run({ engine: 'alpha' }, h.context) as CommandResult;
    expect(out.exitCode).toBe(0);
    expect((out.result as any).reviews[0].costUsd).toBe(0);
  });

  it('warns when mutation-only flags are passed without --mutate', async () => {
    const h = await setup(repo());
    const out = await h.command.run({ target: 'uncommitted', engine: 'alpha', 'mutate-build': 'npm run build' }, h.context) as CommandResult;
    expect((out.result as any).warnings[0]).toContain('no effect without --mutate');
    expect(h.record.mock.calls.some(([kind]) => kind === 'mutation-assessment')).toBe(false);
  });

  it('rejects outputs without the mandatory machine block', async () => {
    const h = await setup(repo(), false);
    const out = await h.command.run({ target: 'uncommitted', engine: 'alpha' }, h.context);
    expect(out).toMatchObject({ exitCode: 1 });
  });

  it('keeps a rejected dispatch blocked without inventing a reported cost', async () => {
    const h = await setup(repo());
    h.dispatch.mockRejectedValue(new Error('dispatch rejected'));
    const out = await h.command.run({ engine: 'alpha' }, h.context) as CommandResult;
    expect(out.exitCode).toBe(1);
    expect((out.result as any).reviews).toEqual([
      expect.objectContaining({ ok: false, costUsd: 0, error: 'dispatch rejected' }),
    ]);
  });
});
