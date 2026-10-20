import { beforeEach, expect, it, vi } from 'vitest';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';

const effects = vi.hoisted(() => ({ run: vi.fn(), continue: vi.fn() }));
vi.mock('../../packages/cli/src/handlers/team-brainstorm.js', () => ({ handleTeamBrainstorm: effects.run }));
vi.mock('../../packages/cli/src/signals/dispatch/cesar-router.js', async original => ({
  ...await original<object>(), continueCesarAfterResult: effects.continue,
}));
import { dispatchOrchestrationIntent } from '../../packages/cli/src/signals/dispatch/intent-orchestration.js';

beforeEach(() => { vi.resetAllMocks(); effects.run.mockResolvedValue(true); });

async function queued() {
  const jobs: Array<(signal: AbortSignal) => Promise<unknown>> = [];
  const cb = { dispatch: vi.fn(), ctx: { config: {}, chatSession: { messages: [
    { role: 'engine', engineId: 'old', content: 'Previous result' },
  ] } }, runAsJob: (_kind: string, _label: string, run: (signal: AbortSignal) => Promise<unknown>) => jobs.push(run),
  } as unknown as DispatchCallbacks;
  await dispatchOrchestrationIntent({ type: 'team-brainstorm', question: 'Design', membersPerSide: 3 }, '', cb);
  expect(jobs).toHaveLength(1);
  return { run: jobs[0]!, cb };
}

it('passes the job signal through outcome capture to the Team Brainstorm handler', async () => {
  const { run, cb } = await queued();
  const controller = new AbortController();
  await run(controller.signal);
  expect(effects.run).toHaveBeenCalledExactlyOnceWith('Design', cb.dispatch, cb.ctx, 3, controller.signal);
  expect(effects.continue).toHaveBeenCalledOnce();
});

it('does not start a cancelled queued job', async () => {
  const { run } = await queued();
  const controller = new AbortController(); controller.abort(new Error('Cancelled before start'));
  await expect(run(controller.signal)).rejects.toThrow('Cancelled before start');
  expect(effects.run).not.toHaveBeenCalled();
  expect(effects.continue).not.toHaveBeenCalled();
});

it('does not continue Cesar after cancellation during settlement', async () => {
  const { run } = await queued();
  const controller = new AbortController();
  effects.run.mockImplementation(() => { controller.abort(new Error('Cancelled during settlement')); return true; });
  await expect(run(controller.signal)).rejects.toThrow('Cancelled during settlement');
  expect(effects.continue).not.toHaveBeenCalled();
});

it('does not use old history when the session produced no result', async () => {
  const { run } = await queued();
  effects.run.mockResolvedValue(undefined);
  await run(new AbortController().signal);
  expect(effects.continue).not.toHaveBeenCalled();
});
