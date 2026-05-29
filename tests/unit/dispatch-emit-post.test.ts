import { describe, it, expect, vi } from 'vitest';
import { dispatchIntent } from '../../packages/cli/src/generated/signals/dispatch.js';

// Locks in the control-flow invariant preserved by the dispatchIntent sub-dispatcher
// split (Option B, nero Ch.1/Ch.5): post:dispatch fires ONLY on the break-path
// (sync commands) — NOT on in-case validation `return`s — and DOES fire on the
// final unmatched fallback. A naive "emit unless ranAsJob" decomposition would
// have regressed the validation-guard paths.
function makeCb() {
  const emit = vi.fn().mockResolvedValue(undefined);
  const cb: any = {
    dispatch: vi.fn(),
    eventBus: { emit },
    ctx: { chatSession: { messages: [] } },
    commandRegistry: null,
    runAsJob: vi.fn(),
    setMode: vi.fn(),
    setPendingImages: vi.fn(),
    setChatSession: vi.fn(),
    exit: vi.fn(),
    allImages: [],
    allSlashCommands: [{ cmd: '/help', desc: 'help' }],
    dynamicSkills: [],
    loadedExtensions: [],
    mode: 'chat',
  };
  const postCalls = () => emit.mock.calls.filter((c: any[]) => c[0] === 'post:dispatch').length;
  return { cb, postCalls };
}

describe('dispatchIntent post:dispatch invariant (sub-dispatcher split)', () => {
  it('fires post:dispatch on a break-path sync command (slash-list)', async () => {
    const { cb, postCalls } = makeCb();
    const r = await dispatchIntent({ type: 'slash-list' }, '/commands', cb);
    expect(r).toEqual({ handled: true, ranAsJob: false });
    expect(postCalls()).toBe(1);
  });

  it('does NOT fire post:dispatch on an in-case validation return (/think with empty input)', async () => {
    const { cb, postCalls } = makeCb();
    const r = await dispatchIntent({ type: 'think', input: '' }, '/think', cb);
    expect(r).toEqual({ handled: true, ranAsJob: false });
    expect(postCalls()).toBe(0); // returned directly, before the shared emit tail
  });

  it('fires post:dispatch on the unmatched fallback (Unknown command)', async () => {
    const { cb, postCalls } = makeCb();
    const r = await dispatchIntent({ type: 'totally-bogus-intent-xyz' }, 'x', cb);
    expect(r).toEqual({ handled: true, ranAsJob: false });
    expect(cb.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warning', message: expect.stringContaining('Unknown command') }),
    );
    expect(postCalls()).toBe(1);
  });
});
