import { describe, expect, it } from 'vitest';
import {
  beginCesarTurn,
  claimTurnPermission,
  createDurableCesarTurnRuntimeHost,
  createCesarTurnRuntimeHost,
  isActiveCesarTurn,
  runTurnPermissionOnce,
  runTurnToolOnce,
  resetStaleCesarTurnState,
  resolveCesarAbortOutcome,
  classifyCesarStreamError,
  releaseCesarTurnHandles,
  transitionCesarTurn,
  fenceStaleCesarTurn,
} from '../../packages/cli/src/generated/cesar/turn-runtime.js';
import { appendControlPlaneEvent } from '../../packages/core/src/generated/sessions/control-plane-ledger.js';
import { resetEventLogState } from '../../packages/core/src/generated/sessions/event-log.js';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

describe('Cesar turn runtime host', () => {
  it('preserves queued user input while clearing a superseded producer', () => {
    const staleState = {
      busy: true,
      busySince: Date.now() - 60_000,
      abortSignal: new AbortController().signal,
      turnId: 'turn-stale',
      queue: { input: 'queued for the stale turn', dispatch: () => {} },
    } as any;

    resetStaleCesarTurnState(staleState);

    expect(staleState).toMatchObject({
      busy: false,
      busySince: null,
      abortSignal: null,
      queue: { input: 'queued for the stale turn' },
    });
    expect(staleState.turnId).toBeUndefined();
  });

  it('keeps timeouts distinct from user interrupts', () => {
    expect(resolveCesarAbortOutcome(true, true)).toEqual({
      terminalState: 'timed_out', responded: true, decisionReason: 'timeout-preserved-partial',
    });
    expect(resolveCesarAbortOutcome(true, false)).toEqual({
      terminalState: 'timed_out', responded: false, decisionReason: 'timeout',
    });
    expect(resolveCesarAbortOutcome(false, true)).toEqual({
      terminalState: 'cancelled', responded: false, decisionReason: 'aborted',
    });
  });

  it('keeps rejected adapter aborts on the cancellation path', () => {
    expect(classifyCesarStreamError(true, false)).toBe('abort');
    expect(classifyCesarStreamError(true, true)).toBe('abort');
    expect(classifyCesarStreamError(false, true)).toBe('partial');
    expect(classifyCesarStreamError(false, false)).toBe('failure');
  });

  it('releases authority and dispatch handles owned by a completed turn', () => {
    const state = {
      taskExecutionLease: { turnId: 'turn-complete' },
      lastDispatch: () => {},
      queue: { input: 'next turn' },
    } as any;

    releaseCesarTurnHandles(state);

    expect(state.taskExecutionLease).toBeUndefined();
    expect(state.lastDispatch).toBeNull();
    expect(state.queue).toEqual({ input: 'next turn' });
  });

  it('drops every volatile field owned by the superseded producer', () => {
    const staleState = {
      busy: true,
      busySince: Date.now() - 60_000,
      abortSignal: new AbortController().signal,
      turnId: 'turn-stale',
      queue: null,
      pendingDelegation: { action: 'Forge', task: 'stale task' },
      lastDispatch: () => {},
      planDispatch: () => {},
      taskExecutionLease: { turnId: 'turn-stale' },
      reportedConfidence: 0.95,
      reportedConfidenceReasoning: 'stale reasoning',
      confidenceSatisfied: true,
      blockedOnConfidence: { name: 'Bash', args: { command: 'npm test' } },
      confidenceBlockCount: 2,
      searchToolCount: 4,
      searchNudged: true,
      quickNeroRequested: true,
      proposedPlan: { id: 'session-plan' },
      advisorPending: true,
      budgetWarned: true,
      autoModeQueued: true,
    } as any;

    resetStaleCesarTurnState(staleState);

    expect(staleState).toMatchObject({
      pendingDelegation: null,
      lastDispatch: null,
      planDispatch: null,
      taskExecutionLease: undefined,
      reportedConfidence: undefined,
      reportedConfidenceReasoning: undefined,
      confidenceSatisfied: false,
      blockedOnConfidence: null,
      confidenceBlockCount: 0,
      searchToolCount: 0,
      searchNudged: false,
      quickNeroRequested: false,
    });
    expect(staleState).toMatchObject({
      proposedPlan: { id: 'session-plan' },
      advisorPending: true,
      budgetWarned: true,
      autoModeQueued: true,
    });
  });

  it('issues monotonic epochs and fences the superseded producer', () => {
    const host = createCesarTurnRuntimeHost('chat-1');
    const first = beginCesarTurn(host, 'turn-1', 'api-session');
    const second = beginCesarTurn(host, 'turn-2', 'api-session');

    expect(first.envelope.leaseEpoch).toBe(1);
    expect(first.state).toBe('superseded');
    expect(second.envelope.leaseEpoch).toBe(2);
    expect(isActiveCesarTurn(host, first.envelope)).toBe(false);
    expect(isActiveCesarTurn(host, second.envelope)).toBe(true);
  });

  it('durably supersedes a cancelling producer before replacing its lease', () => {
    const events: Array<Record<string, unknown>> = [];
    const host = createCesarTurnRuntimeHost('chat-cancelling', 1, (event: Record<string, unknown>) => {
      events.push(event);
      return { ok: true, seq: events.length };
    });
    const first = beginCesarTurn(host, 'turn-1', 'api-session');
    expect(transitionCesarTurn(host, first.envelope, 'cancelling')).toEqual({ ok: true, state: 'cancelling' });

    const second = beginCesarTurn(host, 'turn-2', 'api-session');

    expect(first.state).toBe('superseded');
    expect(first.terminalAccepted).toBe(true);
    expect(host.latestTerminal).toBe(first);
    expect(host.active).toBe(second);
    expect(events).toContainEqual({ type: 'turn_terminal', envelope: first.envelope, state: 'superseded' });
  });

  it('leaves the active producer unchanged when durable supersede fails', () => {
    const host = createCesarTurnRuntimeHost('chat-supersede-failure', 1, (event: Record<string, unknown>) => event.type === 'turn_terminal'
      ? { ok: false, seq: 0, error: 'disk full' }
      : { ok: true, seq: 1 });
    const first = beginCesarTurn(host, 'turn-1', 'api-session');

    expect(() => beginCesarTurn(host, 'turn-2', 'api-session')).toThrow('durable supersede failed');
    expect(first.state).toBe('running');
    expect(first.terminalAccepted).toBe(false);
    expect(host.active).toBe(first);
    expect(host.latestTerminal).toBeNull();
  });

  it('releases a stale active slot that is already terminal', () => {
    const host = createCesarTurnRuntimeHost('chat-terminal-stale');
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');
    runtime.state = 'completed';

    expect(fenceStaleCesarTurn(host)).toBe(true);
    expect(host.active).toBeNull();
    expect(host.latestTerminal).toBe(runtime);
  });

  it('joins duplicate tool owners by toolCallId but runs distinct calls independently', async () => {
    const host = createCesarTurnRuntimeHost('chat-1');
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');
    let executions = 0;
    const execute = async () => {
      executions += 1;
      await Promise.resolve();
      return `result-${executions}`;
    };

    const [sessionResult, harnessResult] = await Promise.all([
      runTurnToolOnce(runtime, 'tc-1', 'session', 'mutation', execute),
      runTurnToolOnce(runtime, 'tc-1', 'harness', 'mutation', execute),
    ]);
    const distinct = await runTurnToolOnce(runtime, 'tc-2', 'session', 'read_only', execute);

    expect(sessionResult).toBe('result-1');
    expect(harnessResult).toBe('result-1');
    expect(distinct).toBe('result-2');
    expect(executions).toBe(2);
  });

  it('deduplicates permission prompts and makes late approvals inert', () => {
    const host = createCesarTurnRuntimeHost('chat-1');
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');

    expect(claimTurnPermission(runtime, 'permission-1')).toBe(true);
    expect(claimTurnPermission(runtime, 'permission-1')).toBe(false);
    expect(transitionCesarTurn(host, runtime.envelope, 'cancelling').ok).toBe(true);
    expect(transitionCesarTurn(host, runtime.envelope, 'cancelled').ok).toBe(true);
    expect(claimTurnPermission(runtime, 'permission-2')).toBe(false);
    expect(isActiveCesarTurn(host, runtime.envelope)).toBe(false);
  });

  it('joins duplicate permission requests to one durable prompt decision', async () => {
    const writes: string[] = [];
    const host = createCesarTurnRuntimeHost('chat-1', 1, (event: Record<string, unknown>) => {
      writes.push(String(event.type));
      return { ok: true, seq: writes.length };
    });
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');
    let prompts = 0;
    const ask = async () => {
      prompts += 1;
      await Promise.resolve();
      return true;
    };

    const [first, duplicate] = await Promise.all([
      runTurnPermissionOnce(runtime, 'permission-1', ask),
      runTurnPermissionOnce(runtime, 'permission-1', ask),
    ]);

    expect(first).toBe(true);
    expect(duplicate).toBe(true);
    expect(prompts).toBe(1);
    expect(writes.filter((type) => type === 'permission_requested')).toHaveLength(1);
    expect(writes.filter((type) => type === 'permission_terminal')).toHaveLength(1);
  });

  it.each(['y', 'a'])('records the approved %s permission response truthfully', async (answer) => {
    const decisions: string[] = [];
    const host = createCesarTurnRuntimeHost('chat-approved-string', 1, (event: Record<string, unknown>) => {
      if (event.type === 'permission_terminal') decisions.push(String(event.decision));
      return { ok: true, seq: decisions.length + 1 };
    });
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');

    await expect(runTurnPermissionOnce(runtime, `permission-${answer}`, async () => answer)).resolves.toBe(answer);
    expect(decisions).toEqual(['approved']);
  });

  it('does not open a permission prompt after the turn becomes terminal', async () => {
    const decisions: string[] = [];
    let runtime: ReturnType<typeof beginCesarTurn>;
    const host = createCesarTurnRuntimeHost('chat-terminal-before-ask', 1, (event: Record<string, unknown>) => {
      if (event.type === 'permission_requested') runtime.state = 'cancelled';
      if (event.type === 'permission_terminal') decisions.push(String(event.decision));
      return { ok: true, seq: decisions.length + 1 };
    });
    runtime = beginCesarTurn(host, 'turn-1', 'api-session');
    let prompts = 0;

    await expect(runTurnPermissionOnce(runtime, 'permission-cancelled', async () => {
      prompts += 1;
      return true;
    })).resolves.toBe(false);
    expect(prompts).toBe(0);
    expect(decisions).toEqual(['denied']);
  });

  it('evicts a rejected permission promise so the same request can retry', async () => {
    const host = createCesarTurnRuntimeHost('chat-permission-retry');
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');
    let attempts = 0;
    const ask = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary prompt failure');
      return true;
    };

    await expect(runTurnPermissionOnce(runtime, 'permission-retry', ask)).rejects.toThrow('temporary prompt failure');
    await expect(runTurnPermissionOnce(runtime, 'permission-retry', ask)).resolves.toBe(true);
    expect(attempts).toBe(2);
  });

  it('fails closed when recording a rejected permission also fails', async () => {
    const host = createCesarTurnRuntimeHost('chat-permission-failure-ledger', 1, (event: Record<string, unknown>) => event.type === 'permission_terminal'
      ? { ok: false, seq: 0, error: 'disk full' }
      : { ok: true, seq: 1 });
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');

    await expect(runTurnPermissionOnce(runtime, 'permission-failure-ledger', async () => {
      throw new Error('prompt crashed');
    })).rejects.toMatchObject({
      message: expect.stringContaining('durable permission terminal failed'),
      errors: [
        expect.objectContaining({ message: 'prompt crashed' }),
        expect.objectContaining({ message: 'durable permission terminal failed: disk full' }),
      ],
    });
  });

  it('accepts exactly one terminal transition', () => {
    const host = createCesarTurnRuntimeHost('chat-1');
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');

    expect(transitionCesarTurn(host, runtime.envelope, 'completed')).toEqual({ ok: true, state: 'completed' });
    expect(transitionCesarTurn(host, runtime.envelope, 'failed')).toEqual({
      ok: false,
      state: 'completed',
      reason: 'terminal_state',
    });
  });

  it('prevents mutation execution when the durable claim cannot be written', async () => {
    const host = createCesarTurnRuntimeHost('chat-1', 1, (event: Record<string, unknown>) => event.type === 'tool_claimed'
      ? { ok: false, seq: 0, error: 'disk full' }
      : { ok: true, seq: 1 });
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');
    let executed = false;

    await expect(runTurnToolOnce(runtime, 'tc-mutation', 'session', 'mutation', async () => {
      executed = true;
      return 'should not run';
    })).rejects.toThrow('durable tool claim failed');
    expect(executed).toBe(false);
  });

  it('does not accept a terminal state when the durable terminal write fails', () => {
    const host = createCesarTurnRuntimeHost('chat-1', 1, (event: Record<string, unknown>) => event.type === 'turn_terminal'
      ? { ok: false, seq: 0, error: 'disk full' }
      : { ok: true, seq: 1 });
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');

    expect(transitionCesarTurn(host, runtime.envelope, 'completed')).toEqual({
      ok: false,
      state: 'running',
      reason: 'terminal_state',
    });
    expect(runtime.state).toBe('running');
    expect(host.latestTerminal).toBeNull();
  });

  it('does not misrecord a successful mutation as failed when its terminal write fails', async () => {
    const writes: string[] = [];
    const host = createCesarTurnRuntimeHost('chat-1', 1, (event: Record<string, unknown>) => {
      writes.push(String(event.type));
      return event.type === 'tool_terminal'
        ? { ok: false, seq: 0, error: 'disk full' }
        : { ok: true, seq: writes.length };
    });
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');
    let executions = 0;

    await expect(runTurnToolOnce(runtime, 'tc-mutation', 'session', 'mutation', async () => {
      executions += 1;
      return 'written';
    })).rejects.toThrow('durable tool terminal failed');

    expect(executions).toBe(1);
    expect(writes.filter((type) => type === 'tool_terminal')).toHaveLength(1);
  });

  it('records a non-throwing failed tool result as failed', async () => {
    const terminals: string[] = [];
    const host = createCesarTurnRuntimeHost('chat-1', 1, (event: Record<string, unknown>) => {
      if (event.type === 'tool_terminal') terminals.push(String(event.terminalReason));
      return { ok: true, seq: terminals.length + 1 };
    });
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');

    const result = await runTurnToolOnce(runtime, 'tc-failed', 'session', 'mutation', async () => ({
      result: { ok: false, error: 'compile failed' },
    }));

    expect(result.result.ok).toBe(false);
    expect(terminals).toEqual(['failed']);
  });

  it('does not misclassify an ordinary transaction abort as user cancellation', async () => {
    const terminals: string[] = [];
    const host = createCesarTurnRuntimeHost('chat-tool-transaction-abort', 1, (event: Record<string, unknown>) => {
      if (event.type === 'tool_terminal') terminals.push(String(event.terminalReason));
      return { ok: true, seq: terminals.length + 1 };
    });
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');

    await runTurnToolOnce(runtime, 'tc-transaction-abort', 'session', 'mutation', async () => ({
      ok: false,
      error: 'database transaction aborted after deadlock',
    }));
    expect(terminals).toEqual(['failed']);
  });

  it.each([
    Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    Object.assign(new Error('terminated by signal SIGTERM'), { code: 'ABORT_ERR' }),
  ])('records an aborted tool rejection as cancelled', async (failure) => {
    const terminals: string[] = [];
    const host = createCesarTurnRuntimeHost('chat-tool-abort', 1, (event: Record<string, unknown>) => {
      if (event.type === 'tool_terminal') terminals.push(String(event.terminalReason));
      return { ok: true, seq: terminals.length + 1 };
    });
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');

    await expect(runTurnToolOnce(runtime, 'tc-abort', 'session', 'read_only', async () => {
      throw failure;
    })).rejects.toBe(failure);
    expect(terminals).toEqual(['cancelled']);
  });

  it('rejects a late tool result after the turn is cancelled', async () => {
    let resolveTool!: (value: string) => void;
    const tool = new Promise<string>((resolve) => { resolveTool = resolve; });
    const terminals: string[] = [];
    const host = createCesarTurnRuntimeHost('chat-1', 1, (event: Record<string, unknown>) => {
      if (event.type === 'tool_terminal') terminals.push(String(event.terminalReason));
      return { ok: true, seq: terminals.length + 1 };
    });
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');
    const pending = runTurnToolOnce(runtime, 'tc-late', 'session', 'read_only', () => tool);

    expect(transitionCesarTurn(host, runtime.envelope, 'cancelling').ok).toBe(true);
    expect(transitionCesarTurn(host, runtime.envelope, 'cancelled').ok).toBe(true);
    resolveTool('too late');

    await expect(pending).rejects.toThrow('terminal during tool execution');
    expect(terminals).toContain('cancelled');
  });

  it('fails closed when a late tool terminal record cannot be persisted', async () => {
    let resolveTool!: (value: string) => void;
    const tool = new Promise<string>((resolve) => { resolveTool = resolve; });
    const host = createCesarTurnRuntimeHost('chat-late-tool-ledger', 1, (event: Record<string, unknown>) => event.type === 'tool_terminal'
      ? { ok: false, seq: 0, error: 'disk full' }
      : { ok: true, seq: 1 });
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');
    const pending = runTurnToolOnce(runtime, 'tc-late-ledger', 'session', 'read_only', () => tool);
    expect(transitionCesarTurn(host, runtime.envelope, 'cancelling').ok).toBe(true);
    expect(transitionCesarTurn(host, runtime.envelope, 'cancelled').ok).toBe(true);
    resolveTool('too late');

    await expect(pending).rejects.toThrow('durable tool terminal failed');
  });

  it('evicts a rejected tool promise so the same tool call can retry', async () => {
    const host = createCesarTurnRuntimeHost('chat-tool-retry');
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');
    let attempts = 0;
    const execute = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary tool failure');
      return 'recovered';
    };

    await expect(runTurnToolOnce(runtime, 'tc-retry', 'session', 'read_only', execute)).rejects.toThrow('temporary tool failure');
    await expect(runTurnToolOnce(runtime, 'tc-retry', 'session', 'read_only', execute)).resolves.toBe('recovered');
    expect(attempts).toBe(2);
  });

  it.each(['mutation', 'external', 'unknown'] as const)('never re-executes a failed %s call with the same id', async (effectClass) => {
    const host = createCesarTurnRuntimeHost(`chat-tool-at-most-once-${effectClass}`);
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');
    let attempts = 0;
    const execute = async () => {
      attempts += 1;
      throw new Error('partial side effect then failure');
    };

    const first = runTurnToolOnce(runtime, 'tc-at-most-once', 'session', effectClass, execute);
    await expect(first).rejects.toThrow('partial side effect then failure');
    const duplicate = runTurnToolOnce(runtime, 'tc-at-most-once', 'harness', effectClass, execute);
    await expect(duplicate).rejects.toThrow('partial side effect then failure');
    expect(attempts).toBe(1);
  });

  it('fails closed when recording a rejected tool execution also fails', async () => {
    const host = createCesarTurnRuntimeHost('chat-tool-failure-ledger', 1, (event: Record<string, unknown>) => event.type === 'tool_terminal'
      ? { ok: false, seq: 0, error: 'disk full' }
      : { ok: true, seq: 1 });
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');

    await expect(runTurnToolOnce(runtime, 'tc-failure-ledger', 'session', 'read_only', async () => {
      throw new Error('tool crashed');
    })).rejects.toMatchObject({
      message: expect.stringContaining('durable tool terminal failed'),
      errors: [
        expect.objectContaining({ message: 'tool crashed' }),
        expect.objectContaining({ message: 'durable tool terminal failed: disk full' }),
      ],
    });
  });

  it('makes a late permission approval inert after cancellation', async () => {
    let resolveApproval!: (value: boolean) => void;
    const approval = new Promise<boolean>((resolve) => { resolveApproval = resolve; });
    const decisions: string[] = [];
    const host = createCesarTurnRuntimeHost('chat-1', 1, (event: Record<string, unknown>) => {
      if (event.type === 'permission_terminal') decisions.push(String(event.decision));
      return { ok: true, seq: decisions.length + 1 };
    });
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');
    const pending = runTurnPermissionOnce(runtime, 'permission-late', () => approval);

    expect(transitionCesarTurn(host, runtime.envelope, 'cancelling').ok).toBe(true);
    expect(transitionCesarTurn(host, runtime.envelope, 'cancelled').ok).toBe(true);
    resolveApproval(true);

    await expect(pending).resolves.toBe(false);
    expect(decisions).toEqual(['denied']);
  });

  it('fails closed when a late permission terminal record cannot be persisted', async () => {
    let resolveApproval!: (value: boolean) => void;
    const approval = new Promise<boolean>((resolve) => { resolveApproval = resolve; });
    const host = createCesarTurnRuntimeHost('chat-late-permission-ledger', 1, (event: Record<string, unknown>) => event.type === 'permission_terminal'
      ? { ok: false, seq: 0, error: 'disk full' }
      : { ok: true, seq: 1 });
    const runtime = beginCesarTurn(host, 'turn-1', 'api-session');
    const pending = runTurnPermissionOnce(runtime, 'permission-late-ledger', () => approval);
    expect(transitionCesarTurn(host, runtime.envelope, 'cancelling').ok).toBe(true);
    expect(transitionCesarTurn(host, runtime.envelope, 'cancelled').ok).toBe(true);
    resolveApproval(true);

    await expect(pending).rejects.toThrow('durable permission terminal failed');
  });

  it('blocks new turns when durable recovery sees an unsupported schema', () => {
    const home = setupTestAgonHome('turn-runtime-unknown-schema');
    resetEventLogState();
    try {
      appendControlPlaneEvent('chat-unknown', { schemaVersion: 2, type: 'turn_started' });
      const host = createDurableCesarTurnRuntimeHost('chat-unknown');

      expect(() => beginCesarTurn(host, 'turn-2', 'api-session')).toThrow('unsupported control-plane schema');
    } finally {
      resetEventLogState();
      cleanupTestAgonHome(home);
    }
  });
});
