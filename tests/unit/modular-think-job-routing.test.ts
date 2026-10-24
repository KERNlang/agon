import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ execute: vi.fn(), resume: vi.fn(), outcome: vi.fn(), selected: vi.fn() }));
const record = vi.hoisted(() => ({ id: 'think-fixture', kind: 'intent', owner: { id: 'agon.think' }, payload: {} }));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', async original => ({
  ...await original<object>(), captureProcessSurfaceAuthority: () => mocks.selected,
  processSurfaceClient: () => ({ project: () => ({ entries: [record] }), assertAvailable: () => record }),
}));
vi.mock('../../packages/cli/src/signals/dispatch/intent-session.js', async original => ({
  ...await original<object>(), runPhysicalTuiContribution: mocks.execute,
}));
vi.mock('../../packages/cli/src/signals/dispatch/cesar-router.js', async original => ({
  ...await original<object>(), continueCesarAfterResult: mocks.resume,
}));
vi.mock('../../packages/cli/src/signals/dispatch/delegation.js', async original => ({
  ...await original<object>(), collectRecentEngineContext: () => 'Saved Think answer',
  withThreadOutcome: (...args: unknown[]) => { mocks.outcome(...args); return args[3]; },
}));
import { dispatchIntent } from '../../packages/cli/src/signals/dispatch/intent-router.js';
import { dispatchOrchestrationIntent } from '../../packages/cli/src/signals/dispatch/intent-orchestration.js';
import { JobManager } from '../../packages/cli/src/signals/job-manager.js';

beforeEach(() => vi.resetAllMocks());

it.each(['generated', 'fallback'].flatMap(route => [false, true].map(failed => ({ route, failed }))))('preserves $route Think job outcome (failed=$failed)', async ({ route, failed }) => {
    mocks.execute.mockReset(); mocks.resume.mockClear(); mocks.outcome.mockClear();
    if (failed) mocks.execute.mockRejectedValue(new Error('Think receipt failed'));
    else mocks.execute.mockResolvedValue(undefined);
    const manager = new JobManager();
    let jobId = '';
    const cb = { dispatch: vi.fn(), ctx: { config: {}, chatSession: { messages: [] }, inputEpoch: 7 },
      runAsJob: (type: string, label: string, run: (signal: AbortSignal) => Promise<void>) => { jobId = manager.run(type, label, run).id; } };
    const input = { input: 'Question', strategy: 'tot', steps: 4, branches: 3, engine: 'alias', critic: 'critic', timeout: 45, ground: false };
    if (route === 'generated') await dispatchIntent({ type: 'think', _modSurface: {
      publicId: 'think', registryId: record.id, kind: record.kind, value: input,
    } }, '/think Question', cb as never);
    else await dispatchOrchestrationIntent({ type: 'think', ...input }, '/think Question', cb as never);
    const finished = await manager.wait(jobId);
    expect(finished?.state).toBe(failed ? 'failed' : 'done');
    if (failed) expect(finished?.error).toContain('Think receipt failed');
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.execute.mock.calls[0][1]).toMatchObject(input);
    expect(mocks.execute.mock.calls[0][4]).toBeInstanceOf(AbortSignal);
    expect(mocks.outcome).toHaveBeenCalledOnce();
    expect(mocks.resume).toHaveBeenCalledTimes(failed ? 0 : 1);
    if (!failed) expect(mocks.resume).toHaveBeenCalledWith(expect.stringContaining('Saved Think answer'), expect.anything(), 7, 0);
});

it.each(['generated', 'fallback'].flatMap(route => ['cancel', 'replace'].map(fault => ({ route, fault }))))('blocks $route continuation after $fault', async ({ route, fault }) => {
  const manager = new JobManager();
  let jobId = '';
  mocks.execute.mockImplementation(async () => {
    if (fault === 'cancel') manager.cancel(jobId, 'cancelled');
    else mocks.selected.mockImplementation(() => { throw new Error('generation replaced'); });
  });
  const cb = { dispatch: vi.fn(), ctx: { config: {}, chatSession: { messages: [] }, inputEpoch: 7 },
    runAsJob: (type: string, label: string, run: (signal: AbortSignal) => Promise<void>) => { jobId = manager.run(type, label, run).id; } };
  const input = { input: 'Question' };
  if (route === 'generated') await dispatchIntent({ type: 'think', _modSurface: {
    publicId: 'think', registryId: record.id, kind: record.kind, value: input,
  } }, '/think Question', cb as never);
  else await dispatchOrchestrationIntent({ type: 'think', ...input }, '/think Question', cb as never);
  expect((await manager.wait(jobId))?.state).toBe(fault === 'cancel' ? 'cancelled' : 'failed');
  expect(mocks.resume).not.toHaveBeenCalled();
});

it.each(['generated', 'fallback'])('shows empty-input usage without starting a %s job', async route => {
  const cb = { dispatch: vi.fn(), ctx: { config: {}, chatSession: { messages: [] } }, runAsJob: vi.fn() };
  if (route === 'generated') await dispatchIntent({ type: 'think', _modSurface: {
    publicId: 'think', registryId: record.id, kind: record.kind, value: { input: '' },
  } }, '/think', cb as never);
  else await dispatchOrchestrationIntent({ type: 'think', input: '' }, '/think', cb as never);
  expect(cb.runAsJob).not.toHaveBeenCalled();
  expect(cb.dispatch).toHaveBeenCalledWith({ type: 'warning', message: 'Usage: /think <problem> [--strategy reflexion] [--steps 8]' });
});
