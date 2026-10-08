import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState, planDesiredStateChange } from '../../packages/mod-kernel/src/index.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';
import { disposeProcessSurfaceAuthority, initializeProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';

const effects = vi.hoisted(() => ({ approve: vi.fn(async () => true), resume: vi.fn(async () => {}) }));
vi.mock('../../packages/cli/src/signals/dispatch/plan-execution.js', async original => ({
  ...await original<Record<string, unknown>>(),
  approvePendingCesarPlan: effects.approve,
  resumeCesarPlan: effects.resume,
}));
import { dispatchIntent } from '../../packages/cli/src/signals/dispatch/intent-router.js';

const NOW = '2026-10-09T00:00:00.000Z';

describe.each([true, false])('natural Plan input with disabled=%s', disabled => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'agon-plan-natural-'));
    const catalog = createFirstPartyModCatalog();
    const full = createFullCompatDesiredState(catalog, NOW);
    const desired = disabled
      ? planDesiredStateChange(catalog, full, { kind: 'disable', id: 'agon.plan' }, NOW).nextState
      : full;
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'plan-natural-test' });
    await host.commitGeneration({ operation: disabled ? 'disable' : 'install', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
    await initializeProcessSurfaceAuthority(root);
  });
  afterAll(async () => {
    await disposeProcessSurfaceAuthority();
    // The host deliberately seals generation directories read-only.
    await chmod(join(root, 'generations', '0000000000000001'), 0o755);
    await rm(root, { recursive: true, force: true });
  });
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['awaiting_approval', 'go', 'approve'],
    ['paused', 'continue', 'resume'],
    ['running', 'resume', 'resume'],
  ] as const)('checks the active registry before %s / %s', async (state, input, action) => {
    const plan = { id: 'cplan-fixture', state, steps: [], intent: 'fixture', createdAt: NOW };
    const dispatch = vi.fn();
    const runAsJob = vi.fn();
    const cb = { dispatch, runAsJob, ctx: { activePlan: plan, cesar: {}, config: {} } } as unknown as DispatchCallbacks;
    const before = structuredClone(plan);
    const result = await dispatchIntent({ type: 'chat', input }, input, cb);
    expect(result).toEqual({ handled: true, ranAsJob: false });
    expect(effects[action]).toHaveBeenCalledTimes(disabled ? 0 : 1);
    expect(effects[action === 'approve' ? 'resume' : 'approve']).not.toHaveBeenCalled();
    expect(runAsJob).not.toHaveBeenCalled();
    expect(plan).toStrictEqual(before);
    if (disabled) expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('unavailable') }));
  });

  it('keeps historical status readable without executing a disabled plan', async () => {
    const dispatch = vi.fn();
    const cb = { dispatch, ctx: { activePlan: { id: 'cplan-history', state: 'paused', steps: [] }, cesar: {} } } as unknown as DispatchCallbacks;
    await dispatchIntent({ type: 'chat', input: 'status' }, 'status', cb);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'info', message: expect.stringContaining('is paused') }));
    expect(effects.approve).not.toHaveBeenCalled();
    expect(effects.resume).not.toHaveBeenCalled();
  });

  it.each(['awaiting_approval', 'paused'] as const)('refuses %s actions after a generation change', async state => {
    const pointer = join(root, 'current-generation.json');
    const original = await readFile(pointer);
    try {
      await writeFile(pointer, '{}\n');
      const dispatch = vi.fn();
      const cb = { dispatch, ctx: { activePlan: { id: 'cplan-stale', state, steps: [] }, cesar: {} } } as unknown as DispatchCallbacks;
      await dispatchIntent({ type: 'chat', input: 'go' }, 'go', cb);
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('restart Agon') }));
      expect(effects.approve).not.toHaveBeenCalled();
      expect(effects.resume).not.toHaveBeenCalled();
    } finally {
      await writeFile(pointer, original);
    }
  });
});
