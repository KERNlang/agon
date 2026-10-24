import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { runThinkSession } from './session-workflow.js';
import { isThinkStrategy } from './thinking.js';
import type { ThinkResult } from './thinking.js';

it.each([false, true])('matches frozen session displays and stores (summary=%s)', async hasSummary => {
  const result: ThinkResult = { problem: 'Question', strategy: 'tot', engineId: 'alpha', ok: true,
    thoughts: [{ thoughtNumber: 1, totalThoughts: 1, thought: 'Check this.', kind: 'decision', nextThoughtNeeded: false, grounded: false, pruned: true }],
    summary: hasSummary ? 'Conclusion' : '', openQuestions: ['Question?'], refinedSpec: '', protocolValid: true,
    chosenBranch: 'B', adversarialCritique: 'Check assumptions', criticEngineId: 'beta' };
  const fixedTime = 1_000;
  class FixedDate extends Date { constructor() { super(fixedTime); } static now() { return fixedTime; } }
  const legacy: unknown[] = [];
  const current: unknown[] = [];
  const records = (target: unknown[]) => ({
    appendMessage: (...values: unknown[]) => { target.push(['append', ...values]); },
    track: (...values: unknown[]) => { target.push(['track', ...values]); },
    addResult: (value: unknown) => { target.push(['result', value]); },
    recordRun: (value: unknown) => { target.push(['run', value]); return {}; },
  });
  const old = records(legacy);
  const source = readFileSync(new URL('../../../tests/fixtures/modular-think-session-legacy.txt', import.meta.url), 'utf8');
  const exports: Record<string, any> = {};
  const modules: Record<string, unknown> = {
    'node:path': { join }, 'node:fs': { mkdirSync: () => {} },
    '@kernlang/agon-core': { ensureAgonHome: () => {}, RUNS_DIR: '/fixture', tracker: { record: old.track }, appendMessage: (_session: unknown, value: unknown) => old.appendMessage(value), resolveWorkingDir: () => '/fixture' },
    '@kernlang/agon-forge': { isThinkStrategy, runThinkChain: async () => result },
    '../blocks/output-format.js': { ENGINE_COLORS: { alpha: 124 } },
    '../models/session-results.js': { sessionResultStore: { add: old.addResult } },
    '../telemetry/index.js': { recordRun: old.recordRun, formatRunSummary: () => 'saved summary' },
    './engine-filter.js': { filterDefaultOrchestrationEngines: (ids: string[]) => ids },
  };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: (id: string) => { if (!(id in modules)) throw new Error(`Unexpected import ${id}`); return modules[id]; },
    AbortController, Date: FixedDate, setInterval: () => 1, clearInterval: () => {}, process: { env: {} },
  });
  await exports.handleThink('Question', (event: unknown) => legacy.push(['event', event]), {
    activeEngines: () => ['alpha'], registry: {}, adapter: {}, config: {}, chatSession: {}, setActiveAbort: () => {},
  }, { strategy: 'tot' });
  const fresh = records(current);
  await runThinkSession({ input: 'Question', strategy: 'tot' }, { cwd: '/fixture', signal: new AbortController().signal }, {
    assertCurrent: () => {}, now: () => fixedTime, defaultEngine: () => 'alpha',
    dispatch: event => current.push(['event', event.type === 'engine-block' ? { ...event, color: event.color ?? 124 } : event]),
    scheduleEvery: () => () => {}, ...fresh,
    recordRun: value => { fresh.recordRun(value); current.push(['event', { type: 'info', message: 'saved summary' }]); },
  }, async () => ({ exitCode: 0, result }));
  expect(current).toEqual(legacy);
});
