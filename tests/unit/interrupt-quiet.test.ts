import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildCancelCallback,
  runInterruptActiveRun,
} from '../../packages/cli/src/surfaces/app-interrupt.js';
import {
  buildInterruptedTurnRedirect,
  runHandleSubmit,
} from '../../packages/cli/src/surfaces/app-submit.js';
import {
  clearSteering,
  markSteeringTurn,
  peekSteeringCount,
  pushSteering,
} from '../../packages/cli/src/cesar/steering.js';

const REDIRECT_MARKER = '[INTERRUPTED TURN REDIRECT]';

/** A setInputQueue that behaves like React's functional setState. */
function queueSpy() {
  const state: { queue: string[] } = { queue: [] };
  const set = vi.fn((updater: (prev: string[]) => string[]) => {
    state.queue = updater(state.queue);
  });
  return { state, set };
}

function interruptDeps(overrides: Record<string, unknown> = {}) {
  return {
    activeAbortRef: { current: null },
    activePlanRef: { current: null },
    activeTurnRef: { current: null },
    interruptedTurnRef: { current: null },
    cesarRuntimeHost: { active: null },
    jobManager: { running: () => [], cancel: () => false, list: () => [] },
    setActiveAbort: vi.fn(),
    setActivePlan: vi.fn(),
    setJobList: vi.fn(),
    setLiveSpinner: vi.fn(),
    setLiveProgress: vi.fn(),
    outputActions: { flushStream: vi.fn() },
    setQuestionState: vi.fn(),
    setQuestionAnswer: vi.fn(),
    setPendingPlanProposal: vi.fn(),
    setSlashPickerOpen: vi.fn(),
    setEnginePickerOpen: vi.fn(),
    setModelPickerOpen: vi.fn(),
    setCesarPickerOpen: vi.fn(),
    setReviewEvent: vi.fn(),
    replState: 'idle',
    dispatch: vi.fn(),
    setReplState: vi.fn(),
    pendingBellRef: { current: false },
    bell: vi.fn(),
    setWindowTitle: vi.fn(),
    setInputQueue: vi.fn(),
    ...overrides,
  } as any;
}

/**
 * Enough of HandleSubmitDeps to reach the busy-queue / steering branches.
 * Everything past those early returns is deliberately absent — if a change ever
 * lets execution fall through, the test explodes instead of silently passing.
 */
function submitDeps(overrides: Record<string, unknown> = {}) {
  return {
    inputEpochRef: { current: 0 },
    pendingBellRef: { current: false },
    awaitingPlanAnnouncedRef: { current: '' },
    pasteHashesRef: { current: new Map() },
    pendingPasteTransformRef: { current: false },
    inputValueRef: { current: '' },
    activePlanRef: { current: null },
    activeTurnRef: { current: null },
    interruptedTurnRef: { current: null },
    chatStartTimeRef: { current: 0 },
    replState: 'streaming',
    mode: 'chat',
    planModeQueued: false,
    autoModeQueued: false,
    permissionMode: 'auto-edit',
    btwPanel: null,
    pendingImages: [],
    jobManager: { running: () => [], list: () => [] },
    commandRegistry: null,
    setInputValue: vi.fn(),
    // Never invokes the updater — that keeps saveComposerInputHistory (disk) out
    // of the test while still letting us assert WHAT would have been recorded.
    setInputHistory: vi.fn(),
    setHistoryIndex: vi.fn(),
    setInputQueue: vi.fn(),
    setSteeringCount: vi.fn(),
    setSlashPickerOpen: vi.fn(),
    setPlanModeQueued: vi.fn(),
    setPendingImages: vi.fn(),
    applyPermissionMode: vi.fn(),
    dispatch: vi.fn(),
    ...overrides,
  } as any;
}

beforeEach(() => {
  clearSteering();
});

describe('Esc / steer stay quiet (Claude Code parity)', () => {
  it('C1: steer-then-Esc queues the RAW steer text, never the redirect wrapper', async () => {
    markSteeringTurn('turn-1');
    expect(pushSteering('drop the batching, just fix Esc')).toBe(true);

    const q = queueSpy();
    const deps = interruptDeps({
      activeAbortRef: { current: new AbortController() },
      activeTurnRef: { current: { input: 'rewrite the renderer', engineId: 'claude', retried: false } },
      interruptedTurnRef: { current: null },
      replState: 'streaming',
      setInputQueue: q.set,
    });

    runInterruptActiveRun(deps, 'Interrupted.', false);

    // Exactly the user's words — this string is what the composer chip shows,
    // what the drain re-submits as a user-message, and what ↑ history stores.
    expect(q.state.queue).toEqual(['drop the batching, just fix Esc']);
    expect(q.state.queue.join('\n')).not.toContain(REDIRECT_MARKER);
    // The interrupted-turn context rides the ref instead, for ONE later wrap.
    expect(deps.interruptedTurnRef.current).toMatchObject({
      input: 'rewrite the renderer',
      source: 'foreground',
    });
    expect(peekSteeringCount()).toBe(0);
  });

  it('C1: the engine-facing string is wrapped exactly once', () => {
    markSteeringTurn('turn-1');
    pushSteering('only fix the Esc handoff now');
    const q = queueSpy();
    const deps = interruptDeps({
      activeAbortRef: { current: new AbortController() },
      activeTurnRef: { current: { input: 'rewrite the renderer', engineId: 'claude', retried: false } },
      replState: 'streaming',
      setInputQueue: q.set,
    });
    runInterruptActiveRun(deps, 'Interrupted.', false);

    // What runHandleSubmit does at drain time with a fresh interruptedTurnRef.
    const ref = deps.interruptedTurnRef.current;
    const engineInput = buildInterruptedTurnRedirect(ref.input, q.state.queue[0], ref.source);
    expect(engineInput.split(REDIRECT_MARKER).length - 1).toBe(1);
    expect(engineInput).toContain('only fix the Esc handoff now');
  });

  it('C3: a mid-turn steer prints no transcript line — the composer chip owns it', async () => {
    markSteeringTurn('turn-1');
    const deps = submitDeps({
      activeTurnRef: { current: { input: 'rewrite the renderer', engineId: 'claude', retried: false } },
    });

    await runHandleSubmit(deps, 'also keep the batching changes');

    expect(peekSteeringCount()).toBe(1);
    expect(deps.setSteeringCount).toHaveBeenCalledWith(1);
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('C3: a busy-repl submit queues silently — no "Queued: …" line', async () => {
    const q = queueSpy();
    const deps = submitDeps({ setInputQueue: q.set });

    await runHandleSubmit(deps, 'run the tests when you are done');

    expect(q.state.queue).toEqual(['run the tests when you are done']);
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('C2: Esc with typed text emits exactly ONE notice', async () => {
    const q = queueSpy();
    const dispatch = vi.fn();
    const abort = new AbortController();
    const interruptedTurnRef = { current: null };

    // The `interruptSubmit` key action, in order: interrupt, then submit.
    const iDeps = interruptDeps({
      activeAbortRef: { current: abort },
      activeTurnRef: { current: { input: 'rewrite the renderer', engineId: 'claude', retried: false } },
      interruptedTurnRef,
      replState: 'streaming',
      dispatch,
      setInputQueue: q.set,
    });
    runInterruptActiveRun(iDeps, 'Interrupted — redirecting…', false);

    const sDeps = submitDeps({ dispatch, interruptedTurnRef, setInputQueue: q.set });
    await runHandleSubmit(sDeps, 'only fix the Esc handoff now');

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'warning', message: 'Interrupted — redirecting…' });
    // The user's raw words are what gets queued + re-shown, not machine prose.
    expect(q.state.queue).toEqual(['only fix the Esc handoff now']);
    expect(q.state.queue[0]).not.toContain(REDIRECT_MARKER);
    // …and the redirect context is still pending for the single engine-side wrap.
    expect(interruptedTurnRef.current).toMatchObject({ input: 'rewrite the renderer' });
  });

  it('C5: the hard-cancel callback says so, once', () => {
    const dispatch = vi.fn();
    const cancel = buildCancelCallback({
      activeAbortRef: { current: null },
      activePlanRef: { current: null },
      cesarRuntimeHost: { active: null },
      setActiveAbort: vi.fn(),
      setActivePlan: vi.fn(),
      setLiveSpinner: vi.fn(),
      setLiveProgress: vi.fn(),
      outputActions: { flushStream: vi.fn() },
      agentProgressRef: { current: {} },
      setAgentProgress: vi.fn(),
      setQuestionState: vi.fn(),
      setQuestionAnswer: vi.fn(),
      setPendingPlanProposal: vi.fn(),
      setSlashPickerOpen: vi.fn(),
      setEnginePickerOpen: vi.fn(),
      setModelPickerOpen: vi.fn(),
      setCesarPickerOpen: vi.fn(),
      setReviewEvent: vi.fn(),
      setToolDetailEvent: vi.fn(),
      setReplState: vi.fn(),
      dispatch,
    } as any);

    cancel();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'warning', message: 'Cancelled.' });
  });
});
