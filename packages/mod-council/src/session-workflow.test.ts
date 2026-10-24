import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { runCouncilSession } from './session-workflow.js';

const result = { ok: true, question: 'Q', brief: 'Brief', chairmanId: 'alpha', actingChairmanId: 'beta',
  chairmanReason: 'forced' as const, seats: [{ engineId: 'beta', role: 'security', response: 'Evidence', critique: '', critiquedRole: '' }],
  verdict: 'Conclusion', confidence: 0, degraded: true, warnings: ['Chair failed over'], outputDir: '/fixture' };

it.each([false, true].flatMap(failover => [null, 0, 91].map(confidence => ({ failover, confidence }))))('matches frozen legacy session effects: $failover/$confidence', async ({ failover, confidence }) => {
  const value = { ...result, actingChairmanId: failover ? 'beta' : 'alpha', confidence,
    seats: [{ ...result.seats[0], critique: 'Counterpoint', critiquedRole: 'delivery' }] };
  const legacy: unknown[] = [], current: unknown[] = [];
  const record = (target: unknown[]) => ({
    appendMessage: (...args: unknown[]) => { target.push(['append', ...args]); },
    track: (...args: unknown[]) => { target.push(['track', ...args]); },
    addResult: (entry: unknown) => { target.push(['result', entry]); },
    recordRun: (entry: unknown) => { target.push(['run', entry]); return {}; },
  });
  const old = record(legacy);
  const source = readFileSync(new URL('../../../tests/fixtures/modular-council-session-legacy.txt', import.meta.url), 'utf8');
  expect(createHash('sha256').update(source).digest('hex')).toBe('47ccbf03f20c8236c73ef9c7c82ea6a9c1c6efc0be3440ebe7d8ff15eea992ed');
  const exports: Record<string, any> = {};
  const modules: Record<string, unknown> = {
    'node:path': { join }, 'node:fs': { mkdirSync: () => {} },
    '@kernlang/agon-core': { ensureAgonHome: () => {}, RUNS_DIR: '/fixture', tracker: { record: old.track },
      appendMessage: (_session: unknown, entry: unknown) => old.appendMessage(entry), resolveWorkingDir: () => '/fixture' },
    '@kernlang/agon-forge': { runCouncil: async () => value },
    '../blocks/output-format.js': { ENGINE_COLORS: { alpha: 124, beta: 124 } },
    '../models/session-results.js': { sessionResultStore: { add: old.addResult } },
    '../telemetry/index.js': { recordRun: old.recordRun, formatRunSummary: () => 'saved summary' },
    './engine-filter.js': { filterDefaultOrchestrationEngines: (ids: string[]) => ids },
  };
  class FixedDate extends Date { constructor() { super(1000); } static now() { return 1000; } }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: (id: string) => { if (!(id in modules)) throw new Error(`Unexpected import ${id}`); return modules[id]; },
    AbortController, Date: FixedDate, setInterval: () => 1, clearInterval: () => {}, process: { env: {} },
  });
  await exports.handleCouncil('Q', (event: unknown) => legacy.push(['event', event]), {
    activeEngines: () => ['alpha', 'beta'], registry: {}, adapter: {}, config: {}, chatSession: {}, setActiveAbort: () => {},
  });
  const fresh = record(current);
  await runCouncilSession({ question: 'Q' }, { cwd: '/fixture', signal: new AbortController().signal }, {
    ...host(), ...fresh,
    dispatch: event => current.push(['event', event.type === 'engine-block' ? { ...event, color: 124 } : event]),
    recordRun: entry => { fresh.recordRun(entry); current.push(['event', { type: 'info', message: 'saved summary' }]); },
  }, async () => ({ exitCode: 0, result: value }));
  expect(current).toEqual(legacy);
});
function host() {
  return { assertCurrent: vi.fn(), now: () => 1000, defaultEngines: () => ['alpha', 'beta'],
    resolveChairman: (id: string) => id, dispatch: vi.fn(), scheduleEvery: vi.fn(() => vi.fn()),
    appendMessage: vi.fn(), track: vi.fn(), addResult: vi.fn(), recordRun: vi.fn() };
}
it('preserves a completed verdict after receipt failure without success telemetry', async () => {
  const effects = host();
  await expect(runCouncilSession({ question: 'Q' }, { cwd: '/fixture', signal: new AbortController().signal }, effects,
    async () => ({ exitCode: 1, result, failure: { code: 'COUNCIL_RECEIPT_FAILED', message: 'Inspect saved run.' } })))
    .rejects.toThrow('Inspect saved run.');
  expect(effects.appendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ content: '[council:verdict] Conclusion' }));
  expect(effects.addResult).toHaveBeenCalledOnce();
  expect(effects.dispatch).toHaveBeenCalledWith({ type: 'warning', message: 'Inspect saved run.' });
  expect(effects.recordRun).not.toHaveBeenCalled();
});
it('preserves acting-chair history, result storage and zero confidence', async () => {
  const effects = host();
  await runCouncilSession({ question: 'Q' }, { cwd: '/fixture', signal: new AbortController().signal }, effects,
    async () => ({ exitCode: 0, result }));
  expect(effects.appendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ engineId: 'beta', content: '[council:verdict] Conclusion' }));
  expect(effects.addResult).toHaveBeenCalledWith(expect.objectContaining({ winner: 'beta', data: expect.objectContaining({ chairmanId: 'alpha', confidence: 0 }) }));
  expect(effects.recordRun).toHaveBeenCalledWith(expect.objectContaining({ success: true, winner: 'beta' }));
  expect(effects.scheduleEvery.mock.results[0].value).toHaveBeenCalledOnce();
});
it.each(['cancel', 'generation'])('rejects late session effects after %s', async fault => {
  const effects = host();
  const controller = new AbortController();
  await expect(runCouncilSession({ question: 'Q' }, { cwd: '/fixture', signal: controller.signal }, effects, async () => {
    if (fault === 'cancel') controller.abort(new Error('cancelled'));
    else effects.assertCurrent.mockImplementation(() => { throw new Error('stale generation'); });
    return { exitCode: 0, result };
  })).rejects.toThrow(fault === 'cancel' ? 'cancelled' : 'stale generation');
  expect(effects.appendMessage).not.toHaveBeenCalled();
  expect(effects.recordRun).not.toHaveBeenCalled();
  expect(effects.scheduleEvery.mock.results[0].value).toHaveBeenCalledOnce();
});
it('does not record success after result storage fails', async () => {
  const effects = host();
  effects.addResult.mockImplementation(() => { throw new Error('disk full'); });
  await expect(runCouncilSession({ question: 'Q' }, { cwd: '/fixture', signal: new AbortController().signal }, effects,
    async () => ({ exitCode: 0, result }))).rejects.toThrow('disk full');
  expect(effects.recordRun).not.toHaveBeenCalled();
});

it.each([null, {}, { ...result, seats: [null] }, { ...result, warnings: [4] }, { ...result, confidence: 101 }])('rejects invalid session output before history: %j', async invalid => {
  const effects = host();
  await expect(runCouncilSession({ question: 'Q' }, { cwd: '/fixture', signal: new AbortController().signal }, effects,
    async () => ({ exitCode: 0, result: invalid }))).rejects.toThrow('invalid session result');
  expect(effects.appendMessage).not.toHaveBeenCalled();
  expect(effects.addResult).not.toHaveBeenCalled();
});

it('stops progress after cancellation without clearing a newer display', async () => {
  const effects = host();
  const controller = new AbortController();
  let tick = () => {};
  const stop = vi.fn();
  const selected = { ...effects, scheduleEvery: (callback: () => void) => { tick = callback; return stop; } };
  let complete!: (value: { exitCode: number; result: typeof result }) => void;
  const pending = runCouncilSession({ question: 'Q' }, { cwd: '/fixture', signal: controller.signal }, selected,
    () => new Promise(resolve => { complete = resolve; }));
  tick();
  expect(effects.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'progress-update' }));
  controller.abort(new Error('cancelled'));
  effects.dispatch.mockClear();
  tick();
  tick();
  expect(stop).toHaveBeenCalledOnce();
  expect(effects.dispatch).not.toHaveBeenCalled();
  complete({ exitCode: 0, result });
  await expect(pending).rejects.toThrow('cancelled');
  expect(stop).toHaveBeenCalledOnce();
  expect(effects.dispatch).not.toHaveBeenCalled();
});

it('rechecks cancellation between history and tracking', async () => {
  const effects = host();
  const controller = new AbortController();
  effects.appendMessage.mockImplementationOnce(() => controller.abort(new Error('cancelled during history')));
  await expect(runCouncilSession({ question: 'Q' }, { cwd: '/fixture', signal: controller.signal }, effects,
    async () => ({ exitCode: 0, result }))).rejects.toThrow('cancelled during history');
  expect(effects.appendMessage).toHaveBeenCalledOnce();
  expect(effects.track).not.toHaveBeenCalled();
  expect(effects.addResult).not.toHaveBeenCalled();
});
