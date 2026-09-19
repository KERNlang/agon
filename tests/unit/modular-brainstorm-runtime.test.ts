import { expect, it, vi } from 'vitest';
import { createBrainstormRuntime } from '../../packages/mod-brainstorm/src/runtime.js';
import type { BrainstormRuntimeServices } from '../../packages/mod-brainstorm/src/runtime.js';
import type { BrainstormWorkflowOptions } from '../../packages/mod-brainstorm/src/workflow.js';

it('constructs the runtime without reading or invoking host capabilities', () => {
  const access = vi.fn(() => { throw new Error('unexpected host access'); });
  const services = new Proxy({} as BrainstormRuntimeServices<BrainstormWorkflowOptions>, { get: access });
  const runtime = createBrainstormRuntime(services);
  expect(runtime.runBrainstorm).toBeTypeOf('function');
  expect(runtime.runScout).toBeTypeOf('function');
  expect(runtime.collectRankedDrafts).toBeTypeOf('function');
  expect(access).not.toHaveBeenCalled();
});

it('isolates scout controls without mutating options or discarding host state', async () => {
  interface Options extends BrainstormWorkflowOptions { hostToken: object }
  const selected: Options[] = [];
  const onEvent = vi.fn();
  const services: BrainstormRuntimeServices<Options> = {
    readRatings: () => ({ byMode: { brainstorm: {} }, global: {} }),
    seed: () => {},
    preflight: async options => ({ healthy: options.engines, skipped: [] }),
    createLogger: () => ({ log: () => {} }),
    deduplicate: async () => ({ groups: null, status: { status: 'unavailable' } }),
    updateRatings: () => {},
    selectWinner: () => async () => ({ exitCode: 0, stdout: 'fixture' }),
    buildPrompt: () => 'fixture prompt',
    parseDraft: () => null,
    selectSeat: options => {
      selected.push(options);
      return async () => ({ engineId: 'a', ok: true, text: 'fixture answer', attempts: 1,
        failure: null, note: null, detail: null });
    },
  };
  const hostToken = {};
  const options = Object.freeze({ question: 'fixture', engines: ['a'], style: 'divergent',
    onEvent, hostToken, timeout: 120, outputDir: '/fixture', scoutCount: 1 });
  const runtime = createBrainstormRuntime(services);
  await runtime.runScout(options);
  expect(selected).toHaveLength(1);
  expect(selected[0]).toMatchObject({ hostToken, engines: ['a'], timeout: 30 });
  expect(selected[0].hostToken).toBe(hostToken);
  expect(selected[0]).not.toHaveProperty('style');
  expect(selected[0]).not.toHaveProperty('onEvent');
  expect(selected[0]).not.toHaveProperty('scoutCount');
  expect(onEvent).not.toHaveBeenCalled();
  expect(options).toMatchObject({ timeout: 120, style: 'divergent', scoutCount: 1 });
});
