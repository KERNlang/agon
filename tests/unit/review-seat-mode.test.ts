import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildCommand,
  resolveModeConfig,
  nonAgenticFramingKind,
  applyNonAgenticFraming,
  planClaudePtyDispatch,
  SINGLE_PASS_FRAMING,
  REVIEW_FRAMING,
} from '../../packages/adapter-cli/src/generated/adapter-helpers.js';
import {
  parseStreamJsonFailure,
  isDeterministicStreamFailure,
} from '../../packages/core/src/generated/blocks/stream-parser.js';
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

  it("scope 'all' still frames both exec and review", () => {
    expect(nonAgenticFramingKind(allScoped, 'exec')).toBe('single-pass');
    expect(nonAgenticFramingKind(allScoped, 'review')).toBe('single-pass');
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
      .toEqual({ sessionMode: 'exec', prompt: 'ASK' });
    expect(planClaudePtyDispatch(claudePty, 'agent', 'BUILD IT'))
      .toEqual({ sessionMode: 'agent', prompt: 'BUILD IT' });
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
    const failure = parseStreamJsonFailure(MAX_TURNS_STREAM);
    expect(failure).not.toBeNull();
    expect(failure!.subtype).toBe('error_max_turns');
    expect(failure!.deterministic).toBe(true);
    expect(failure!.message).toContain('error_max_turns');
    expect(failure!.message).toContain('--max-turns');
  });

  it('carries an is_error errors[] payload through', () => {
    const failure = parseStreamJsonFailure(
      '{"type":"result","is_error":true,"errors":[{"message":"tool crashed"},"and again"]}',
    );
    expect(failure!.message).toContain('tool crashed');
    expect(failure!.message).toContain('and again');
    expect(failure!.deterministic).toBe(false);
  });

  it('returns null for a clean stream, plain text, and a superseding success result', () => {
    expect(parseStreamJsonFailure('')).toBeNull();
    expect(parseStreamJsonFailure('just some prose from codex\nline two')).toBeNull();
    expect(parseStreamJsonFailure('{"type":"result","subtype":"success","result":"all good"}')).toBeNull();
    expect(parseStreamJsonFailure(
      '{"type":"result","subtype":"error_max_turns","is_error":true}\n'
      + '{"type":"result","subtype":"success","result":"retried inline"}',
    )).toBeNull();
  });

  it('tolerates a truncated/garbage tail without throwing', () => {
    expect(() => parseStreamJsonFailure('{"type":"resul')).not.toThrow();
    expect(parseStreamJsonFailure('{"ty' + MAX_TURNS_STREAM)!.subtype).toBe('error_max_turns');
  });
});

describe('runReviewCore surfaces the max_turns reason instead of "exit 1"', () => {
  const diff = 'diff --git a/foo.ts b/foo.ts\n@@ -0,0 +1 @@\n+foo';
  const ctx = {
    config: { reviewFileContext: false },
    registry: { get: () => ({ id: 'claude', name: 'claude' }) },
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

  it('dispatches the review seat in review mode', async () => {
    let seenMode = '';
    const spyCtx = {
      config: { reviewFileContext: false },
      registry: { get: () => ({ id: 'claude' }) },
      adapter: {
        dispatchStream: (opts: any) => (async function* () {
          seenMode = opts.mode;
          yield 'Looks fine.\n<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```';
          return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
        })(),
      },
    } as any;
    await runReviewCore(diff, 'label', 'claude', spyCtx);
    expect(seenMode).toBe('review');
  });

  it('FAILS the seat when a terminal result envelope follows partial text', async () => {
    // The dangerous case: claude emits a preamble, then runs out of turns. The
    // preamble contains no findings block, so the repair path would turn it into
    // `[]` — a review that never happened reported as a clean PASS. The terminal
    // envelope must win, with the partial text attached for diagnosis.
    const partialCtx = {
      config: { reviewFileContext: false },
      registry: { get: () => ({ id: 'claude' }) },
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
      registry: { get: () => ({ id: 'claude' }) },
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
