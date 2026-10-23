import { existsSync, readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ execute: vi.fn(), append: vi.fn(), record: vi.fn() }));
vi.mock('@kernlang/agon-core', async original => ({ ...await original<object>(), appendMessage: mocks.append }));
vi.mock('../../packages/cli/src/telemetry/index.js', async original => ({ ...await original<object>(), recordRun: mocks.record, formatRunSummary: () => 'saved run' }));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', async original => ({ ...await original<object>(), executeProcessCesarRoute: mocks.execute }));
vi.mock('../../packages/cli/src/signals/dispatch/delegation.js', async original => ({
  ...await original<object>(), withThreadOutcome: (_cwd: string, _mode: string, _label: string, run: () => Promise<unknown>) => run,
  collectRecentEngineContext: () => '',
}));
import { runPhysicalCesarWorkflow } from '../../packages/cli/src/signals/dispatch/cesar-router.js';
import { runPhysicalTuiContribution } from '../../packages/cli/src/signals/dispatch/intent-session.js';
import { dispatchOrchestrationIntent } from '../../packages/cli/src/signals/dispatch/intent-orchestration.js';

const result = { outputDir: '/run', workflow: { done: true, stopReason: 'done', turnsUsed: 1,
  consultsRun: 0, lastClaim: 'verified feature', doneReason: 'gate checked' } };
const callbacks = () => ({ dispatch: vi.fn(), ctx: { config: {}, chatSession: { id: 'fixture' } }, runAsJob: vi.fn() });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.execute.mockImplementation(async (_route, _input, context) => {
    context.onWorkflowEvent?.({ type: 'conquer:start', data: {
      builder: 'builder', advisors: ['advisor'], worktree: { branch: 'conquer/fixture', path: '/retained' },
    } });
    context.onWorkflowEvent?.({ type: 'conquer:turn', data: { n: 1, action: 'done-check', detail: 'gate checked' } });
    return { exitCode: 0, result };
  });
});

it.each(['tui', 'cesar', 'fallback'])('runs the selected Conquer %s path with the job signal and session effects', async surface => {
  const cb = callbacks();
  const signal = new AbortController().signal;
  const input = { task: 'build feature', gate: 'npm test' };
  if (surface === 'cesar') await runPhysicalCesarWorkflow('conquer', input, cb as never, signal, '/selected');
  else if (surface === 'tui') await runPhysicalTuiContribution({ owner: { id: 'agon.conquer' }, payload: {
    inputSchema: { type: 'object' }, run: (value: unknown, context: unknown) => mocks.execute('conquer', value, context),
  } }, input, 'conquer', cb as never, signal);
  else {
    await dispatchOrchestrationIntent({ type: 'conquer', ...input }, '/conquer build feature', cb as never);
    expect(cb.runAsJob).toHaveBeenCalledOnce();
    await cb.runAsJob.mock.calls[0][2](signal);
  }
  expect(mocks.execute).toHaveBeenCalledExactlyOnceWith('conquer', expect.objectContaining(input), expect.objectContaining({ signal }));
  expect(mocks.append).toHaveBeenCalledExactlyOnceWith(cb.ctx.chatSession, expect.objectContaining({ content: '[conquer:done] verified feature' }));
  expect(mocks.record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ mode: 'conquer', success: true }));
  expect(cb.dispatch).toHaveBeenCalledWith({ type: 'info', message: 'turn 1 · done-check — gate checked' });
  expect(cb.dispatch).toHaveBeenCalledWith({ type: 'info', message: expect.stringContaining('Review and commit there') });
});

it.each(['cancelled', 'disabled', 'replaced'])('rejects late success when Conquer is %s', async reason => {
  const cb = callbacks();
  const controller = new AbortController();
  mocks.execute.mockImplementationOnce(async () => {
    if (reason === 'cancelled') { controller.abort(new Error(reason)); return { exitCode: 0, result }; }
    throw new Error(reason);
  });
  await expect(runPhysicalCesarWorkflow('conquer', { task: 'build', gate: 'true' }, cb as never, controller.signal)).rejects.toThrow(reason);
  expect(mocks.append).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
});

it('does not grant Conquer presentation by public name alone', async () => {
  const cb = callbacks();
  await runPhysicalTuiContribution({ owner: { id: 'external.fixture' }, payload: {
    inputSchema: { type: 'object' }, run: async () => ({ exitCode: 0, stdout: 'external output' }),
  } }, {}, 'conquer', cb as never, new AbortController().signal);
  expect(mocks.append).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
  expect(cb.dispatch).toHaveBeenCalledWith({ type: 'info', message: 'external output' });
});

it('retires the legacy Conquer session handler and its dispatch import', () => {
  expect(existsSync(new URL('../../packages/cli/src/handlers/conquer.ts', import.meta.url))).toBe(false);
  const source = readFileSync(new URL('../../packages/cli/src/signals/dispatch/intent-orchestration.ts', import.meta.url), 'utf8');
  expect(source).not.toContain('handleConquer');
});
