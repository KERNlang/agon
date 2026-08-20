import type { ImageAttachment } from '@kernlang/agon-core';

// ── Module: CesarSteering ──

export const _queue: Array<{ turnId: string; input: string; images?: ImageAttachment[] }> = [];

export const _activeTurnId: { value: string | null } = { value: null };

export const _listeners: Array<(count: number) => void> = [];

export function _notify(): void {
  const active = _activeTurnId.value;
  let n = 0;
  if (active) for (const entry of _queue) if (entry.turnId === active) n++;
  for (const cb of _listeners) {
    try { cb(n); } catch { /* a listener throwing must not break steering */ }
  }
}

export function onSteeringChange(cb: (count: number) => void): () => void {
  _listeners.push(cb);
  return () => {
    const i = _listeners.indexOf(cb);
    if (i >= 0) _listeners.splice(i, 1);
  };
}

export function markSteeringTurn(turnId: string): void {
  _activeTurnId.value = turnId;
  // Drop entries that belonged to any earlier turn — a new turn never
  // inherits an old turn's unconsumed steering through this channel.
  _queue.length = 0;
  _notify();
}

export function pushSteering(input: string, images?: ImageAttachment[]): boolean {
  const active = _activeTurnId.value;
  if (!active) {
    return false;
  }
  _queue.push({ turnId: active, input: input, images: images });
  _notify();
  return true;
}

export function drainSteering(turnId: string): Array<{ input: string; images?: ImageAttachment[] }> {
  const mine: Array<{ input: string; images?: ImageAttachment[] }> = [];
  const rest: Array<{ turnId: string; input: string; images?: ImageAttachment[] }> = [];
  for (const entry of _queue) {
    if (entry.turnId === turnId) mine.push({ input: entry.input, images: entry.images });
    else rest.push(entry);
  }
  _queue.length = 0;
  for (const entry of rest) _queue.push(entry);
  _notify();
  return mine;
}

export function formatSteeringIntoSend(carrier: string, blocks: string[]): string {
  const texts = (blocks ?? []).map((block: string) => String(block ?? '').trim()).filter((block: string) => block.length > 0);
  if (texts.length === 0) {
    return carrier;
  }
  const steer = texts.map((block: string) => `[User steering — injected mid-turn]\n${block}`).join('\n\n');
  return carrier ? `${carrier}\n\n${steer}` : steer;
}

export function popSteering(): { input: string; images?: ImageAttachment[] } | null {
  const active = _activeTurnId.value;
  if (!active) return null;
  // Last matching index via reduce — findLastIndex needs an ES2023 lib
  // target, and a raw for-statement would trip the kern self-coverage gate.
  const index = _queue.reduce((last: number, entry, i: number) => (entry.turnId === active ? i : last), -1);
  if (index < 0) return null;
  const [entry] = _queue.splice(index, 1);
  _notify();
  return { input: entry.input, images: entry.images };
}

export function peekSteeringCount(): number {
  const active = _activeTurnId.value;
  if (!active) return 0;
  let n = 0;
  for (const entry of _queue) if (entry.turnId === active) n++;
  return n;
}

export function hasPendingSteering(turnId: string): boolean {
  if (!turnId || _activeTurnId.value !== turnId) {
    return false;
  }
  return _queue.some((entry) => entry.turnId === turnId);
}

export function releaseSteeringTurn(turnId: string): void {
  if (_activeTurnId.value === turnId) {
    _activeTurnId.value = null;
    _notify();
  }
}

export function drainLeftoverSteering(): Array<{ input: string; images?: ImageAttachment[] }> {
  const all = _queue.map((e) => ({ input: e.input, images: e.images }));
  _queue.length = 0;
  _notify();
  return all;
}

export function clearSteering(): void {
  _queue.length = 0;
  _activeTurnId.value = null;
  _notify();
}

