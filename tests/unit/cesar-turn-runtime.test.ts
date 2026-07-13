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
