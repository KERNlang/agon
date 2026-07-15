import { describe, expect, it, vi } from 'vitest';

import { cancelLatestRunningJob, runInterruptActiveRun } from '../../packages/cli/src/generated/surfaces/app-interrupt.js';
import { buildInterruptedTurnRedirect } from '../../packages/cli/src/generated/surfaces/app-submit.js';

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
    ...overrides,
  } as any;
}

describe('interrupt redirect continuity', () => {
  it('cancels the newest delegated job so Esc reaches background work', () => {
    const jobs = [
      { id: '1', type: 'agent', state: 'running', label: 'older task' },
      { id: '2', type: 'agent', state: 'running', label: 'current task' },
    ];
    const cancel = vi.fn(() => true);

    expect(cancelLatestRunningJob({ running: () => jobs, cancel }, 'Interrupted by user')).toEqual(jobs[1]);
    expect(cancel).toHaveBeenCalledWith('2', 'Interrupted by user');
  });

  it('turns the next message into an authoritative continuation, not a restart', () => {
    const redirect = buildInterruptedTurnRedirect(
      'Rewrite the renderer and keep the finished batching changes.',
      'Only fix the Esc handoff now.',
      'job',
    );

    expect(redirect).toContain('[INTERRUPTED TURN REDIRECT]');
    expect(redirect).toContain('Interrupted background task');
    expect(redirect).toContain('Rewrite the renderer');
    expect(redirect).toContain('Latest instruction (authoritative)');
    expect(redirect).toContain('Only fix the Esc handoff now.');
    expect(redirect).toContain('Preserve useful progress');
    expect(redirect).toContain('Do not restart from zero');
  });

  it('captures foreground context and clears the active turn synchronously', () => {
    const abort = new AbortController();
    const activeTurnRef = {
      current: { input: 'finish the renderer', engineId: 'claude', retried: false },
    };
    const interruptedTurnRef = { current: null };
    const deps = interruptDeps({
      activeAbortRef: { current: abort },
      activeTurnRef,
      interruptedTurnRef,
      replState: 'streaming',
    });

    runInterruptActiveRun(deps, 'Interrupted.', false);

    expect(abort.signal.aborted).toBe(true);
    expect(activeTurnRef.current).toBeNull();
    expect(interruptedTurnRef.current).toMatchObject({
      input: 'finish the renderer',
      source: 'foreground',
    });
    expect(deps.setReplState).toHaveBeenCalledOnce();
  });

  it('cancels and captures delegated work while the foreground REPL is idle', () => {
    const job = { id: '7', type: 'agent', state: 'running', label: 'build the board' };
    const interruptedTurnRef = { current: null };
    const jobManager = {
      running: () => [job],
      cancel: vi.fn(() => true),
      list: () => [{ ...job, state: 'cancelled' }],
    };
    const deps = interruptDeps({ jobManager, interruptedTurnRef });

    runInterruptActiveRun(deps, 'Interrupted.', false);

    expect(jobManager.cancel).toHaveBeenCalledWith('7', 'Interrupted by user');
    expect(interruptedTurnRef.current).toMatchObject({
      input: 'build the board',
      source: 'job',
    });
    expect(deps.setJobList).toHaveBeenCalledWith([expect.objectContaining({ id: '7', state: 'cancelled' })]);
    expect(deps.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'info',
      message: expect.stringContaining('Interrupted background job [7]'),
    }));
  });
});
