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

// ── The yield must REACH the delivery site (codex N2) ─────────────────────
// A native cycle yields at a completed tool pair, which routinely means ZERO
// narration text, and `agenticAuto` is true only on AUTO turns. So on an ordinary
// chat turn the auto-continuation gate's `response.trim().length > 0` clause was
// enough to skip the whole loop — the yielded steering then sat queued until the
// app's idle leftover drain surfaced it on a LATER turn, which is precisely the
// bug the cooperative yield exists to remove.
describe('a pending steering yield always reaches the continuation loop (#N2)', () => {
  it('enters the auto-continuation loop on a zero-text, non-agentic yield', () => {
    const gate = CODE.slice(CODE.indexOf('const _shouldAutoContinue'), CODE.indexOf('const _shouldAutoContinue') + 500);
    // Both gating clauses that a text-less yield would otherwise fail.
    expect(gate).toMatch(/\(hadToolActivity \|\| ranToolLoop \|\| _steeringYieldPending\)/);
    expect(gate).toMatch(/\(agenticAuto \|\| response\.trim\(\)\.length > 0 \|\| _steeringYieldPending\)/);
    // The exclusions that must NOT be bypassed: plan mode, the chat fast-path, a
    // pending delegation, a dead/aborted session and an errored engine.
    expect(gate).toContain('!inPlanMode');
    expect(gate).toContain('!answerFastPath');
    expect(gate).toContain('!ctx.cesar!.pendingDelegation');
    expect(gate).toContain('!abort.signal.aborted');
    expect(gate).toContain('!_engineErrored');
  });
});

// ── Tools a CONTINUATION runs are never invisible or off-ledger (codex B2) ──
// Every continuation send (the [SYSTEM] gate/steering injection, the auto-continue
// nudge, the closure line, the confirmation follow-up and its tool loop) used to
// read only text/error/done off its stream. On a native engine the core loop
// executes tools inside those sends, so their calls ran with NO recordToolUse:
// no _toolsUsed entry, no mutation count, no gate/verification flip, no novelty
// for the progress signature and no tool row on screen — a steering reply that
// edited files could then claim done without the verify-before-done gate firing.
describe('continuation streams forward native tool calls (#B2)', () => {
  it('pairs every status forward with a tool-call forward, on the next line', () => {
    const statusSites = CODE.match(/^\s*if \(forwardContinuationStatus\(([_A-Za-z]+), dispatch\)\) continue;\n\s*if \(_forwardContinuationToolCall\(\1\)\) continue;$/gm) ?? [];
    const allStatus = CODE.match(/if \(forwardContinuationStatus\(/g) ?? [];
    const allTools = CODE.match(/if \(_forwardContinuationToolCall\(/g) ?? [];
    // If this fails, a continuation stream forwards status but drops tool calls
    // (or a new send site was added without either) — its tools would execute
    // off-ledger and off-screen. Forward both, on the same chunk variable.
    expect(allStatus.length).toBeGreaterThanOrEqual(7);
    expect(allTools).toHaveLength(allStatus.length);
    expect(statusSites).toHaveLength(allStatus.length);
  });

  it('routes a continuation tool call through the SAME central record point', () => {
    const helper = CODE.slice(CODE.indexOf('const _forwardContinuationToolCall'), CODE.indexOf('const _forwardContinuationToolCall') + 1800);
    // recordToolUse is what flips _successfulMutationCount / _verificationPassed /
    // _ranGate / the novelty ledger — the whole point of the forward.
    expect(helper).toMatch(/recordToolUse\(toolName, 'native', toolInput, rawStatus,/);
    // Structured args are passed so the step signature is the shared canonical one.
    expect(helper).toContain('meta.input as Record<string, unknown>');
    // The tool row reaches the transcript.
    expect(helper).toMatch(/dispatchToolCall\(\{[\s\S]*type: 'tool-call'/);
    // Native only: on an XML/eager engine the same chunks are already recorded by
    // the initial stream + runToolLoop callbacks, so forwarding would double-count.
    expect(helper).toContain("if (!ctx.cesar!.hasNativeTools) return false;");
  });

  it('delivers steering through the injector that now forwards tool calls', () => {
    // The steering-delivery send IS _injectSystemContinuation, so the forward has
    // to be inside it — this is the site where the model answers the user by
    // editing files.
    const injector = CODE.slice(CODE.indexOf('const _injectSystemContinuation'), CODE.indexOf('const _consumeSteeringYieldRound'));
    expect(injector).toContain('_forwardContinuationToolCall(_c)');
  });
});

// ── The drain loop's per-message scope (agy B1) ───────────────────────────
// Reviewed as "`text` is block-scoped in the loop but read outside it → runtime
// ReferenceError". It is not — the telemetry record sits INSIDE the per-message
// loop (and `npm run typecheck` would reject an out-of-scope read outright). Pin
// the invariant anyway: ONE record per drained message, built from that message's
// own `text`, so a refactor that hoists it out of the loop fails here.
describe('the steering drain records telemetry per message, inside the loop (#B1)', () => {
  it('keeps the steering_injected record inside the per-message loop', () => {
    const loopStart = CODE.indexOf('for (const msg of pending)');
    expect(loopStart).toBeGreaterThan(0);
    // The loop body ends where the post-loop images latch begins.
    const loopEnd = CODE.indexOf('if (drainedImages.length)', loopStart);
    expect(loopEnd).toBeGreaterThan(loopStart);
    const body = CODE.slice(loopStart, loopEnd);
    expect(body).toContain('const text = (msg.input ?? \'\').trim();');
    expect(body).toContain("event: 'steering_injected'");
    // Per message: the render, the history append and the telemetry all sit here.
    expect(body).toContain("dispatch({ type: 'user-message', content: text }");
    expect(body).toMatch(/appendMessage\(ctx\.chatSession, \{ role: 'user', content: text/);
    // Exactly one telemetry site in the whole turn machine.
    expect((CODE.match(/steering_injected/g) ?? [])).toHaveLength(1);
  });
});
