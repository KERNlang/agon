import { describe, expect, it } from 'vitest';

// Source of truth: packages/cli/src/kern/cesar/turn-reducer.kern (+ the CesarTurn machine in turn-state.kern)
import {
  reduceTurn,
  initialTurnSnapshot,
  TurnDriver,
} from '../../packages/cli/src/generated/cesar/turn-reducer.js';

describe('reduceTurn — pure turn reducer (Phase 0c spike)', () => {
  it('drives the happy path: stream → toolLoop → verifying → committing → done', () => {
    let s = initialTurnSnapshot();
    s = reduceTurn(s, { type: 'tool-loop-entered' } as any).next;
    expect(s.state).toBe('toolLoop');
    s = reduceTurn(s, { type: 'verification-started' } as any).next;
    expect(s.state).toBe('verifying');
    s = reduceTurn(s, { type: 'commit-requested' } as any).next;
    expect(s.state).toBe('committing');
    s = reduceTurn(s, { type: 'committed' } as any).next;
    expect(s.state).toBe('done');
  });

  it('a captured ask parks the turn and a continuation request can NEVER leave asking', () => {
    let s = initialTurnSnapshot();
    const askResult = reduceTurn(s, { type: 'ask-captured', payload: '{"q":"scope?"}', malformed: false } as any);
    s = askResult.next;
    expect(s.state).toBe('asking');
    expect(s.pendingAsk).toBe('{"q":"scope?"}');
    expect(askResult.effects).toEqual([{ type: 'present-ask', payload: '{"q":"scope?"}', malformed: false }]);

    // The self-answered-ask bug class, made unrepresentable:
    const cont = reduceTurn(s, { type: 'continuation-requested', reason: 'pause-detected' } as any);
    expect(cont.next.state).toBe('asking');
    expect(cont.next.continuations).toBe(0);
    expect(cont.effects).toEqual([]);
  });

  it('a pending ask blocks continuation even outside the asking state (committing capture)', () => {
    let s = initialTurnSnapshot();
    s = reduceTurn(s, { type: 'commit-requested' } as any).next;
    s = reduceTurn(s, { type: 'ask-captured', payload: 'late', malformed: false } as any).next;
    expect(s.state).toBe('committing'); // no transition from committing — payload parked
    expect(s.pendingAsk).toBe('late');
    const cont = reduceTurn(s, { type: 'continuation-requested', reason: 'nudge' } as any);
    expect(cont.effects).toEqual([]);
    expect(cont.next.state).toBe('committing');
  });

  it('an ask parked during committing is RE-SURFACED at committed — never silently discarded', () => {
    let s = initialTurnSnapshot();
    s = reduceTurn(s, { type: 'commit-requested' } as any).next;
    s = reduceTurn(s, { type: 'ask-captured', payload: 'parked-q', malformed: false } as any).next;
    const done = reduceTurn(s, { type: 'committed' } as any);
    expect(done.next.state).toBe('done');
    expect(done.effects).toEqual([{ type: 'present-ask', payload: 'parked-q', malformed: false }]);
  });

  it('is TOTAL: illegal or duplicate events no-op instead of throwing', () => {
    let s = initialTurnSnapshot();
    // duplicate ask while already asking → payload refresh, no throw, no double effect
    s = reduceTurn(s, { type: 'ask-captured', payload: 'q1', malformed: false } as any).next;
    const dup = reduceTurn(s, { type: 'ask-captured', payload: 'q2', malformed: false } as any);
    expect(dup.next.state).toBe('asking');
    expect(dup.next.pendingAsk).toBe('q2');
    expect(dup.effects).toEqual([]);
    // continuation while continuing → no-op, counter NOT incremented
    let c = initialTurnSnapshot();
    c = reduceTurn(c, { type: 'continuation-requested', reason: 'a' } as any).next;
    expect(c.state).toBe('continuing');
    const again = reduceTurn(c, { type: 'continuation-requested', reason: 'b' } as any);
    expect(again.next.state).toBe('continuing');
    expect(again.next.continuations).toBe(1);
    expect(again.effects).toEqual([]);
    // commit requested mid-continuation → no-op, no throw
    expect(reduceTurn(c, { type: 'commit-requested' } as any).next.state).toBe('continuing');
    // tool-loop-entered from a non-streaming state → no-op
    expect(reduceTurn(c, { type: 'tool-loop-entered' } as any).next.state).toBe('continuing');
  });

  it('an engine error DURING an ask fails the turn with the real reason (fail is legal from asking)', () => {
    let s = initialTurnSnapshot();
    s = reduceTurn(s, { type: 'ask-captured', payload: 'q', malformed: false } as any).next;
    const { next, effects } = reduceTurn(s, { type: 'engine-errored', message: 'stream died' } as any);
    expect(next.state).toBe('failed');
    expect(next.engineError).toBe('stream died');
    expect(effects).toEqual([{ type: 'surface-error', message: 'stream died' }]);
  });

  it('an engine error fails the turn with the real reason surfaced', () => {
    const { next, effects } = reduceTurn(initialTurnSnapshot(), { type: 'engine-errored', message: 'rate limited (429)' } as any);
    expect(next.state).toBe('failed');
    expect(next.engineError).toBe('rate limited (429)');
    expect(effects).toEqual([{ type: 'surface-error', message: 'rate limited (429)' }]);
  });

  it('terminal states absorb late events (abandoned-generator chunks cannot resurrect a turn)', () => {
    let s = reduceTurn(initialTurnSnapshot(), { type: 'aborted' } as any).next;
    expect(s.state).toBe('interrupted');
    const late = reduceTurn(s, { type: 'ask-captured', payload: 'zombie', malformed: false } as any);
    expect(late.next).toEqual(s);
    expect(late.effects).toEqual([]);
  });
});

describe('TurnDriver — sequential effect driver (tribunal R5 scenario)', () => {
  it('an abort arriving WHILE an effect is in flight queues behind it — no mid-transition desync', async () => {
    const log: string[] = [];
    let releaseEffect: () => void = () => {};
    const effectGate = new Promise<void>((resolve) => { releaseEffect = resolve; });

    const driver = new TurnDriver(async (effect: any) => {
      log.push(`effect:${effect.type}:start`);
      if (effect.type === 'present-ask') await effectGate; // slow effect in flight
      log.push(`effect:${effect.type}:end`);
      return null;
    });

    // Ask captured → present-ask effect starts and blocks on the gate.
    const askDispatch = driver.dispatch({ type: 'ask-captured', payload: 'q', malformed: false } as any);
    await Promise.resolve();
    expect(driver.current().state).toBe('asking');
    expect(log).toEqual(['effect:present-ask:start']);

    // Abort lands while the effect is in flight — must QUEUE, not interleave.
    const abortDispatch = driver.dispatch({ type: 'aborted' } as any);
    await Promise.resolve();
    expect(driver.current().state).toBe('asking'); // still — pump hasn't reached the abort

    releaseEffect();
    await askDispatch;
    await abortDispatch;
    expect(driver.current().state).toBe('interrupted');
    expect(log).toEqual(['effect:present-ask:start', 'effect:present-ask:end']);
  });

  it('effect-produced follow-up events feed back through the same tail', async () => {
    const driver = new TurnDriver(async (effect: any) => {
      if (effect.type === 'send-continuation') return { type: 'stream-resumed' } as any;
      return null;
    });
    await driver.dispatch({ type: 'continuation-requested', reason: 'more-work' } as any);
    await driver.settled(); // follow-ups chain behind the original event
    expect(driver.current().state).toBe('streaming'); // continuing → effect → resumed
    expect(driver.current().continuations).toBe(1);
  });

  it('awaiting a NON-owning dispatch guarantees that event was applied (review: early-resolve bug)', async () => {
    let releaseEffect: () => void = () => {};
    const effectGate = new Promise<void>((resolve) => { releaseEffect = resolve; });
    const driver = new TurnDriver(async (effect: any) => {
      if (effect.type === 'present-ask') await effectGate;
      return null;
    });
    void driver.dispatch({ type: 'ask-captured', payload: 'q', malformed: false } as any);
    const abortDispatch = driver.dispatch({ type: 'aborted' } as any);
    setTimeout(releaseEffect, 0);
    await abortDispatch; // must not resolve until the abort itself was applied
    expect(driver.current().state).toBe('interrupted');
  });

  it('a throwing effect surfaces as engine-errored instead of wedging the tail', async () => {
    const driver = new TurnDriver(async (effect: any) => {
      if (effect.type === 'present-ask') throw new Error('overlay renderer exploded');
      return null;
    });
    await driver.dispatch({ type: 'ask-captured', payload: 'q', malformed: false } as any);
    await driver.settled();
    expect(driver.current().state).toBe('failed');
    expect(driver.current().engineError).toBe('overlay renderer exploded');
    // The tail is not wedged — later events still apply (terminal absorption).
    await driver.dispatch({ type: 'aborted' } as any);
    expect(driver.current().state).toBe('failed');
  });
});
