import { afterEach, expect, it, vi } from 'vitest';
const effects = vi.hoisted(() => ({ dispatch: vi.fn(async () => ({ ranAsJob: false })) }));
vi.mock('../../packages/cli/src/signals/dispatch.js', () => ({
  dispatchIntent: effects.dispatch, handleModeSwitch: () => false,
  isCesarPlanApprovalInput: () => false, isCesarPlanStatusInput: () => false,
}));
vi.mock('../../packages/cli/src/lib/terminal-notify.js', () => ({ setWindowTitle: () => {} }));
import { runHandleSubmit, runProcessInputQueue } from '../../packages/cli/src/surfaces/app-submit.js';
import { clearSteering, markSteeringTurn, peekSteeringCount } from '../../packages/cli/src/cesar/steering.js';

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); clearSteering(); });

function fixture() {
  const queue: any[] = [];
  const opts: any = {
    inputEpochRef: { current: 0 }, pendingBellRef: { current: false }, awaitingPlanAnnouncedRef: { current: '' },
    pasteHashesRef: { current: new Map() }, pendingPasteTransformRef: { current: false }, inputValueRef: { current: '' },
    activePlanRef: { current: null }, activeTurnRef: { current: null }, interruptedTurnRef: { current: null },
    chatStartTimeRef: { current: 0 }, replState: 'idle', mode: 'chat', planModeQueued: false,
    autoModeQueued: false, permissionMode: 'auto-edit', btwPanel: null, pendingImages: [],
    dynamicSkills: [], extensionSkills: [], jobManager: { running: () => [] },
    setInputValue: vi.fn(), setInputHistory: vi.fn(), setHistoryIndex: vi.fn(),
    setInputQueue: (fn: any) => queue.splice(0, queue.length, ...fn(queue)), setSteeringCount: vi.fn(),
    transition: vi.fn(), dispatch: vi.fn(), buildContext: () => ({ config: { cesarEngine: 'b' } }),
  };
  return { opts, queue };
}

it('carries a retry through the real queue drain without charging an identical manual prompt', async () => {
  vi.useFakeTimers();
  const { opts, queue } = fixture();
  const turns: any[] = [];
  effects.dispatch.mockImplementation(async () => { turns.push({ ...opts.activeTurnRef.current }); return { ranAsJob: false }; });
  queue.push({ kind: 'telemetry-retry', input: 'same prompt' });
  let submitted!: Promise<void>;
  runProcessInputQueue('idle', [...queue], opts.setInputQueue, value => { submitted = runHandleSubmit(opts, value); }, vi.fn());
  await vi.advanceTimersByTimeAsync(50);
  await submitted;
  await runHandleSubmit(opts, 'same prompt');
  expect(turns).toEqual([
    { input: 'same prompt', engineId: 'b', retried: true },
    { input: 'same prompt', engineId: 'b', retried: false },
  ]);
  expect(queue).toEqual([]);
  expect(opts.dispatch).toHaveBeenCalledWith({ type: 'user-message', content: 'same prompt' });
});

it('preserves retry identity when the drain encounters a busy turn, rather than steering it', async () => {
  const { opts, queue } = fixture();
  opts.replState = 'streaming';
  opts.activeTurnRef.current = { input: 'other', engineId: 'b', retried: false };
  markSteeringTurn('other');
  const retry = { kind: 'telemetry-retry', input: 'same prompt' };
  await runHandleSubmit(opts, retry as any);
  expect(queue).toEqual([retry]);
  expect(peekSteeringCount()).toBe(0);
  expect(effects.dispatch).not.toHaveBeenCalled();
});

it.each(['mode', 'side chat', 'plan mode', 'approval', 'redirect'])(
  'does not reinterpret an automatic retry after the user changes %s', async scenario => {
    const { opts } = fixture();
    if (scenario === 'mode') opts.mode = 'brainstorm';
    if (scenario === 'side chat') opts.btwPanel = { status: 'done' };
    if (scenario === 'plan mode') opts.planModeQueued = true;
    if (scenario === 'approval') opts.activePlanRef.current = { state: 'awaiting_approval' };
    if (scenario === 'redirect') opts.interruptedTurnRef.current = { input: 'other', source: 'foreground', at: Date.now() };
    opts.sendBtwMessage = vi.fn();
    opts.handleSubmit = vi.fn();
    opts.setPlanModeQueued = vi.fn();
    await runHandleSubmit(opts, { kind: 'telemetry-retry', input: 'yes do it' });
    expect(effects.dispatch).not.toHaveBeenCalled();
    expect(opts.sendBtwMessage).not.toHaveBeenCalled();
    expect(opts.handleSubmit).not.toHaveBeenCalled();
    expect(opts.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning', message: expect.stringContaining('retry') }));
  });
