// ── Steering-yield wiring guards (brain.kern) ──────────────────────────
//
// handleCesarBrain is one ~3000-line turn machine with no injection seam, so the
// three review findings below cannot be driven behaviorally from a unit test.
// They are all *structural* invariants — "this bookkeeping happens in exactly one
// place", "this early exit consults that helper" — and the review explicitly
// asked for a source-level guard for #7. These assertions read the GENERATED
// brain.ts (compiled from packages/cli/src/kern/cesar/brain.kern) so a future
// edit that reintroduces the bug fails a test instead of silently shipping.
//
//   #1  an empty-text continuation must not `break` out of the loop with the
//       yielded steering undelivered and the continuation slot spent.
//   #2  the steering-delivery send must forward the images the drain consumed.
//   #7  the done-reason bookkeeping (_noteDoneChunk) must live inside the ONE
//       send wrapper instead of being hand-repeated at ~15 `done` break sites,
//       where a single forgotten call silently breaks the refund + delivery.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const BRAIN = readFileSync(
  resolve(here, '../../packages/cli/src/generated/cesar/brain.ts'),
  'utf8',
);

// Strip comments so a prose mention of `session.send` in a doc block can never
// satisfy — or falsely trip — a structural assertion.
const CODE = BRAIN
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
  .join('\n');

describe('every model round-trip funnels through the one send wrapper (#7)', () => {
  it('calls session.send in exactly one place', () => {
    const sends = CODE.match(/\bsession\.send\s*\(/g) ?? [];
    // If this fails, a new raw send site was added: it would skip the
    // gateMatchers/shouldYield defaults AND the done-reason bookkeeping, so the
    // steering yield it triggers would never be refunded or delivered. Route it
    // through _cesarSend instead of adding a second call site.
    expect(sends).toHaveLength(1);
  });

  it('notes the done reason inside the wrapper, not at the ~15 break sites', () => {
    // Exactly two mentions: the definition and the single call inside the
    // wrapper's chunk loop. Any more means the per-site duplication is back.
    const mentions = CODE.match(/_noteDoneChunk/g) ?? [];
    expect(mentions).toHaveLength(2);
    // And the one call sits between `session.send(` and the wrapper's `yield`.
    const wrapper = CODE.slice(CODE.indexOf('const _cesarSend'), CODE.indexOf('const _cesarSend') + 800);
    expect(wrapper).toContain('session.send(');
    expect(wrapper).toMatch(/for await \(const chunk of _inner\)[\s\S]*_noteDoneChunk\(chunk\);[\s\S]*yield chunk;/);
  });
});

describe('a steering-yield round is never dropped on an empty continuation (#1)', () => {
  it('consults _consumeSteeringYieldRound before breaking on empty text', () => {
    const emptyExit = CODE.slice(CODE.indexOf('if (!cleanCont)'), CODE.indexOf('if (!cleanCont)') + 200);
    // Refund the slot and loop (so the top of the loop delivers the steering)
    // rather than breaking out of the continuation loop with it still queued.
    expect(emptyExit).toMatch(/if \(!cleanCont\) \{\s*if \(_consumeSteeringYieldRound\(\)\) continue;\s*break;/);
  });

  it('refunds the continuation slot in ONE shared helper used by both round exits', () => {
    const helper = CODE.slice(CODE.indexOf('const _consumeSteeringYieldRound'));
    expect(helper).toMatch(/_continuations = refundContinuationForSteeringYield\(_continuations\)/);
    // Both exits (empty-text early exit + normal end-of-round strike site) call it.
    expect((CODE.match(/if \(_consumeSteeringYieldRound\(\)\) continue;/g) ?? [])).toHaveLength(2);
  });
});

describe('steering delivery forwards the attachments the drain consumed (#2)', () => {
  it('passes the drained images into the delivery send', () => {
    const delivery = CODE.slice(CODE.indexOf('const _steerNow = drainSteeringIntoSend'), CODE.indexOf('const _steerNow = drainSteeringIntoSend') + 700);
    // drainSteering has already REMOVED the queue entry, so images not forwarded
    // here are lost outright — they do not ride a later turn.
    expect(delivery).toContain('_lastDrainedSteerImages');
    expect(delivery).toMatch(/_injectSystemContinuation\([\s\S]*_steerImages,/);
    // Images alone (no text) still deliver, so a future push path that allows an
    // image-only steering message cannot make the drain swallow it silently.
    expect(delivery).toMatch(/_steerNow\.trim\(\) \|\| _steerImages\.length > 0/);
  });

  it('threads the images through the injector into the send options', () => {
    const injector = CODE.slice(CODE.indexOf('const _injectSystemContinuation'), CODE.indexOf('const _injectSystemContinuation') + 1600);
    expect(injector).toMatch(/sendImages\?: string\[\] \| null/);
    expect(injector).toMatch(/sendImages && sendImages\.length \? \{ images: sendImages \}/);
  });
});
