import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { engineHealth } from '@kernlang/agon-support-engine-runtime';
import type { EngineAdapter, EngineDefinition } from '@kernlang/agon-support-engine-runtime';
import { preflightHealthFilter } from '@kernlang/agon-support-panel';
const captured = vi.hoisted(() => ({ logs: [] as unknown[] }));
vi.mock('@kernlang/agon-kernel', async original => ({
  ...await original<object>(), createSidechainLogger: () => ({ log: (...args: unknown[]) => captured.logs.push(args) }),
}));
import { runCouncilRuntime } from './runtime.js';

const source = readFileSync(new URL('../../../tests/fixtures/modular-council-runtime-legacy.txt', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

it.each(['cancel', 'generation'])('rejects late Council effects after %s', async fault => {
  const controller = new AbortController();
  let current = true;
  let finish!: (value: { engineId: string; exitCode: number; stdout: string; stderr: string; timedOut: boolean; durationMs: number }) => void;
  let started!: () => void;
  const dispatched = new Promise<void>(resolve => { started = resolve; });
  const dispatch = vi.fn(() => { started(); return new Promise<Parameters<typeof finish>[0]>(resolve => { finish = resolve; }); });
  const recordRatings = vi.fn();
  const onEvent = vi.fn();
  const pending = runCouncilRuntime({ question: 'Cancel?', engines: ['alpha', 'beta', 'gamma'],
    registry: { get: id => ({ id }) as EngineDefinition, findBinary: () => '/fixture/node' },
    adapter: { dispatch } as unknown as EngineAdapter, timeout: 17, outputDir: '/fixture/council', cwd: '/fixture',
    signal: controller.signal, onEvent,
  }, {
    assertCurrent: () => { if (!current) throw new Error('generation replaced'); },
    loadConfig: () => ({}), readSeating: () => ({ pick: ids => ({ engineId: ids[0], reason: 'random' }), rank: ids => ids }),
    recordRatings, warn: vi.fn(),
  });
  await dispatched;
  if (fault === 'cancel') controller.abort(new Error('operator cancelled'));
  else current = false;
  captured.logs = [];
  onEvent.mockClear();
  const rejected = expect(pending).rejects.toThrow(fault === 'cancel' ? 'operator cancelled' : 'generation replaced');
  finish({ engineId: 'alpha', exitCode: 0, stdout: 'Late brief', stderr: '', timedOut: false, durationMs: 1 });
  await rejected;
  expect(dispatch).toHaveBeenCalledOnce();
  expect(onEvent).not.toHaveBeenCalled();
  expect(recordRatings).not.toHaveBeenCalled();
  expect(captured.logs).toEqual([]);
});

it.each(['normal', 'two', 'external-chair', 'forced', 'thin', 'floor', 'chair-failure', 'all-failed',
  'advisor-failure', 'brief-failure', 'retry', 'short-timeout', 'custom-roles', 'quarantine', 'chair-quarantine',
  'confidence-fallback'])('preserves frozen Council requests, results and effects: %s', async scenario => {
  const registry = { get: (id: string) => ({ id }) as EngineDefinition, findBinary: () => '/fixture/node' };
  if (scenario === 'quarantine') engineHealth.mark('beta', 'unreachable', 'fixture quarantine');
  if (scenario === 'chair-quarantine') engineHealth.mark('gamma', 'auth-failed', 'fixture quarantine');
  const make = () => {
    const effects: unknown[] = [];
    const requests: unknown[] = [];
    const events: unknown[] = [];
    const warnings: string[] = [];
    const attempts = new Map<string, number>();
    const adapter = { dispatch: async (request: Parameters<EngineAdapter['dispatch']>[0]) => {
      const { signal: _signal, ...record } = request;
      requests.push(record);
      const brief = request.prompt.includes('Before the council debates');
      const verdict = request.prompt.includes('Synthesize the advisors');
      const key = request.engine.id + request.prompt;
      const count = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, count);
      const failed = scenario === 'all-failed'
        || (scenario === 'chair-failure' && request.engine.id === 'gamma')
        || (scenario === 'advisor-failure' && request.engine.id === 'beta')
        || (scenario === 'brief-failure' && brief && request.engine.id === 'gamma')
        || (['retry', 'short-timeout'].includes(scenario) && count === 1);
      return { engineId: request.engine.id, exitCode: failed ? 2 : 0, timedOut: false, durationMs: 1,
        stderr: failed ? 'fixture failure' : '', stdout: failed ? '' : brief ? 'Decision brief'
          : verdict ? scenario === 'confidence-fallback' ? 'Proceed at 62%' : 'Confidence: 73%\nProceed'
          : `${request.engine.id} ${request.prompt.includes('Critique ONE peer') ? 'critique' : 'position'}` };
    } } as EngineAdapter;
    const pick = (ids: string[], modes: string[]) => ({ engineId: ids.includes(modes[0] === 'critique' ? 'beta' : 'gamma')
      ? modes[0] === 'critique' ? 'beta' : 'gamma' : ids[0], reason: 'top-rated' });
    const rank = (ids: string[]) => [...ids].sort();
    const core = {
      seedNewEnginesFromRegistry: () => effects.push(['seed']), getRatings: () => { effects.push(['ratings']); return {}; },
      pickTopRatedEngine: (ids: string[], _ratings: unknown, options: { modes: string[] }) => pick(ids, options.modes),
      rankEnginesByRating: (ids: string[]) => rank(ids), resolveWorkingDir: () => '/fixture',
      loadConfig: () => ({ cesarEngine: scenario === 'external-chair' ? 'external' : undefined }),
      createSidechainLogger: () => ({ log: (...args: unknown[]) => captured.logs.push(args) }),
      classifyTask: (question: string) => { effects.push(['classify', question]); return 'fixture-class'; },
      updateGlickoRanked: (...args: unknown[]) => effects.push(['ratings-update', ...args]), engineHealth,
    };
    const options = { question: 'Ship?', engines: scenario === 'floor' ? ['alpha'] : ['two', 'external-chair', 'thin'].includes(scenario) ? ['alpha', 'beta'] : ['alpha', 'beta', 'gamma'],
      chairman: ['forced', 'thin'].includes(scenario) ? 'alpha' : scenario === 'chair-quarantine' ? 'gamma' : undefined,
      roles: scenario === 'custom-roles' ? ['Custom'] : undefined, registry, adapter,
      timeout: scenario === 'short-timeout' ? 17 : 120, outputDir: '/fixture/council', cwd: '/fixture',
      onEvent: (event: unknown) => events.push(event) };
    return { core, pick, rank, options, effects, requests, events, warnings };
  };
  try {
    const before = make();
    const exports: Record<string, any> = {};
    const modules: Record<string, unknown> = { 'node:crypto': { randomUUID: () => 'fixture-id' },
      '@kernlang/agon-core': before.core, './health-check.js': { preflightHealthFilter } };
    runInNewContext(compiled, { exports, require: (id: string) => { if (!(id in modules)) throw new Error(`Unexpected import ${id}`); return modules[id]; },
      console: { warn: (message: string) => before.warnings.push(message) } });
    captured.logs = [];
    const expected = await exports.runCouncil(before.options);
    const expectedLogs = captured.logs;
    captured.logs = [];
    const after = make();
    const actual = await runCouncilRuntime(after.options, {
      loadConfig: after.core.loadConfig,
      readSeating: () => { after.core.seedNewEnginesFromRegistry(); after.core.getRatings(); return { pick: after.pick, rank: after.rank }; },
      recordRatings: (question, ranked) => {
        const taskClass = after.core.classifyTask(question);
        after.core.updateGlickoRanked(ranked, taskClass, 'tribunal');
        after.core.updateGlickoRanked(ranked, taskClass, 'critique');
      }, warn: message => after.warnings.push(message),
    });
    expect(actual).toEqual(expected);
    expect(after.requests).toEqual(before.requests);
    expect(after.events).toEqual(before.events);
    expect(after.effects).toEqual(before.effects);
    expect(after.warnings).toEqual(before.warnings);
    expect(captured.logs).toEqual(expectedLogs);
  } finally { engineHealth.clear('beta'); engineHealth.clear('gamma'); }
});
