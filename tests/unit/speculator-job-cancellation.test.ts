import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<object>(),
  createSpeculator: () => ({ run: mocks.run }),
}));

import { dispatchOrchestrationIntent } from '../../packages/cli/src/signals/dispatch/intent-orchestration.js';

it('passes the job cancellation signal to Speculator', async () => {
  const controller = new AbortController();
  mocks.run.mockResolvedValue({ candidates: [], scores: {}, winner: null, winnerId: null, appliedFiles: [], runId: 'fixture' });
  const callbacks = {
    dispatch: vi.fn(),
    runAsJob: vi.fn(),
    ctx: {
      config: {},
      activeEngines: () => ['fixture'],
      registry: { get: () => ({ api: { baseUrl: 'https://example.invalid/v1', model: 'fixture' } }) },
    },
  };
  await dispatchOrchestrationIntent({ type: 'speculate', input: 'edit fixture' }, '/speculate edit fixture', callbacks as never);
  expect(callbacks.runAsJob).toHaveBeenCalledOnce();
  await callbacks.runAsJob.mock.calls[0][2](controller.signal);
  expect(mocks.run).toHaveBeenCalledOnce();
  expect(mocks.run.mock.calls[0][0].signal).toBe(controller.signal);
});
