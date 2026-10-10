import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tracker } from '@kernlang/agon-core';
import type { Dispatch, HandlerContext } from '../../packages/cli/src/handlers/types.js';
import type { CesarPlanStep } from '../../packages/mod-plan/src/execution-model.js';

const effects = vi.hoisted(() => ({ brain: vi.fn(), verify: vi.fn(), delegate: vi.fn() }));
vi.mock('@kernlang/agon-core', async original => ({ ...await original<Record<string, unknown>>(),
  resolveWorkingDir: () => '/fixture', spawnWithTimeout: effects.verify,
}));
vi.mock('@kernlang/agon-forge', async original => ({ ...await original<Record<string, unknown>>(), runDelegate: effects.delegate }));
vi.mock('../../packages/cli/src/cesar/brain.js', () => ({ handleCesarBrain: effects.brain }));
import { buildLegacySelfStepExecutor } from '../fixtures/modular-plan-self-step-legacy.js';
import { buildStepExecutors } from '../../packages/cli/src/handlers/plan-mode.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agon-self-parity-'));
  vi.stubEnv('AGON_HOME', home);
  vi.spyOn(Date, 'now').mockReturnValue(123456789);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); });
const scenarios = ['success', 'empty', 'retry-success', 'retry-paused', 'retry-empty', 'pre-abort', 'during-abort',
  'reported-abort', 'error', 'string-error', 'verify-fails', 'verify-timeout', 'verify-throws', 'verify-passes'] as const;
const cases = (['live', 'plan', 'last', 'none'] as const).flatMap(mode => scenarios.map(scenario => ({ mode, scenario })));

it('removes the Self algorithm from the CLI without legacy imports in its owner', () => {
  const cli = readFileSync(new URL('../../packages/cli/src/handlers/plan-mode.ts', import.meta.url), 'utf8');
  expect(cli).toContain('createSelfStepExecutor<');
  expect(cli).not.toContain('[APPROVED PLAN STEP]');
  const owner = readFileSync(new URL('../../packages/mod-plan/src/self-step-execution.ts', import.meta.url), 'utf8');
  expect(owner).not.toMatch(/from ['"](?:@kernlang\/agon-(?:core|cli|forge)|\.\.\/)/);
});

it.each(cases)('preserves raw Self results and UI events: $mode/$scenario', async ({ mode, scenario }) => {
  const observations = [];
  for (const build of [buildLegacySelfStepExecutor, buildStepExecutors]) {
    const controller = new AbortController();
    if (scenario === 'pre-abort') controller.abort(new Error('cancelled'));
    const signal = controller.signal;
    const events: unknown[] = [];
    const select = (source: string): Dispatch => event => { events.push({ source, event }); };
    const ctx = { registry: {}, adapter: {}, cesar: {
      ...(mode === 'live' || mode === 'plan' ? { planDispatch: select('plan') } : {}),
      ...(mode !== 'none' ? { lastDispatch: select('last') } : {}),
    } } as unknown as HandlerContext;
    const live = mode === 'live' ? select('live') : undefined;
    vi.spyOn(tracker, 'getStats').mockReturnValueOnce({ totalTokens: 10, meteredCostUsd: 1, totalCostUsd: 90 } as ReturnType<typeof tracker.getStats>)
      .mockReturnValue({ totalTokens: 30, meteredCostUsd: 1.5, totalCostUsd: 150 } as ReturnType<typeof tracker.getStats>);
    for (const effect of Object.values(effects)) effect.mockReset();
    const calls: unknown[] = [];
    let turns = 0;
    effects.brain.mockImplementation(async (prompt, emit, boundContext, images, parentSignal, assertOwnerAvailable) => {
      turns++;
      expect(boundContext).toBe(ctx);
      if (build === buildStepExecutors) {
        expect(parentSignal).toBe(signal);
        expect(assertOwnerAvailable).toEqual(expect.any(Function));
        expect(() => assertOwnerAvailable()).not.toThrow();
      }
      calls.push({ prompt, images });
      if (scenario !== 'empty' && !(scenario === 'retry-empty' && turns === 2)) {
        emit({ type: 'engine-block', content: `turn-${turns}` });
        emit({ type: 'streaming-chunk', chunk: 'x'.repeat(600) });
        emit({ type: 'tool-call', tool: 'Read', status: 'done' });
        emit({ type: 'tool-call', tool: 'Write', status: 'error' });
        emit({ type: 'tool-call', tool: 'Bash', status: 'running' });
      }
      if (scenario === 'error' || scenario === 'string-error') throw scenario === 'error' ? new Error('brain failed') : 'brain failed';
      if (scenario === 'during-abort') controller.abort(new Error('cancelled'));
      return { awaitingUserInput: scenario === 'retry-paused' || scenario === 'retry-empty' || (scenario === 'retry-success' && turns === 1) || scenario === 'during-abort',
        decisionReason: scenario === 'reported-abort' ? 'aborted' : 'completed' };
    });
    effects.delegate.mockImplementation(async () => {
      if (scenario === 'error' || scenario === 'string-error') throw scenario === 'error' ? new Error('delegate failed') : 'delegate failed';
      return { response: scenario === 'empty' ? '' : 'd'.repeat(650) };
    });
    effects.verify.mockImplementation(async () => {
      if (scenario === 'verify-throws') throw new Error('verification failed');
      return { exitCode: scenario === 'verify-fails' ? 3 : 0, timedOut: scenario === 'verify-timeout', stdout: 'stdout', stderr: 'stderr' };
    });
    const step: CesarPlanStep = { id: 'step', type: 'self', description: 'task', imports: ['facts', 'missing'],
      engines: ['selected'], ...(scenario.startsWith('verify-') ? { verifyCmd: 'fixture-command' } : {}), estimatedTokens: 0, estimatedCostUsd: 0 };
    let outcome: unknown;
    try { outcome = await build(ctx, live).self.execute(step, { facts: 'context' }, signal); }
    catch (error) { outcome = { thrown: error instanceof Error ? error.message : String(error) }; }
    // Signals and contexts are deliberately distinct per run. Their identities are
    // checked at the backend boundary; raw serializable payloads need no normalizer.
    for (const [options] of effects.delegate.mock.calls) {
      expect(options.signal).toBe(signal); expect(options.registry).toBe(ctx.registry); expect(options.adapter).toBe(ctx.adapter);
    }
    for (const [options] of effects.verify.mock.calls) expect(options.signal).toBe(signal);
    const delegate = effects.delegate.mock.calls.map(([options]) => {
      const { signal: _signal, registry: _registry, adapter: _adapter, ...payload } = options;
      return payload;
    });
    const verify = effects.verify.mock.calls.map(([options]) => {
      const { signal: _signal, ...payload } = options;
      return payload;
    });
    observations.push({ outcome, events, turns, calls, delegate, verify });
    for (const event of events as { source: string }[]) expect(event.source).toBe(mode);
  }
  const [legacy, current] = observations;
  const preservesPreviouslyLostReceipt = scenario === 'verify-throws'
    || (mode !== 'none' && (scenario === 'error' || scenario === 'string-error'));
  if (preservesPreviouslyLostReceipt) {
    // The verified defect dropped completed work on exceptions. Assert that
    // exact correction while retaining every other raw field and event.
    const legacyOutcome = legacy.outcome as { result: { status: string; output: string } };
    expect(legacyOutcome.result).toMatchObject({ status: 'failure', output: '' });
    const output = mode === 'none' ? 'd'.repeat(650)
      : `turn-1\n${'x'.repeat(600)}\n[tool:Read:done]\n[tool:Write:failed]`;
    expect(current).toEqual({ ...legacy, outcome: { ...legacyOutcome, result: { ...legacyOutcome.result, output } } });
  } else {
    expect(current).toEqual(legacy);
  }
});
