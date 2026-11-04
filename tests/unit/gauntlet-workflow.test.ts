import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as core from '@kernlang/agon-core';
import * as fitness from '../../packages/forge/src/fitness.js';
import { runGauntlet } from '../../packages/forge/src/gauntlet.js';
import { runGauntlet as runOwnedGauntlet } from '../../packages/mod-forge/src/gauntlet.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'agon-gauntlet-workflow-')); });
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

it.each(['before-start', 'after-breaker', 'after-validation', 'after-pre-fitness', 'after-repair', 'after-repair-done', 'after-done'] as const)(
  'stops gauntlet phase effects on cancellation: %s', async phase => {
    const winnerWorktree = join(root, 'winner');
    mkdirSync(winnerWorktree);
    writeFileSync(join(winnerWorktree, 'patched'), 'fixture');
    const controller = new AbortController();
    const reason = new Error('cancel gauntlet');
    if (phase === 'before-start') controller.abort(reason);
    const logger = { log: vi.fn() };
    const runtime = {
      repoRoot: () => root,
      worktreeDiff: () => 'fixture patch',
      worktreeCreate: vi.fn((_repo: string, path: string) => { mkdirSync(path); return path; }),
      worktreeRemoveBestEffort: vi.fn((_repo: string, path: string) => rmSync(path, { recursive: true })),
      createSidechainLogger: vi.fn(() => logger),
      runFitness: vi.fn(async () => {
        if (phase === 'after-pre-fitness') controller.abort(reason);
        return { pass: true, score: 80 };
      }),
    };
    const registry = new core.EngineRegistry();
    vi.spyOn(registry, 'get').mockImplementation(id => ({ schemaVersion: 1, id,
      displayName: id, isLocal: true, tier: 'user', timeout: 3 }));
    const dispatch = vi.fn<core.EngineAdapter['dispatch']>(async options => {
      if (phase === 'after-breaker' || (phase === 'after-repair' && options.engine.id === 'winner')) controller.abort(reason);
      return { exitCode: 0, stdout: "import { existsSync } from 'node:fs'; process.exit(existsSync('patched') ? 1 : 0)",
        stderr: '', durationMs: 0, timedOut: false };
    });
    const adapter: core.EngineAdapter = { dispatch, isAvailable: async () => true, getVersion: async () => null };
    const pending = runOwnedGauntlet({ winnerId: 'winner', losers: ['breaker'], task: 'fixture',
      winnerWorktree, fitnessCmd: JSON.stringify(process.execPath), taskClass: 'feature',
      forgeDir: root, registry, adapter, timeout: 3, fitnessTimeout: 3, maxBreakers: 1,
      repairTimeout: 3, cwd: root, baseSha: 'fixture-sha', signal: controller.signal,
      onEvent: event => {
        if ((phase === 'after-validation' && event.type === 'gauntlet:breaker-done')
          || (phase === 'after-repair-done' && event.type === 'gauntlet:repair-done')
          || (phase === 'after-done' && event.type === 'gauntlet:done')) controller.abort(reason);
      },
    }, runtime);
    if (phase === 'after-done') await expect(pending).resolves.toMatchObject({ repairPass: true });
    else await expect(pending).rejects.toBe(reason);
    const repairCompleted = phase === 'after-repair-done' || phase === 'after-done';
    expect(runtime.runFitness).toHaveBeenCalledTimes(repairCompleted ? 2 : phase === 'after-pre-fitness' || phase === 'after-repair' ? 1 : 0);
    expect(dispatch).toHaveBeenCalledTimes(phase === 'before-start' ? 0 : phase === 'after-repair' || repairCompleted ? 2 : 1);
    const created = phase !== 'before-start' && phase !== 'after-breaker';
    expect(runtime.worktreeCreate).toHaveBeenCalledTimes(created ? 1 : 0);
    expect(runtime.worktreeRemoveBestEffort).toHaveBeenCalledTimes(created ? 1 : 0);
    if (phase === 'before-start') expect(runtime.createSidechainLogger).not.toHaveBeenCalled();
  }, 10000,
);

it.each(['exec-repair', 'agent-repair', 'repair-error', 'invalid-attack', 'breaker-error'] as const)(
  'preserves gauntlet workflow: %s', async scenario => {
    const winnerWorktree = join(root, 'winner');
    mkdirSync(winnerWorktree);
    writeFileSync(join(winnerWorktree, 'patched'), 'fixture');
    vi.spyOn(core, 'repoRoot').mockReturnValue(root);
    vi.spyOn(core, 'worktreeDiff').mockReturnValue('fixture patch');
    const create = vi.spyOn(core, 'worktreeCreate').mockImplementation((_repo, path) => {
      mkdirSync(path); return path;
    });
    const remove = vi.spyOn(core, 'worktreeRemoveBestEffort').mockImplementation((_repo, path) => {
      rmSync(path, { recursive: true });
    });
    const scored: core.EngineResult = { engineId: 'winner', pass: true, score: 60,
      diffLines: 1, filesChanged: 1, durationSec: 0, lintWarnings: 0, styleScore: 100 };
    const runFitness = vi.spyOn(fitness, 'runFitness')
      .mockResolvedValueOnce(scored).mockResolvedValue({ ...scored, score: 80 });
    const registry = new core.EngineRegistry();
    vi.spyOn(registry, 'get').mockImplementation(id => ({ schemaVersion: 1, id,
      displayName: id, isLocal: true, tier: 'user', timeout: 3,
      ...(scenario === 'agent-repair' && id === 'winner' ? { agent: { args: [] } } : {}) }));
    const script = scenario === 'invalid-attack' ? 'process.exit(0); // no attack'
      : "import { existsSync } from 'node:fs'; process.exit(existsSync('patched') ? 1 : 0)";
    const response = { exitCode: 0, stdout: '', stderr: '', durationMs: 0, timedOut: false };
    const dispatch = vi.fn<core.EngineAdapter['dispatch']>(async options => {
      if (options.engine.id === 'breaker') {
        if (scenario === 'breaker-error') throw new Error('fixture breaker failure');
        return { ...response, stdout: script };
      }
      if (scenario === 'repair-error') throw new Error('fixture repair failure');
      return response;
    });
    const dispatchAgent = vi.fn<NonNullable<core.EngineAdapter['dispatchAgent']>>()
      .mockResolvedValue({ ...response, diff: '', diffLines: 0, filesChanged: 0 });
    const adapter: core.EngineAdapter = { dispatch, dispatchAgent,
      isAvailable: async () => true, getVersion: async () => null };
    const events: core.ForgeEvent[] = [];
    const signal = new AbortController().signal;
    const result = await runGauntlet({ winnerId: 'winner', losers: ['breaker', 'unused'],
      task: 'fixture task', winnerWorktree, fitnessCmd: JSON.stringify(process.execPath),
      taskClass: 'feature', forgeDir: root, registry, adapter, timeout: 3,
      fitnessTimeout: 3, maxBreakers: 1, repairTimeout: 4, cwd: root, baseSha: 'fixture-sha',
      onEvent: event => events.push(event), signal });
    const attacked = scenario !== 'invalid-attack' && scenario !== 'breaker-error';
    expect(result).toMatchObject({ winnerId: 'winner', finalWinnerId: 'winner',
      attacksLanded: attacked ? 1 : 0, repairAttempted: attacked,
      repairPass: scenario !== 'repair-error', preRepairScore: 60, postRepairScore: attacked ? 80 : 60 });
    expect(result.breakerArtifacts).toHaveLength(attacked ? 1 : 0);
    expect(create).toHaveBeenCalledWith(root, join(root, 'gauntlet-clean'), 'fixture-sha');
    expect(remove).toHaveBeenCalledOnce();
    expect(runFitness).toHaveBeenCalledTimes(attacked ? 2 : 1);
    for (const [options] of runFitness.mock.calls) expect(options.signal).toBe(signal);
    expect(dispatch.mock.calls.map(([options]) => options.engine.id))
      .toEqual(attacked && scenario !== 'agent-repair' ? ['breaker', 'winner'] : ['breaker']);
    expect(dispatchAgent).toHaveBeenCalledTimes(scenario === 'agent-repair' ? 1 : 0);
    for (const [options] of [...dispatch.mock.calls, ...dispatchAgent.mock.calls]) {
      expect(options.signal).toBe(signal);
    }
    expect(events[0].type).toBe('gauntlet:start');
    expect(events.at(-1)).toMatchObject({ type: 'gauntlet:done', data: {
      attacksLanded: attacked ? 1 : 0, repairPass: scenario !== 'repair-error' } });
  }, 10000,
);
