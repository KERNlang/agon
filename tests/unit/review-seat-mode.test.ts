import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildCommand,
  resolveModeConfig,
  nonAgenticFramingKind,
  applyNonAgenticFraming,
  planClaudePtyDispatch,
  useFileChannelForDispatch,
  fileChannelInstruction,
  SINGLE_PASS_FRAMING,
  REVIEW_FRAMING,
} from '../../packages/adapter-cli/src/generated/adapter-helpers.js';
import {
  parseStreamJsonFailure,
  isDeterministicStreamFailure,
} from '../../packages/core/src/generated/blocks/stream-parser.js';
import { companionUsesNativeReview } from '../../packages/core/src/generated/sessions/companion-dispatch.js';
import {
  runReviewCore,
  shouldRetryReviewAttempt,
} from '../../packages/cli/src/generated/handlers/review.js';
import { validateEngineConfig } from '../../packages/core/src/schemas/engine-schema.js';

// Regression suite for the dead-`review`-block bug that made every `agon review`
// claude seat fail with error_max_turns:
//
//   1. the review dispatch asked for mode 'exec', so engines/claude.json's
//      `review` block (--max-turns 50) was DEAD CODE and the seat ran under
//      exec's --max-turns 10;
//   2. the single-pass OUTPUT RULES framing that keeps an agentic --print CLI
//      from spending its whole turn budget on builds/tests was hardcoded to one
//      engine id;
//   3. the resulting stream-json `result` envelope (subtype error_max_turns) was
//      flattened into a bare `exit 1`;
//   4. and that undiagnosable `exit 1` was then retried at full price for a
//      guaranteed-identical outcome.

const ENGINES_DIR = join(
  fileURLToPath(new URL('../..', import.meta.url)),
  'engines',
);

// --- (1) mode selection + fallback --------------------------------------

describe('review-mode command selection', () => {
  const claude = {
    id: 'claude',
    exec: { args: ['--print', '--max-turns', '10', '{prompt}'] },
    review: { args: ['--print', '--verbose', '--max-turns', '50', '{prompt}'] },
    agent: { args: ['--print', '--max-turns', '100', '{prompt}'] },
  } as any;

  it('spawns a review dispatch from the engine\'s DECLARED review block, not exec', () => {
    const { args } = buildCommand(claude, 'review', 'REVIEW THIS', '/repo', 180, 'claude');
    const turnsIdx = args.indexOf('--max-turns');
    expect(turnsIdx).toBeGreaterThanOrEqual(0);
    expect(args[turnsIdx + 1]).toBe('50');
    expect(args).toContain('--verbose');
  });

  it('keeps exec and agent dispatches on their own blocks', () => {
    expect(buildCommand(claude, 'exec', 'p', '/repo', 180, 'claude').args)
      .toEqual(['--print', '--max-turns', '10', 'p']);
    expect(buildCommand(claude, 'agent', 'p', '/repo', 180, 'claude').args)
      .toEqual(['--print', '--max-turns', '100', 'p']);
  });

  it('falls back to exec for an engine that declares NO review block', () => {
    const aider = {
      id: 'aider',
      exec: { args: ['--yes', '--no-git', '--message', '{prompt}'] },
      agent: { args: ['--yes', '--auto-commits', '--message', '{prompt}'] },
    } as any;
    expect(resolveModeConfig(aider, 'review')).toBe(aider.exec);
    expect(buildCommand(aider, 'review', 'p', '/repo', 180, 'aider').args)
      .toEqual(buildCommand(aider, 'exec', 'p', '/repo', 180, 'aider').args);
  });

  it('never falls back for exec or agent — a missing block stays a real capability gap', () => {
    const reviewOnly = { id: 'ro', review: { args: ['{prompt}'] } } as any;
    expect(resolveModeConfig(reviewOnly, 'exec')).toBeNull();
    expect(resolveModeConfig(reviewOnly, 'agent')).toBeNull();
    expect(() => buildCommand(reviewOnly, 'agent', 'p', '/repo', 180, 'ro')).toThrow(/does not support mode/);
  });

  it('no builtin engine REGRESSES: every engine\'s review command is either its own review block or exactly its exec command', () => {
    const files = readdirSync(ENGINES_DIR).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const raw = JSON.parse(readFileSync(join(ENGINES_DIR, file), 'utf-8'));
      const result = validateEngineConfig(raw, file);
      expect(result.ok, `${file} must validate`).toBe(true);
      const engine = (result as any).data;
      if (!engine.exec) continue;
      const resolved = resolveModeConfig(engine, 'review');
      expect(resolved, `${file} must resolve a review command`).not.toBeNull();
      // Either the engine declared its own review block, or it fell back to exec.
      expect(resolved === engine.review || resolved === engine.exec).toBe(true);
      // A declared review block must still carry the prompt — an engine whose
      // review args drop {prompt} would review the working tree instead of the
      // self-contained diff the seat pasted in.
      if (engine.review && engine.review.args.length > 0) {
        expect(engine.review.args, `${file} review args must carry {prompt}`).toContain('{prompt}');
      }
    }
  });
});

// --- (2) non-agentic framing: config-driven AND scoped ------------------

describe('non-agentic OUTPUT RULES framing (config-driven, no engine ids)', () => {
  const reviewScoped = {
    id: 'anything',
    nonAgenticFraming: 'review',
    exec: { args: ['--print', '{prompt}'] },
    review: { args: ['--print', '{prompt}'] },
    agent: { args: ['--print', '{prompt}'] },
  } as any;

  const allScoped = {
    id: 'legacy',
    nonAgenticFraming: 'all',
    exec: { args: ['--print', '{prompt}'] },
    review: { args: ['--print', '{prompt}'] },
    agent: { args: ['--print', '{prompt}'] },
  } as any;

  it("scope 'review' frames ONLY review dispatches", () => {
    expect(nonAgenticFramingKind(reviewScoped, 'review')).toBe('review');
    const { args } = buildCommand(reviewScoped, 'review', 'REVIEW THIS', '/repo', 180, 'x');
    const prompt = args[args.length - 1];
    expect(prompt.startsWith('OUTPUT RULES (important):')).toBe(true);
    expect(prompt).toContain('REVIEW THIS');
  });

  it("scope 'review' leaves ordinary exec dispatch (brainstorm/tribunal/Cesar) UNTOUCHED", () => {
    // The whole point of the scope: blanket-framing every claude exec dispatch
    // would strip tools from work that legitimately needs them.
    expect(nonAgenticFramingKind(reviewScoped, 'exec')).toBe('none');
    expect(buildCommand(reviewScoped, 'exec', 'ASK', '/repo', 180, 'x').args)
      .toEqual(['--print', 'ASK']);
  });

  it("scope 'all' frames both exec and review — but a review gets the REVIEW text", () => {
    // The scope says WHETHER to frame; the mode says WHICH text. Handing a review
    // the single-pass string would tell it "do not reference any files" while the
    // review contract requires a file:line citation on every finding.
    expect(nonAgenticFramingKind(allScoped, 'exec')).toBe('single-pass');
    expect(nonAgenticFramingKind(allScoped, 'review')).toBe('review');
    expect(applyNonAgenticFraming(allScoped, 'review', 'REVIEW THIS'))
      .toBe(REVIEW_FRAMING + 'REVIEW THIS');
  });

  it("agy's NON-review framing stays byte-identical under the review-text change", () => {
    const agy = { id: 'agy', nonAgenticFraming: 'all', exec: { args: ['{prompt}'] } } as any;
    expect(applyNonAgenticFraming(agy, 'exec', 'ASK')).toBe(SINGLE_PASS_FRAMING + 'ASK');
    expect(nonAgenticFramingKind(agy, 'exec')).toBe('single-pass');
  });

  it('leaves agent mode agentic on purpose, under either scope', () => {
    for (const e of [reviewScoped, allScoped]) {
      expect(nonAgenticFramingKind(e, 'agent')).toBe('none');
      expect(buildCommand(e, 'agent', 'DO IT', '/repo', 180, 'x').args)
        .toEqual(['--print', 'DO IT']);
    }
  });

  it('never touches an engine that does not declare the field', () => {
    const plain = { id: 'plain', exec: { args: ['{prompt}'] }, review: { args: ['{prompt}'] } } as any;
    expect(nonAgenticFramingKind(plain, 'exec')).toBe('none');
    expect(nonAgenticFramingKind(plain, 'review')).toBe('none');
    expect(buildCommand(plain, 'review', 'p', '/repo', 180, 'x').args).toEqual(['p']);
  });

  it("agy's exec framing is BYTE-IDENTICAL to the pre-fix hardcoded string", () => {
    const agy = { id: 'agy', nonAgenticFraming: 'all', exec: { args: ['{prompt}'] } } as any;
    const prompt = buildCommand(agy, 'exec', 'ASK', '/repo', 180, 'agy').args[0];
    expect(prompt).toBe(
      'OUTPUT RULES (important): Reply with your COMPLETE final answer as plain text in THIS response only. '
      + 'Do NOT create, write, edit, or reference any files or artifacts. '
      + 'Do NOT ask clarifying questions — make reasonable assumptions and proceed. '
      + 'Do NOT use slash commands or start an interactive session. '
      + 'Do all the work in a single pass and output the final result directly as text now.\n\n'
      + 'ASK',
    );
  });

  it('the REVIEW framing does not contradict the review contract', () => {
    // The single-pass text says "do not reference any files" — fatal for a review,
    // whose every finding must cite file:line. The review text must ban ACTING
    // (commands/builds/tests/edits) while REQUIRING citations.
    expect(SINGLE_PASS_FRAMING).toContain('reference any files');
    expect(REVIEW_FRAMING).not.toContain('reference any files');
    expect(REVIEW_FRAMING).toContain('Do NOT run any commands, builds, or tests');
    expect(REVIEW_FRAMING).toContain('file:line');
    expect(REVIEW_FRAMING).toContain('single pass');
  });

  it('the field survives zod validation (z.object silently strips unmodelled keys)', () => {
    const expected: Record<string, string> = { 'claude.json': 'review', 'agy.json': 'all' };
    for (const [file, scope] of Object.entries(expected)) {
      const raw = JSON.parse(readFileSync(join(ENGINES_DIR, file), 'utf-8'));
      const result = validateEngineConfig(raw, file);
      expect(result.ok).toBe(true);
      expect((result as any).data.nonAgenticFraming, `${file} must keep nonAgenticFraming`).toBe(scope);
    }
  });
});

// --- (2b) the review seat must not be handed tool-execution powers ------

describe('review seats are not privileged', () => {
  it('claude review args carry NO permission bypass', () => {
    const raw = JSON.parse(readFileSync(join(ENGINES_DIR, 'claude.json'), 'utf-8'));
    // A review seat is fed an UNTRUSTED diff. Combining "skip every permission
    // prompt" with attacker-influenced text is remote code execution by prompt
    // injection; the seat has no legitimate need to act, only to read and report.
    expect(raw.review.args).not.toContain('--dangerously-skip-permissions');
    // The larger turn budget (the actual fix) stays.
    expect(raw.review.args[raw.review.args.indexOf('--max-turns') + 1]).toBe('50');
  });

  it('agy records WHY its review block keeps the print-mode permission flag', () => {
    // ACCEPTED RISK, verified empirically: with the flag absent, agy --print does
    // not degrade to a denied tool — the first permission request aborts the whole
    // run with no answer. It is agy's print baseline (exec/agent carry it too), and
    // the seat's containment is the non-agentic review framing, not the flag.
    const raw = JSON.parse(readFileSync(join(ENGINES_DIR, 'agy.json'), 'utf-8'));
    expect(raw.review.args).toContain('--dangerously-skip-permissions');
    expect(raw.exec.args, 'must remain the exec baseline, not a review escalation')
      .toContain('--dangerously-skip-permissions');
    expect(String(raw.review._comment)).toMatch(/permission check failed|print-mode baseline|PRINT-MODE BASELINE/i);
  });

  it('NO engine\'s review block grants privilege its exec block did not already have', () => {
    // Making the `review` blocks live (the point of this branch) must not hand any
    // seat MORE power than it had when every review ran through `exec`. agy, for
    // instance, needs --dangerously-skip-permissions just to run --print at all —
    // that is its long-standing exec baseline, not an escalation. What is banned is
    // a privilege flag that appears in review and NOT in exec.
    const PRIVILEGE = /dangerously|bypass-approvals|yolo|--full-auto/i;
    const files = readdirSync(ENGINES_DIR).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const raw = JSON.parse(readFileSync(join(ENGINES_DIR, file), 'utf-8'));
      const reviewArgs: string[] = raw.review?.args ?? [];
      const execArgs: string[] = raw.exec?.args ?? [];
      for (const a of reviewArgs) {
        if (!PRIVILEGE.test(a)) continue;
        expect(execArgs, `${file}: review grants "${a}" that exec does not`).toContain(a);
      }
    }
  });
});

// --- (2c) the pty backend gets the same treatment as the spawned one ----

describe('claude pty path routes through the same mode + framing logic', () => {
  let savedChannel: string | undefined;
  beforeEach(() => {
    savedChannel = process.env.AGON_CLAUDE_ANSWER_CHANNEL;
    delete process.env.AGON_CLAUDE_ANSWER_CHANNEL; // unset → the default 'file' channel
  });
  afterEach(() => {
    if (savedChannel === undefined) delete process.env.AGON_CLAUDE_ANSWER_CHANNEL;
    else process.env.AGON_CLAUDE_ANSWER_CHANNEL = savedChannel;
  });

  const claudePty = {
    id: 'claude',
    nonAgenticFraming: 'review',
    exec: { args: ['--print', '{prompt}'] },
    review: { args: ['--print', '--max-turns', '50', '{prompt}'] },
    agent: { args: ['--print', '{prompt}'] },
  } as any;

  it('frames a REVIEW pty dispatch exactly like the spawned one', () => {
    const plan = planClaudePtyDispatch(claudePty, 'review', 'REVIEW THIS');
    expect(plan.prompt).toBe(applyNonAgenticFraming(claudePty, 'review', 'REVIEW THIS'));
    expect(plan.prompt.startsWith('OUTPUT RULES (important):')).toBe(true);
    expect(plan.prompt).toContain('file:line');
    // The pty drives the interactive TUI: a review still runs in an exec session.
    expect(plan.sessionMode).toBe('exec');
  });

  it('leaves exec and agent pty dispatches byte-identical', () => {
    expect(planClaudePtyDispatch(claudePty, 'exec', 'ASK'))
      .toEqual({ sessionMode: 'exec', prompt: 'ASK', useFileChannel: true });
    expect(planClaudePtyDispatch(claudePty, 'agent', 'BUILD IT'))
      .toEqual({ sessionMode: 'agent', prompt: 'BUILD IT', useFileChannel: true });
  });

  it('SUPPRESSES the file answer-channel for a pty review (it contradicts the framing)', () => {
    // A review's pty SESSION mode is 'exec', and the answer channel keys off the
    // session mode — so without an explicit veto the prompt would carry both
    // "Do NOT create, write, or edit any files" (framing) and "use your Write tool
    // to write your answer to <path>" (channel). An agentic CLI handed that
    // contradiction burns its turn budget on it: the exact exhaustion this fixes.
    const plan = planClaudePtyDispatch(claudePty, 'review', 'REVIEW THIS');
    expect(plan.sessionMode).toBe('exec');
    expect(plan.useFileChannel).toBe(false);
    expect(useFileChannelForDispatch('review')).toBe(false);
    // The prompt the pty actually sends: framing present, Write instruction absent.
    const sent = plan.useFileChannel
      ? plan.prompt + fileChannelInstruction('/tmp/answer.md')
      : plan.prompt;
    expect(sent).toContain(REVIEW_FRAMING);
    expect(sent).not.toContain('use your Write tool');
    expect(sent).not.toContain('[ANSWER DELIVERY — REQUIRED]');
  });

  it('keeps the answer channel for non-review pty dispatches', () => {
    expect(useFileChannelForDispatch('exec')).toBe(true);
    expect(useFileChannelForDispatch('agent')).toBe(true);
  });

  it('fails loudly for a mode the engine does not declare, instead of silently running exec', () => {
    const agentless = { id: 'x', exec: { args: ['{prompt}'] } } as any;
    expect(() => planClaudePtyDispatch(agentless, 'agent', 'p')).toThrow(/does not support mode/);
  });
});

// --- (3) honest max_turns diagnostics -----------------------------------

const MAX_TURNS_STREAM = [
  '{"type":"system","subtype":"init","session_id":"abc"}',
  '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{}}]}}',
  '{"type":"result","subtype":"error_max_turns","is_error":true,"num_turns":10,"total_cost_usd":2.64}',
].join('\n') + '\n';

describe('stream-json terminal-reason parsing', () => {
  it('names error_max_turns and marks it deterministic', () => {
    const failure = parseStreamJsonFailure(MAX_TURNS_STREAM, true);
    expect(failure).not.toBeNull();
    expect(failure!.subtype).toBe('error_max_turns');
    expect(failure!.deterministic).toBe(true);
    expect(failure!.message).toContain('error_max_turns');
    expect(failure!.message).toContain('--max-turns');
  });

  it('carries an is_error errors[] payload through', () => {
    const failure = parseStreamJsonFailure(
      '{"type":"result","is_error":true,"errors":[{"message":"tool crashed"},"and again"]}',
      true,
    );
    expect(failure!.message).toContain('tool crashed');
    expect(failure!.message).toContain('and again');
    expect(failure!.deterministic).toBe(false);
  });

  it('returns null for a clean stream, plain text, and a superseding success result', () => {
    expect(parseStreamJsonFailure('', true)).toBeNull();
    expect(parseStreamJsonFailure('just some prose from codex\nline two', true)).toBeNull();
    expect(parseStreamJsonFailure('{"type":"result","subtype":"success","result":"all good"}', true)).toBeNull();
    expect(parseStreamJsonFailure(
      '{"type":"result","subtype":"error_max_turns","is_error":true}\n'
      + '{"type":"result","subtype":"success","result":"retried inline"}',
      true,
    )).toBeNull();
  });

  it('tolerates a truncated/garbage tail without throwing', () => {
    expect(() => parseStreamJsonFailure('{"type":"resul', true)).not.toThrow();
    expect(parseStreamJsonFailure('{"ty' + MAX_TURNS_STREAM, true)!.subtype).toBe('error_max_turns');
  });

  it('is INERT unless the dispatch actually ran in stream-json output mode', () => {
    // Every non-stream-json engine returns prose. Scanning it for envelopes can
    // only produce false positives, and a false positive here both discards a real
    // review AND suppresses its retry.
    expect(parseStreamJsonFailure(MAX_TURNS_STREAM, false)).toBeNull();
  });

  it('does NOT misread a prose review that QUOTES a result envelope', () => {
    // Reviews of this very code quote the envelope verbatim. Only the FINAL
    // non-empty line is inspected, so a quote mid-review is just text — and a
    // review that ENDS on a quoted line is still prose from a prose engine.
    const quoting = [
      'The seat failed with:',
      '',
      '    {"type":"result","subtype":"error_max_turns","is_error":true}',
      '',
      'which the handler should surface by name.',
      '<!--AGON_REVIEW_FINDINGS_v1-->',
      '```json',
      '[]',
      '```',
    ].join('\n');
    expect(parseStreamJsonFailure(quoting, true)).toBeNull();
    expect(parseStreamJsonFailure(quoting, false)).toBeNull();
    // Same envelope, quoted as the very last line, from a prose engine.
    const trailingQuote = 'It ended with {"type":"result","subtype":"error_max_turns"}\nSee above.';
    expect(parseStreamJsonFailure(trailingQuote, true)).toBeNull();
  });

  it('requires a real top-level ENVELOPE, not any object saying type:"result"', () => {
    expect(parseStreamJsonFailure('{"type":"result"}', true)).toBeNull();
    expect(parseStreamJsonFailure('{"type":"result","payload":{"is_error":true}}', true)).toBeNull();
    // An embedded envelope inside a larger message is not the terminal envelope.
    expect(parseStreamJsonFailure(
      '{"type":"assistant","message":{"text":"{\\"type\\":\\"result\\",\\"is_error\\":true}"}}',
      true,
    )).toBeNull();
  });

  it('still fails on a REAL terminal envelope at the end of a stream-json stream', () => {
    const realStream = [
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Reading the diff..."}]}}',
      '{"type":"result","subtype":"error_max_turns","is_error":true}',
      '',
    ].join('\n');
    expect(parseStreamJsonFailure(realStream, true)!.subtype).toBe('error_max_turns');
  });
});

// --- (3b) prompt-borne reviews never hit a companion's NATIVE review path ----

describe('prompt-borne review vs native working-tree review', () => {
  it('mode review alone does NOT trigger the native review call', () => {
    // codex review/start targets uncommittedChanges and DROPS the prompt, so the
    // seat would review the working tree instead of the diff it pasted in.
    expect(companionUsesNativeReview('review', undefined)).toBe(false);
    expect(companionUsesNativeReview('exec', undefined)).toBe(false);
    expect(companionUsesNativeReview('agent', undefined)).toBe(false);
  });

  it('native review is opt-in via an explicit working-tree target', () => {
    expect(companionUsesNativeReview('review', 'uncommittedChanges')).toBe(true);
    // The target is meaningless outside review mode.
    expect(companionUsesNativeReview('exec', 'uncommittedChanges')).toBe(false);
  });
});

describe('runReviewCore surfaces the max_turns reason instead of "exit 1"', () => {
  const diff = 'diff --git a/foo.ts b/foo.ts\n@@ -0,0 +1 @@\n+foo';
  // The terminal-envelope scan only applies to a dispatch that really speaks
  // stream-json, so the fake engine must declare the review block that does.
  const CLAUDE_SEAT = { id: 'claude', review: { args: ['--print', '--output-format', 'stream-json', '{prompt}'] } };
  // A prose engine: whatever it says, it is text, not a machine envelope.
  const CODEX_SEAT = { id: 'codex', exec: { args: ['exec', '{prompt}'] }, review: { args: ['exec', '{prompt}'] } };
  const ctx = {
    config: { reviewFileContext: false },
    registry: { get: () => ({ ...CLAUDE_SEAT, name: 'claude' }) },
    adapter: {
      dispatchStream: (_opts: unknown) => (async function* () {
        yield MAX_TURNS_STREAM;
        return { exitCode: 1, stdout: '', stderr: '', timedOut: false };
      })(),
    },
  } as any;

  it('throws the named reason, not the generic exit code', async () => {
    await expect(runReviewCore(diff, 'label', 'claude', ctx)).rejects.toThrow(/error_max_turns/);
    await expect(runReviewCore(diff, 'label', 'claude', ctx)).rejects.not.toThrow(/^exit 1$/);
  });

  it('dispatches the review seat in review mode, prompt-borne (no native review target)', async () => {
    let seenMode = '';
    let seenTarget: unknown = 'unset';
    const spyCtx = {
      config: { reviewFileContext: false },
      registry: { get: () => CLAUDE_SEAT },
      adapter: {
        dispatchStream: (opts: any) => (async function* () {
          seenMode = opts.mode;
          seenTarget = opts.reviewTarget;
          yield 'Looks fine.\n<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```';
          return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
        })(),
      },
    } as any;
    await runReviewCore(diff, 'label', 'claude', spyCtx);
    expect(seenMode).toBe('review');
    // The seat pastes a self-contained diff INTO the prompt, so it must never ask
    // for a native working-tree review (which drops the prompt entirely).
    expect(seenTarget).toBeUndefined();
  });

  it('a PROSE review that quotes a result envelope still passes as a success', async () => {
    // The false positive this guards: rawTail scanning is engine-blind, so a codex
    // review discussing the very envelope this branch parses used to be reported as
    // a terminal dispatch failure — and its retry suppressed as "deterministic".
    const quotingCtx = {
      config: { reviewFileContext: false },
      registry: { get: () => CODEX_SEAT },
      adapter: {
        dispatchStream: (_opts: unknown) => (async function* () {
          yield 'The seat dies on:\n{"type":"result","subtype":"error_max_turns","is_error":true}\n';
          yield 'Fix: raise --max-turns.\n<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```';
          return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
        })(),
      },
    } as any;
    const result = await runReviewCore(diff, 'label', 'codex', quotingCtx);
    expect(result.response).toContain('Fix: raise --max-turns.');
  });

  it('FAILS the seat when a terminal result envelope follows partial text', async () => {
    // The dangerous case: claude emits a preamble, then runs out of turns. The
    // preamble contains no findings block, so the repair path would turn it into
    // `[]` — a review that never happened reported as a clean PASS. The terminal
    // envelope must win, with the partial text attached for diagnosis.
    const partialCtx = {
      config: { reviewFileContext: false },
      registry: { get: () => CLAUDE_SEAT },
      adapter: {
        dispatchStream: (_opts: unknown) => (async function* () {
          yield '{"type":"assistant","message":{"content":[{"type":"text","text":"Let me start by reading the diff and the surrounding files."}]}}\n';
          yield '{"type":"result","subtype":"error_max_turns","is_error":true}\n';
          return { exitCode: 1, stdout: '', stderr: '', timedOut: false };
        })(),
      },
    } as any;
    await expect(runReviewCore(diff, 'label', 'claude', partialCtx)).rejects.toThrow(/error_max_turns/);
    await expect(runReviewCore(diff, 'label', 'claude', partialCtx))
      .rejects.toThrow(/Let me start by reading the diff/);
  });

  it('a clean stream with a SUCCESS result envelope still passes', async () => {
    // Guard against over-correcting: only a FAILING terminal envelope fails the
    // seat. A normal successful review must be unaffected.
    const okCtx = {
      config: { reviewFileContext: false },
      registry: { get: () => CLAUDE_SEAT },
      adapter: {
        dispatchStream: (_opts: unknown) => (async function* () {
          yield 'Looks fine.\n<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```\n';
          yield '{"type":"result","subtype":"success","is_error":false}\n';
          return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
        })(),
      },
    } as any;
    const result = await runReviewCore(diff, 'label', 'claude', okCtx);
    expect(result.response).toContain('Looks fine.');
  });
});

// --- (4) no doomed retry -------------------------------------------------

describe('deterministic failures are never retried', () => {
  it('recognises a deterministic subtype inside a wrapped message', () => {
    expect(isDeterministicStreamFailure('claude returned no review — error_max_turns: …')).toBe(true);
    expect(isDeterministicStreamFailure('exit 1')).toBe(false);
    expect(isDeterministicStreamFailure('')).toBe(false);
  });

  it('skips the retry for max_turns but keeps it for a transient error', () => {
    expect(shouldRetryReviewAttempt('error', 150, 'claude returned no review — error_max_turns: …')).toBe(false);
    expect(shouldRetryReviewAttempt('error', 150, 'API stream idle timeout after 90s')).toBe(true);
  });

  it('preserves the existing budget/kind gates', () => {
    expect(shouldRetryReviewAttempt('error', 150)).toBe(true);
    expect(shouldRetryReviewAttempt('error', 4, 'transient')).toBe(false);
    expect(shouldRetryReviewAttempt('timeout', 150, 'transient')).toBe(false);
    expect(shouldRetryReviewAttempt('ok', 150)).toBe(false);
  });
});
