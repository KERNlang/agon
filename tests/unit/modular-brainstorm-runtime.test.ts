import { expect, it, vi } from 'vitest';
import { createBrainstormRuntime } from '../../packages/mod-brainstorm/src/runtime.js';
import type { BrainstormRuntimeServices } from '../../packages/mod-brainstorm/src/runtime.js';
import type { BrainstormWorkflowOptions } from '../../packages/mod-brainstorm/src/workflow.js';
import { ModRegistry } from '@kernlang/agon-kernel';
import type { CommandContribution } from '../../packages/mod-api/src/index.js';
import { manifest } from '../helpers/modular-agon.js';

it.each([true, false])('continues Brainstorm with rating effects enabled=%s', async enabled => {
  const owner = { id: 'agon.brainstorm', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` as const };
  const ratings = { ...owner, id: 'agon.ratings' };
  const registry = new ModRegistry({
    generation: `ratings:${enabled}`, activeOwners: enabled ? [owner, ratings] : [owner],
    configurationScope: { hostRoot: '/fixture', configuration: undefined },
  });
  const readRatings = vi.fn(() => ({ global: { a: { wins: 9, losses: 1 } }, byMode: { brainstorm: {} } }));
  const seed = vi.fn();
  const updateRatings = vi.fn();
  const services: BrainstormRuntimeServices<BrainstormWorkflowOptions> = {
    readRatings, seed, updateRatings,
    preflight: async options => ({ healthy: options.engines, skipped: [] }),
    createLogger: () => ({ log() {} }),
    deduplicate: async () => ({ groups: null, status: { status: 'not-needed' } }),
    selectWinner: () => async () => ({ exitCode: 0, stdout: 'completed brainstorm' }),
    buildPrompt: () => 'fixture prompt',
    parseDraft: () => ({ approach: 'A concrete fixture approach', reasoning: 'A concrete fixture reason',
      tradeoffs: [], confidence: 50, keyFiles: [], steps: ['Inspect'] }),
    selectSeat: (_options, engineId) => async () => ({ engineId, ok: true, text: 'fixture answer',
      attempts: 1, failure: null, note: null, detail: null }),
  };
  const runtime = createBrainstormRuntime(services);
  const registration = registry.beginRegistration(manifest(owner.id, owner.version, {
    contributes: { cliCommands: [{ id: 'brainstorm', aliases: [] }], tuiActions: [],
      mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [] },
  }));
  registration.registrar.command('cli', {
    id: 'brainstorm', description: 'Fixture Brainstorm',
    run: async () => {
      const result = await runtime.runBrainstorm({ question: 'fixture', engines: ['a', 'b'],
        timeout: 1, outputDir: '/fixture' });
      expect(result.response).toBe('completed brainstorm');
      expect(result.bids.find(bid => bid.engineId === 'a')!.confidence).toBe(enabled ? 78 : 50);
      return { exitCode: 0 };
    },
  });
  registration.commit();
  const command = registry.resolve('cli-command', 'brainstorm')!.payload as CommandContribution;
  await command.run({}, { invocationId: 'fixture', cwd: '/fixture', platform: 'darwin-arm64',
    signal: new AbortController().signal, config: {} });
  expect(readRatings.mock.calls.length > 0).toBe(enabled);
  expect(seed).toHaveBeenCalledTimes(enabled ? 1 : 0);
  expect(updateRatings).toHaveBeenCalledTimes(enabled ? 1 : 0);
});

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
