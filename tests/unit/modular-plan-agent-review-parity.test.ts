import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tracker } from '@kernlang/agon-core';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';
import type { CesarPlanStep } from '../../packages/mod-plan/src/execution-model.js';

const effects = vi.hoisted(() => ({ target: vi.fn(), select: vi.fn(), review: vi.fn(), agent: vi.fn(), team: vi.fn() }));
vi.mock('../../packages/cli/src/handlers/review.js', async original => ({ ...await original<Record<string, unknown>>(),
  resolveReviewTarget: effects.target, selectReviewEngine: effects.select, runReviewCore: effects.review,
}));
vi.mock('../../packages/cli/src/handlers/agent.js', async original => ({ ...await original<Record<string, unknown>>(),
  runAgentMode: effects.agent, runAgentTeam: effects.team,
}));
import { buildLegacyAgentReviewStepExecutors } from '../fixtures/modular-plan-agent-review-legacy.js';
import { buildStepExecutors } from '../../packages/cli/src/handlers/plan-mode.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agon-agent-review-parity-'));
  vi.stubEnv('AGON_HOME', home);
  vi.spyOn(Date, 'now').mockReturnValue(123456789);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); });
const cases = (['review', 'agent', 'team-agent'] as const).flatMap(kind =>
  ['success', 'empty', 'blocked', 'parse-failed', 'target-throws', 'select-throws', 'error', 'string-error', 'aborted', 'no-signal', 'no-engine',
    'failed', 'cancelled', 'budget_exceeded', 'no-winner', 'missing', 'during-abort'].map(scenario => ({ kind, scenario })));

it('keeps the three algorithms out of the CLI and legacy packages out of their owner', () => {
  const source = readFileSync(new URL('../../packages/cli/src/handlers/plan-mode.ts', import.meta.url), 'utf8');
  expect(source).toContain('createAgentReviewStepExecutors({');
  expect(source).not.toMatch(/(?:review|agent|'team-agent'):\s*wrap\([^\n]*async/);
  const physical = readFileSync(new URL('../../packages/mod-plan/src/agent-review-step-execution.ts', import.meta.url), 'utf8');
  expect(physical).not.toMatch(/from ['"](?:@kernlang\/agon-(?:core|cli|forge)|\.\.\/)/);
});

it.each(cases)('matches legacy $kind/$scenario without result normalization', async ({ kind, scenario }) => {
  const results = [];
  const ctx = { config: {}, adapter: {}, setActiveAbort: vi.fn(), lastReviewResult: { preserved: true }, chatSession: { messages: [] } } as unknown as HandlerContext;
  const step: CesarPlanStep = { id: 'step', type: kind, description: 'task', imports: ['source', 'empty', 'absent'],
    ...(scenario !== 'no-engine' ? { engine: 'chosen', engines: ['one', 'two'] } : {}),
    fitnessCmd: 'fixture-test', estimatedTokens: 10, estimatedCostUsd: 0.25 };
  for (const build of [buildLegacyAgentReviewStepExecutors, buildStepExecutors]) {
    const controller = new AbortController();
    if (scenario === 'aborted') controller.abort(new Error('cancelled'));
    const signal = scenario === 'no-signal' ? undefined : controller.signal;
    vi.spyOn(tracker, 'getStats').mockReturnValueOnce({ totalTokens: 10, meteredCostUsd: 1, totalCostUsd: 90 } as ReturnType<typeof tracker.getStats>)
      .mockReturnValue({ totalTokens: 30, meteredCostUsd: 1.5, totalCostUsd: 150 } as ReturnType<typeof tracker.getStats>);
    for (const effect of Object.values(effects)) effect.mockReset();
    effects.target.mockImplementation(() => {
      if (scenario === 'target-throws') throw new Error('target failed');
      return { diff: scenario === 'empty' ? ' \n ' : 'patch', label: 'changes' };
    });
    effects.select.mockImplementation(() => {
      if (scenario === 'select-throws') throw new Error('selection failed');
      return 'selected';
    });
    effects.review.mockImplementation(async () => {
      if (scenario === 'error' || scenario === 'string-error') throw scenario === 'error' ? new Error('backend failed') : 'backend failed';
      if (scenario === 'during-abort') controller.abort(new Error('cancelled'));
      return { response: 'r'.repeat(2200), blocking: scenario === 'blocked', parseFailed: scenario === 'parse-failed' };
    });
    const calls: Array<{ name: string; task: unknown; boundContext: unknown; options: Record<string, unknown> }> = [];
    const boundaries: Array<{ boundContext: unknown; parentSignal: unknown; refusal: unknown; initialRefusal?: unknown }> = [];
    for (const [name, backend] of [['agent', effects.agent], ['team', effects.team]] as const) {
      backend.mockImplementation(async (task, emit, boundContext, options) => {
        const { executionRefusal, parentSignal: _signal, ...payload } = options;
        const boundary = { boundContext, parentSignal: _signal, refusal: executionRefusal, initialRefusal: undefined as unknown };
        boundaries.push(boundary);
        try { boundary.initialRefusal = executionRefusal(); }
        catch (error) { boundary.initialRefusal = error; }
        calls.push({ name, task, boundContext, options: payload });
        if (scenario !== 'empty') {
          emit(null); emit('ignored'); emit({ message: 5 });
          for (let i = 0; i < 25; i++) emit({ message: `${i}:${'x'.repeat(150)}`, content: 'not selected' });
          emit({ content: 'last content' });
        }
        if (scenario === 'error' || scenario === 'string-error') throw scenario === 'error' ? new Error('backend failed') : 'backend failed';
        if (scenario === 'during-abort') controller.abort(new Error('cancelled'));
        return scenario === 'missing' ? null : {
          status: ['failed', 'cancelled', 'budget_exceeded', 'no-winner'].includes(scenario) ? scenario : 'completed',
          summary: `backend ${scenario}`,
        };
      });
    }
    let outcome: unknown;
    try { outcome = await build(ctx)[kind].execute(step, { source: 'facts', empty: '', __plan_intent: 'intent'.repeat(100) }, signal); }
    catch (error) { outcome = { thrown: error instanceof Error ? error.message : String(error) }; }
    for (const boundary of boundaries) {
      expect(boundary.boundContext).toBe(ctx);
      expect(boundary.parentSignal).toBe(signal);
      expect(boundary.refusal).toEqual(expect.any(Function));
      expect(boundary.initialRefusal).toBeUndefined();
      const refusal = (boundary.refusal as () => string | undefined)();
      expect(refusal).toBe(signal?.aborted ? 'cancelled' : undefined);
    }
    if (scenario === 'aborted') {
      expect(outcome).toEqual({ thrown: 'cancelled' });
    } else {
      const fails = ['error', 'string-error', 'during-abort'].includes(scenario)
        || (kind === 'review'
          ? ['empty', 'blocked', 'parse-failed', 'target-throws', 'select-throws'].includes(scenario)
          : ['failed', 'cancelled', 'budget_exceeded', 'no-winner', 'missing'].includes(scenario));
      expect(outcome).toMatchObject({ result: { status: fails ? 'failure' : 'success' } });
    }
    const review = effects.review.mock.calls.map(call => {
      expect(call[3]).toBe(ctx);
      expect(call[4]).toBe(signal);
      return call.slice(0, 4);
    });
    results.push({ outcome, calls, target: effects.target.mock.calls.slice(), select: effects.select.mock.calls.slice(), review });
  }
  // Callback and signal identities are checked at their host boundaries.
  // All serializable calls and results remain unchanged.
  expect(results[1]).toEqual(results[0]);
  expect(ctx.setActiveAbort).not.toHaveBeenCalled();
});
