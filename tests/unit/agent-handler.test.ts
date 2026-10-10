import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentStepResult } from '../../packages/core/src/cesar/agent-session.js';

// Mock @kernlang/agon-core so the handler's AgentSession is a stub we control.
// This isolates the test to handler composition logic — Phase 1's AgentSession
// internals have their own tests in agent-session.test.ts.
//
// __nextResult controls what session.step() returns on the next call.
// __stepError controls whether session.step() throws instead.
const mockState = {
  nextResult: null as AgentStepResult | null,
  stepError: null as Error | null,
  lastStep: null as { prompt: string; opts: { onEvent?: (e: unknown) => void } } | null,
  lastAuthority: undefined as (() => string | undefined) | undefined,
  boundary: '',
  refused: false,
  continuity: [] as string[],
};

vi.mock('@kernlang/agon-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kernlang/agon-core')>();

  class MockAgentSession {
    private _state: 'idle'|'running'|'completed'|'cancelled'|'failed' = 'idle';
    constructor(public config: { budget: { maxTurns: number; maxDurationMs: number; maxTokens?: number }; executionRefusal?: () => string | undefined }) {
      mockState.lastAuthority = config.executionRefusal;
    }

    async step(prompt: string, opts?: { onEvent?: (e: unknown) => void }): Promise<AgentStepResult> {
      mockState.lastStep = { prompt, opts: opts ?? {} };
      if (mockState.boundary === 'step') mockState.refused = true;
      if (mockState.stepError) throw mockState.stepError;
      return mockState.nextResult ?? {
        response: 'default reply',
        toolCalls: 0,
        innerSteps: 1,
        tokensUsed: 10,
        costUsd: 0,
        stopReason: 'completed',
      };
    }

    cancel(): void { this._state = 'cancelled'; }
    complete(): void {
      if (this._state === 'cancelled' || this._state === 'failed') return;
      this._state = 'completed';
    }
    getStats() {
      return {
        turnsUsed: 1,
        turnsRemaining: this.config.budget.maxTurns - 1,
        tokensUsed: (mockState.nextResult?.tokensUsed) ?? 10,
        tokensRemaining: this.config.budget.maxTokens != null ? this.config.budget.maxTokens - 10 : null,
        totalToolCalls: (mockState.nextResult?.toolCalls) ?? 0,
        totalCostUsd: 0,
        elapsedMs: 100,
        durationRemainingMs: this.config.budget.maxDurationMs - 100,
        state: this._state,
      };
    }
    getSignal(): AbortSignal { return new AbortController().signal; }
  }

  return {
    ...actual,
    AgentSession: MockAgentSession,
    resolveWorkingDir: () => '/tmp/test-cwd',
    loadOrCreateActiveThread: () => {
      mockState.continuity.push('load');
      return {
        append: () => { mockState.continuity.push('append'); },
        save: async () => {
          mockState.continuity.push('save');
          if (mockState.boundary === 'save') mockState.refused = true;
        },
      };
    },
  };
});

import { runAgentMode, runAgentTeam } from '../../packages/cli/src/handlers/agent.js';
import type { OutputEvent } from '../../packages/cli/src/models/handler-types.js';

function makeCtx(engineIds: string[] = ['test-engine'], engineHasApi = true) {
  const events: OutputEvent[] = [];
  const ctx = {
    registry: {
      get: (id: string) => ({
        id,
        api: engineHasApi ? { provider: 'anthropic', model: 'claude-sonnet-4-6' } : undefined,
      }),
    },
    adapter: {},
    activeEngines: () => engineIds,
    config: {},
    chatSession: { messages: [] },
    currentPlan: null,
    setCurrentPlan: () => {},
    setActiveAbort: vi.fn(),
    askQuestion: async () => '',
    cesarSession: null,
    setCesarSession: () => {},
    explorationMode: false,
    setExplorationMode: () => {},
    neroMode: false,
    setNeroMode: () => {},
    cesarMemory: {},
  } as never;
  return { ctx, events, dispatch: (e: OutputEvent) => { events.push(e); } };
}

function eventsByType(events: OutputEvent[], type: string): OutputEvent[] {
  return events.filter((e) => e.type === type);
}

beforeEach(() => {
  mockState.nextResult = null;
  mockState.stepError = null;
  mockState.lastStep = null;
  mockState.lastAuthority = undefined;
  mockState.boundary = '';
  mockState.refused = false;
  mockState.continuity = [];
});

it('passes live execution authority to the session without snapshotting it', async () => {
  const { ctx, dispatch } = makeCtx();
  let refused = false;
  const executionRefusal = () => refused ? 'Owner disabled' : undefined;
  await runAgentMode('fixture task', dispatch, ctx, { executionRefusal });
  expect(mockState.lastAuthority).toBe(executionRefusal);
  expect(mockState.lastAuthority?.()).toBeUndefined();
  refused = true;
  expect(mockState.lastAuthority?.()).toBe('Owner disabled');
});

it.each(['one engine', 'short task'])('preserves authority through team fallback: %s', async reason => {
  const { ctx, dispatch } = makeCtx(reason === 'one engine' ? ['one'] : ['one', 'two']);
  const executionRefusal = () => undefined;
  await runAgentTeam(reason === 'short task' ? 'short' : 'A long fixture task that needs multiple agent members.',
    dispatch, ctx, { executionRefusal });
  expect(mockState.lastAuthority).toBe(executionRefusal);
});

it.each(['entry', 'step', 'save', 'healthy'])('guards solo continuity and publication at %s', async boundary => {
  mockState.boundary = boundary;
  mockState.refused = boundary === 'entry';
  const { ctx, events, dispatch } = makeCtx();
  (ctx as any).config = { sessionContinuity: true };
  const result = await runAgentMode('fixture task', dispatch, ctx, {
    executionRefusal: () => mockState.refused ? 'Owner disabled' : undefined,
  });
  expect(result?.status).toBe(boundary === 'healthy' ? 'completed' : 'failed');
  expect(eventsByType(events, 'success')).toHaveLength(boundary === 'healthy' ? 1 : 0);
  expect(mockState.continuity).toEqual(boundary === 'entry' ? [] : boundary === 'step'
    ? ['load'] : ['load', 'append', 'save']);
  expect(mockState.lastStep === null).toBe(boundary === 'entry');
  for (const type of ['agent-step-start', 'agent-step-end', 'streaming-end']) {
    expect(eventsByType(events, type)).toHaveLength(boundary === 'entry' ? 0 : 1);
  }
});

describe('runAgentMode — happy path', () => {
  it('dispatches step-start, step-end, and turn-summary for a successful invocation', async () => {
    mockState.nextResult = {
      response: 'task complete',
      toolCalls: 3,
      innerSteps: 4,
      tokensUsed: 120,
      costUsd: 0.01,
      stopReason: 'completed',
    };
    const { ctx, events, dispatch } = makeCtx();

    await runAgentMode('refactor the module', dispatch, ctx, { maxTurns: 5 });

    const types = events.map((e) => e.type);
    expect(types).toContain('agent-step-start');
    expect(types).toContain('agent-step-end');
    expect(types).toContain('agent-turn-summary');
    expect(types).toContain('success');
    expect(mockState.lastStep?.prompt).toBe('refactor the module');
  });

  it('agent-step-end carries completed outcome + tool count', async () => {
    mockState.nextResult = {
      response: 'ok',
      toolCalls: 5,
      innerSteps: 2,
      tokensUsed: 80,
      costUsd: 0.01,
      stopReason: 'completed',
    };
    const { ctx, events, dispatch } = makeCtx();

    await runAgentMode('do it', dispatch, ctx);

    const [stepEnd] = eventsByType(events, 'agent-step-end');
    expect(stepEnd).toBeDefined();
    if (stepEnd.type !== 'agent-step-end') throw new Error('wrong type');
    expect(stepEnd.outcome).toBe('completed');
    expect(stepEnd.toolCalls).toBe(5);
    expect(stepEnd.stopReason).toBe('completed');
  });

  it('agent-turn-summary reports the cumulative stats snapshot', async () => {
    mockState.nextResult = {
      response: 'done',
      toolCalls: 2,
      innerSteps: 1,
      tokensUsed: 50,
      costUsd: 0,
      stopReason: 'completed',
    };
    const { ctx, events, dispatch } = makeCtx();

    await runAgentMode('a', dispatch, ctx, { maxTurns: 10 });

    const [summary] = eventsByType(events, 'agent-turn-summary');
    expect(summary).toBeDefined();
    if (summary.type !== 'agent-turn-summary') throw new Error('wrong type');
    expect(summary.turnsUsed).toBe(1);
    expect(summary.turnsRemaining).toBe(9);
    expect(summary.cumulativeToolCalls).toBe(2);
    expect(summary.cumulativeTokens).toBeGreaterThan(0);
  });

  it('emits engine-block with the final response on success', async () => {
    mockState.nextResult = {
      response: 'the answer is 42',
      toolCalls: 0,
      innerSteps: 1,
      tokensUsed: 10,
      costUsd: 0,
      stopReason: 'completed',
    };
    const { ctx, events, dispatch } = makeCtx();

    await runAgentMode('compute', dispatch, ctx);

    const [block] = eventsByType(events, 'engine-block');
    if (!block || block.type !== 'engine-block') throw new Error('no engine-block');
    expect(block.content).toBe('the answer is 42');
  });

  it('passes prompt and onEvent callback through to session.step', async () => {
    mockState.nextResult = {
      response: 'ok', toolCalls: 0, innerSteps: 1, tokensUsed: 10, costUsd: 0, stopReason: 'completed',
    };
    const { ctx, dispatch } = makeCtx();

    await runAgentMode('hello', dispatch, ctx);

    expect(mockState.lastStep?.prompt).toBe('hello');
    expect(typeof mockState.lastStep?.opts?.onEvent).toBe('function');
  });
});

describe('runAgentMode — budget + warnings', () => {
  it('emits agent-budget-warning when turns remaining drops to 1', async () => {
    mockState.nextResult = {
      response: 'done', toolCalls: 0, innerSteps: 1, tokensUsed: 10, costUsd: 0, stopReason: 'completed',
    };
    const { ctx, events, dispatch } = makeCtx();

    await runAgentMode('input', dispatch, ctx, { maxTurns: 2 });

    const warnings = eventsByType(events, 'agent-budget-warning');
    const turnWarn = warnings.find((w) => w.type === 'agent-budget-warning' && w.kind === 'turns');
    expect(turnWarn).toBeDefined();
  });

  it('does not emit turn-budget-warning when turn budget is fresh', async () => {
    mockState.nextResult = {
      response: 'done', toolCalls: 0, innerSteps: 1, tokensUsed: 10, costUsd: 0, stopReason: 'completed',
    };
    const { ctx, events, dispatch } = makeCtx();

    await runAgentMode('input', dispatch, ctx, { maxTurns: 20 });

    const warnings = eventsByType(events, 'agent-budget-warning').filter(
      (w) => w.type === 'agent-budget-warning' && w.kind === 'turns',
    );
    expect(warnings).toHaveLength(0);
  });

  it('fails fast on pre-step budget check when maxTurns=0', async () => {
    const { ctx, events, dispatch } = makeCtx();
    await runAgentMode('do it', dispatch, ctx, { maxTurns: 0 });

    // Pre-step failure: no step-start/step-end; a budget-warning and an error are dispatched.
    expect(eventsByType(events, 'agent-step-start')).toHaveLength(0);
    expect(eventsByType(events, 'agent-step-end')).toHaveLength(0);
    expect(eventsByType(events, 'agent-budget-warning').length).toBeGreaterThan(0);
    expect(eventsByType(events, 'error').length).toBeGreaterThan(0);
    // Session.step() should NOT have been called.
    expect(mockState.lastStep).toBeNull();
  });
});

describe('runAgentMode — failure paths', () => {
  it('rejects engines with no api config', async () => {
    const { ctx, events, dispatch } = makeCtx(['claude'], false);

    await runAgentMode('do it', dispatch, ctx);

    const [err] = eventsByType(events, 'error');
    expect(err).toBeDefined();
    if (err?.type !== 'error') throw new Error('wrong type');
    expect(err.message).toContain('API engine');
    expect(mockState.lastStep).toBeNull();
  });

  // ── Codex P2 #4: picks first API-capable engine in mixed active list ──
  it('skips CLI-only engines and finds the first API-capable one', async () => {
    mockState.nextResult = {
      response: 'done', toolCalls: 0, innerSteps: 1, tokensUsed: 10, costUsd: 0, stopReason: 'completed',
    };
    // Custom ctx with mixed engines: first two are CLI-only, the third has api.
    const events: OutputEvent[] = [];
    const ctx = {
      registry: {
        get: (id: string) => ({
          id,
          api: id === 'opus' ? { provider: 'anthropic', model: 'claude-opus-4-6' } : undefined,
        }),
      },
      adapter: {},
      activeEngines: () => ['codex-cli', 'claude-cli', 'opus'],
      config: {},
      chatSession: { messages: [] },
      currentPlan: null,
      setCurrentPlan: () => {},
      setActiveAbort: vi.fn(),
      askQuestion: async () => '',
      cesarSession: null,
      setCesarSession: () => {},
      explorationMode: false,
      setExplorationMode: () => {},
      neroMode: false,
      setNeroMode: () => {},
      cesarMemory: {},
    } as never;
    const dispatch = (e: OutputEvent) => { events.push(e); };

    await runAgentMode('do it', dispatch, ctx);

    // Should have found opus and dispatched the step successfully — no error event.
    expect(eventsByType(events, 'error')).toHaveLength(0);
    const [stepStart] = eventsByType(events, 'agent-step-start');
    expect(stepStart).toBeDefined();
    if (stepStart?.type !== 'agent-step-start') throw new Error('wrong type');
    expect(stepStart.engineId).toBe('opus');
    expect(mockState.lastStep).not.toBeNull();
  });

  it('emits a clear error when no active engine has API config', async () => {
    const events: OutputEvent[] = [];
    const ctx = {
      registry: { get: (id: string) => ({ id, api: undefined }) },
      adapter: {},
      activeEngines: () => ['cli-only-1', 'cli-only-2'],
      config: {},
      chatSession: { messages: [] },
      currentPlan: null,
      setCurrentPlan: () => {},
      setActiveAbort: vi.fn(),
      askQuestion: async () => '',
      cesarSession: null,
      setCesarSession: () => {},
      explorationMode: false,
      setExplorationMode: () => {},
      neroMode: false,
      setNeroMode: () => {},
      cesarMemory: {},
    } as never;
    const dispatch = (e: OutputEvent) => { events.push(e); };

    await runAgentMode('do it', dispatch, ctx);

    const [err] = eventsByType(events, 'error');
    expect(err?.type).toBe('error');
    if (err?.type === 'error') {
      expect(err.message).toContain('none of the active engines');
      expect(err.message).toContain('cli-only-1');
      expect(err.message).toContain('cli-only-2');
    }
    expect(mockState.lastStep).toBeNull();
  });

  it('rejects when no engines are active', async () => {
    const { ctx, events, dispatch } = makeCtx([], true);

    await runAgentMode('anything', dispatch, ctx);

    const [err] = eventsByType(events, 'error');
    expect(err?.type).toBe('error');
    expect(mockState.lastStep).toBeNull();
  });

  it('rejects unknown engineId', async () => {
    const { ctx, events, dispatch } = makeCtx(['known'], true);

    await runAgentMode('do it', dispatch, ctx, { engineId: 'unknown' });

    const [err] = eventsByType(events, 'error');
    expect(err?.type).toBe('error');
    expect(mockState.lastStep).toBeNull();
  });

  it('surfaces failed outcome when session.step returns stopReason=error', async () => {
    mockState.nextResult = {
      response: '',
      toolCalls: 0,
      innerSteps: 0,
      tokensUsed: 0,
      costUsd: 0,
      stopReason: 'error',
      error: 'network down',
    };
    const { ctx, events, dispatch } = makeCtx();

    await runAgentMode('do it', dispatch, ctx);

    const [stepEnd] = eventsByType(events, 'agent-step-end');
    if (stepEnd?.type !== 'agent-step-end') throw new Error('no step-end');
    expect(stepEnd.outcome).toBe('failed');

    const [err] = eventsByType(events, 'error');
    expect(err?.type).toBe('error');
    if (err?.type === 'error') expect(err.message).toContain('network down');
  });

  it('surfaces cancelled outcome when session.step returns stopReason=cancelled', async () => {
    mockState.nextResult = {
      response: 'partial',
      toolCalls: 1,
      innerSteps: 1,
      tokensUsed: 10,
      costUsd: 0,
      stopReason: 'cancelled',
      error: 'aborted',
    };
    const { ctx, events, dispatch } = makeCtx();

    await runAgentMode('do it', dispatch, ctx);

    const [stepEnd] = eventsByType(events, 'agent-step-end');
    if (stepEnd?.type !== 'agent-step-end') throw new Error('no step-end');
    expect(stepEnd.outcome).toBe('cancelled');

    const warnings = eventsByType(events, 'warning');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('surfaces warning when session.step returns stopReason=budget_exceeded', async () => {
    mockState.nextResult = {
      response: '',
      toolCalls: 0,
      innerSteps: 0,
      tokensUsed: 0,
      costUsd: 0,
      stopReason: 'budget_exceeded',
      error: 'turn budget',
    };
    const { ctx, events, dispatch } = makeCtx();

    await runAgentMode('do it', dispatch, ctx);

    const warnings = eventsByType(events, 'warning');
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('runAgentMode — cleanup', () => {
  it('clears setActiveAbort on exit (finally block runs)', async () => {
    mockState.nextResult = {
      response: 'ok', toolCalls: 0, innerSteps: 1, tokensUsed: 10, costUsd: 0, stopReason: 'completed',
    };
    const { ctx, dispatch } = makeCtx();
    const setActiveAbort = ctx.setActiveAbort as ReturnType<typeof vi.fn>;

    await runAgentMode('do it', dispatch, ctx);

    expect(setActiveAbort).toHaveBeenCalled();
    // Last call should clear to null (finally block).
    const lastCall = setActiveAbort.mock.calls[setActiveAbort.mock.calls.length - 1];
    expect(lastCall[0]).toBeNull();
  });

  it('clears setActiveAbort even on failure path', async () => {
    mockState.stepError = new Error('inner explosion');
    const { ctx, dispatch } = makeCtx();
    const setActiveAbort = ctx.setActiveAbort as ReturnType<typeof vi.fn>;

    await runAgentMode('do it', dispatch, ctx);

    const lastCall = setActiveAbort.mock.calls[setActiveAbort.mock.calls.length - 1];
    expect(lastCall[0]).toBeNull();
  });
});
