import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverGate, bashRanGate, isGateSkipSignal } from '@kernlang/agon-core';
import type { DiscoveredGate } from '@kernlang/agon-core';

// ── Helpers ──────────────────────────────────────────────────────────
function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), 'agon-gate-'));
}
function writePkg(dir: string, scripts: Record<string, string>): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts }, null, 2));
}

describe('discoverGate — package.json scripts', () => {
  let dir: string;
  beforeEach(() => { dir = tmpProject(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns gateAbsent (empty command) when there is no package.json', () => {
    const g = discoverGate(dir);
    expect(g.command).toBe('');
    expect(g.matchers).toEqual([]);
    expect(g.source).toBe('none');
  });

  it('returns gateAbsent when package.json has no recognized scripts', () => {
    writePkg(dir, { start: 'node .', dev: 'vite' });
    const g = discoverGate(dir);
    expect(g.command).toBe('');
    expect(g.source).toBe('none');
  });

  it('picks the test script as the command and derives loose matchers', () => {
    writePkg(dir, { test: 'vitest run' });
    const g = discoverGate(dir);
    expect(g.command).toBe('npm run test');
    expect(g.source).toBe('package-scripts');
    // alias forms + the runner token
    expect(g.matchers).toContain('npm run test');
    expect(g.matchers).toContain('test');
    expect(g.matchers).toContain('npm test');
    expect(g.matchers).toContain('vitest');
  });

  it('prefers fitness over test when both present', () => {
    writePkg(dir, { test: 'vitest run', fitness: 'npm run build && vitest run' });
    const g = discoverGate(dir);
    expect(g.command).toBe('npm run fitness');
    // ALL present scripts contribute matchers, so 'test' still counts as ranGate
    expect(g.matchers).toContain('fitness');
    expect(g.matchers).toContain('test');
  });

  it('falls back to typecheck when no test/fitness, exposing tsc as a matcher', () => {
    writePkg(dir, { typecheck: 'tsc --noEmit', lint: 'eslint .' });
    const g = discoverGate(dir);
    expect(g.command).toBe('npm run typecheck');
    expect(g.matchers).toContain('typecheck');
    expect(g.matchers).toContain('tsc');
    // lint present too → its alias + runner contribute matchers
    expect(g.matchers).toContain('lint');
    expect(g.matchers).toContain('eslint');
  });
});

describe('discoverGate — fitness: override in a project brief', () => {
  let dir: string;
  beforeEach(() => { dir = tmpProject(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('an AGON.md fitness: line overrides package.json scripts', () => {
    writePkg(dir, { test: 'vitest run' });
    writeFileSync(join(dir, 'AGON.md'), '# Project\n\nfitness: npm run build && npm test\n');
    const g = discoverGate(dir);
    expect(g.source).toBe('fitness-override');
    expect(g.command).toBe('npm run build && npm test');
    // matchers derived from BOTH sub-commands of the override
    expect(g.matchers).toContain('build');
    expect(g.matchers.some((m) => m.includes('npm test'))).toBe(true);
  });

  it('.agon/project.md outranks AGON.md (first in the cascade wins)', () => {
    mkdirSync(join(dir, '.agon'));
    writeFileSync(join(dir, '.agon', 'project.md'), 'fitness: pnpm verify\n');
    writeFileSync(join(dir, 'AGON.md'), 'fitness: npm test\n');
    const g = discoverGate(dir);
    expect(g.command).toBe('pnpm verify');
    expect(g.matchers).toContain('verify');
  });

  it('tolerates a leading markdown bullet on the fitness: line', () => {
    writeFileSync(join(dir, 'AGON.md'), '## Commands\n- fitness: make test\n');
    const g = discoverGate(dir);
    expect(g.command).toBe('make test');
  });

  it('an existing brief WITHOUT a fitness: line does NOT override package scripts', () => {
    writePkg(dir, { test: 'vitest run' });
    writeFileSync(join(dir, 'AGON.md'), '# Project\nNo gate line here.\n');
    const g = discoverGate(dir);
    expect(g.source).toBe('package-scripts');
    expect(g.command).toBe('npm run test');
  });
});

describe('bashRanGate — loose matching', () => {
  const matchers = ['npm run test', 'test', 'npm test', 'vitest'];

  it('matches the exact npm script invocation', () => {
    expect(bashRanGate('npm test', matchers)).toBe(true);
    expect(bashRanGate('npm run test', matchers)).toBe(true);
  });

  it('matches the bare runner inside a longer command', () => {
    expect(bashRanGate('npx vitest run packages/core', matchers)).toBe(true);
    expect(bashRanGate('cd foo && npm test -- --watch=false', matchers)).toBe(true);
  });

  it('does NOT match unrelated commands', () => {
    expect(bashRanGate('ls', matchers)).toBe(false);
    expect(bashRanGate('git status', matchers)).toBe(false);
    expect(bashRanGate('echo done', matchers)).toBe(false);
  });

  it('returns false when there are no matchers (gateAbsent)', () => {
    expect(bashRanGate('npm test', [])).toBe(false);
  });

  // F3: bare single-word matchers ('test'/'build'/'lint'/runner tokens) must match
  // ONLY as a standalone token in COMMAND POSITION — not when they appear as an
  // argument or substring — so the nudge isn't silently suppressed by everyday
  // commands that merely mention the word.
  describe('F3 — bare matchers only count in command position', () => {
    const m = ['npm run test', 'test', 'npm test', 'vitest', 'build', 'lint', 'tsc'];

    it('POSITIVES: real gate invocations still count', () => {
      expect(bashRanGate('npm test', m)).toBe(true);
      expect(bashRanGate('npm run test && echo ok', m)).toBe(true);
      expect(bashRanGate('yarn lint', m)).toBe(true);
      expect(bashRanGate('yarn test', m)).toBe(true);
      expect(bashRanGate('pnpm run build', m)).toBe(true);
      expect(bashRanGate('vitest run', m)).toBe(true); // bare runner as the command
      expect(bashRanGate('tsc --noEmit', m)).toBe(true);
    });

    it('NEGATIVES: the alias as an argument/substring does NOT count', () => {
      expect(bashRanGate('ls tests/', m)).toBe(false);
      expect(bashRanGate('git commit -m "add tests"', m)).toBe(false);
      expect(bashRanGate('cat latest.log', m)).toBe(false);
      expect(bashRanGate('grep test foo', m)).toBe(false);
      expect(bashRanGate('npm testify', m)).toBe(false);
    });
  });
});

describe('isGateSkipSignal — user waiver phrases', () => {
  it('detects gate/test/verification skip phrasing', () => {
    expect(isGateSkipSignal('skip it')).toBe(true);
    expect(isGateSkipSignal('no need to run the tests')).toBe(true);
    expect(isGateSkipSignal("don't bother with the gate")).toBe(true);
    expect(isGateSkipSignal('skip the gate')).toBe(true);
    expect(isGateSkipSignal('no need to test this')).toBe(true);
    expect(isGateSkipSignal('skip verification')).toBe(true);
  });

  // F4: bare 'later' (and other unanchored phrases) dropped — they let an unrelated
  // "we'll do docs later" permanently waive the gate.
  it('does NOT fire on bare "later" or unrelated phrases', () => {
    expect(isGateSkipSignal('later')).toBe(false);
    expect(isGateSkipSignal("we'll do docs later")).toBe(false);
    expect(isGateSkipSignal('nevermind')).toBe(false);
    expect(isGateSkipSignal('leave it for now')).toBe(false);
  });

  it('does NOT fire on normal task input', () => {
    expect(isGateSkipSignal('add a new endpoint')).toBe(false);
    expect(isGateSkipSignal('fix the failing test')).toBe(false);
    expect(isGateSkipSignal('run the tests')).toBe(false);
  });
});

// ── Nudge decision state-machine ─────────────────────────────────────
// Models the _shouldGateNudge predicate + one-nudge-per-claim guard from
// brain.kern against the documented contract: nudge once per distinct
// done-claim when (gate exists) && !waived && !ranGate && wroteFiles &&
// claim-not-already-nudged. gateAbsent or waiver → never.
type GateSession = { gateWaived?: boolean; gateNudgedClaim?: string };
function claimSignature(toolCount: number, respTail: string): string {
  return `${toolCount}:${respTail.trim().slice(-200)}`;
}
function shouldGateNudge(
  gate: DiscoveredGate,
  session: GateSession,
  opts: { ranGate: boolean; wroteFiles: boolean; toolCount: number; resp: string },
): boolean {
  if (!gate.command || !gate.matchers.length) return false; // gateAbsent
  if (session.gateWaived) return false;
  if (opts.ranGate) return false;
  if (!opts.wroteFiles) return false;
  if (session.gateNudgedClaim === claimSignature(opts.toolCount, opts.resp)) return false;
  return true;
}

describe('verify-before-done nudge decision', () => {
  const gate: DiscoveredGate = { command: 'npm run test', matchers: ['npm run test', 'test', 'vitest'], source: 'package-scripts' };
  const absent: DiscoveredGate = { command: '', matchers: [], source: 'none' };

  it('fires when Cesar wrote files, claimed done, and never ran the gate', () => {
    const session: GateSession = {};
    expect(shouldGateNudge(gate, session, { ranGate: false, wroteFiles: true, toolCount: 3, resp: 'Done.' })).toBe(true);
  });

  it('does NOT fire if the gate was already run this turn', () => {
    expect(shouldGateNudge(gate, {}, { ranGate: true, wroteFiles: true, toolCount: 3, resp: 'Done.' })).toBe(false);
  });

  it('does NOT fire on a read-only done with no writes', () => {
    expect(shouldGateNudge(gate, {}, { ranGate: false, wroteFiles: false, toolCount: 3, resp: 'Done.' })).toBe(false);
  });

  it('NEVER fires when gate is absent', () => {
    expect(shouldGateNudge(absent, {}, { ranGate: false, wroteFiles: true, toolCount: 3, resp: 'Done.' })).toBe(false);
  });

  it('one nudge per distinct claim: same claim → no repeat, NEW claim → nudges again', () => {
    const session: GateSession = {};
    const firstClaim = { ranGate: false, wroteFiles: true, toolCount: 3, resp: 'Done with the refactor.' };
    expect(shouldGateNudge(gate, session, firstClaim)).toBe(true);
    // Record the nudge (as brain.kern does on inject)
    session.gateNudgedClaim = claimSignature(firstClaim.toolCount, firstClaim.resp);
    // Same claim re-evaluated → suppressed
    expect(shouldGateNudge(gate, session, firstClaim)).toBe(false);
    // A genuinely new done-claim (more tools + different closing) → nudges again
    const secondClaim = { ranGate: false, wroteFiles: true, toolCount: 5, resp: 'Done with the second change.' };
    expect(shouldGateNudge(gate, session, secondClaim)).toBe(true);
  });

  it('waiver stickiness: once gateWaived, no further nudges even for new claims', () => {
    const session: GateSession = { gateWaived: true };
    expect(shouldGateNudge(gate, session, { ranGate: false, wroteFiles: true, toolCount: 3, resp: 'Done.' })).toBe(false);
    expect(shouldGateNudge(gate, session, { ranGate: false, wroteFiles: true, toolCount: 9, resp: 'Done again.' })).toBe(false);
  });

  it('a user skip-signal after a nudge sets the sticky waiver', () => {
    const session: GateSession = { gateNudgedClaim: 'sig' };
    // Mirror brain.kern: skip-signal honored only once a nudge has fired
    if (session.gateNudgedClaim && isGateSkipSignal('skip the gate')) session.gateWaived = true;
    expect(session.gateWaived).toBe(true);
    expect(shouldGateNudge(gate, session, { ranGate: false, wroteFiles: true, toolCount: 3, resp: 'Done.' })).toBe(false);
  });
});

// ── F1: re-nudge loop — signature re-stamp against the MUTATED response ───────
// brain.kern records gateNudgedClaim at inject time (pre-mutation), then the nudge
// handler APPENDS Cesar's reply to `response` before the loop's `continue`. Without
// the F1 re-stamp, the re-entry computes a fresh signature (new tail), misses the
// one-nudge guard, and re-nudges. This models that lifecycle.
describe('F1 — claim signature re-stamped after response mutation', () => {
  const gate: DiscoveredGate = { command: 'npm run test', matchers: ['npm run test', 'test', 'vitest'], source: 'package-scripts' };

  it('a same-claim re-entry does NOT re-nudge once the signature is re-stamped', () => {
    const session: GateSession = {};
    let response = 'Done with the docs change.';
    const toolCount = 3;
    // 1) First evaluation: nudge fires.
    expect(shouldGateNudge(gate, session, { ranGate: false, wroteFiles: true, toolCount, resp: response })).toBe(true);
    // (inject-time stamp, as the OLD code did — pre-mutation)
    session.gateNudgedClaim = claimSignature(toolCount, response);
    // 2) Nudge handler appends Cesar's skip-explanation to `response` (no new tools).
    response = response + '\n\n' + 'Skipping: docs-only change.';
    // OLD behavior (no re-stamp): the stale inject-time sig no longer matches → re-nudge.
    expect(shouldGateNudge(gate, session, { ranGate: false, wroteFiles: true, toolCount, resp: response })).toBe(true);
    // F1 FIX: re-stamp the signature against the MUTATED response before continue.
    session.gateNudgedClaim = claimSignature(toolCount, response);
    // 3) Re-entry with the same (mutated) claim → suppressed, no second nudge.
    expect(shouldGateNudge(gate, session, { ranGate: false, wroteFiles: true, toolCount, resp: response })).toBe(false);
  });

  it('a genuinely NEW claim (different toolCount) still nudges after a re-stamp', () => {
    const session: GateSession = {};
    let response = 'Done with the first change.';
    session.gateNudgedClaim = claimSignature(3, response);
    response = response + '\n\nSkipping: trivial.';
    session.gateNudgedClaim = claimSignature(3, response); // F1 re-stamp
    expect(shouldGateNudge(gate, session, { ranGate: false, wroteFiles: true, toolCount: 3, resp: response })).toBe(false);
    // Later, Cesar does more work and claims done again with more tools → nudges.
    const newClaim = { ranGate: false, wroteFiles: true, toolCount: 6, resp: 'Done with the second change.' };
    expect(shouldGateNudge(gate, session, newClaim)).toBe(true);
  });
});

// ── F2 + F4: per-turn skip-signal window (turn-start lifecycle) ───────────────
// brain.kern turn-start: (F2) a gate-less turn no longer flips gateWaived; (F4) a
// skip-signal is evaluated against the PREVIOUS turn's gateNudgedClaim, then the
// claim is CLEARED — narrowing the waiver to the message immediately after a nudge.
function applyTurnStart(session: GateSession, gate: DiscoveredGate, input: string): void {
  // F2: NO `if (!gate.command) gateWaived = true` here anymore.
  if (session.gateNudgedClaim && isGateSkipSignal(input)) session.gateWaived = true;
  session.gateNudgedClaim = undefined; // F4: clear after evaluating
}

describe('F2 — a gate-less turn does not permanently waive', () => {
  const gate: DiscoveredGate = { command: 'npm run test', matchers: ['npm run test', 'test', 'vitest'], source: 'package-scripts' };

  it('after a gate-less turn, nudge eligibility is restored when a gate reappears', () => {
    const session: GateSession = {};
    // Turn 1: empty dir / non-node project — gateAbsent. With F2, no gateWaived flip.
    applyTurnStart(session, { command: '', matchers: [], source: 'none' }, 'add a feature');
    expect(session.gateWaived).toBeFalsy();
    // Turn 2: a package.json appears → gate present, Cesar claims done w/o running it.
    applyTurnStart(session, gate, 'now finish it');
    expect(shouldGateNudge(gate, session, { ranGate: false, wroteFiles: true, toolCount: 3, resp: 'Done.' })).toBe(true);
  });
});

describe('F4 — skip-signal waiver window is one message after a nudge', () => {
  const gate: DiscoveredGate = { command: 'npm run test', matchers: ['npm run test', 'test', 'vitest'], source: 'package-scripts' };

  it('a skip-reply in the message RIGHT AFTER a nudge → waived', () => {
    const session: GateSession = {};
    // A nudge fired last turn → gateNudgedClaim is set entering this turn.
    session.gateNudgedClaim = claimSignature(3, 'Done.');
    applyTurnStart(session, gate, 'no need to run the tests');
    expect(session.gateWaived).toBe(true);
  });

  it('an unrelated message TWO turns after a nudge does NOT waive', () => {
    const session: GateSession = {};
    // Turn A: a nudge fired → claim set.
    session.gateNudgedClaim = claimSignature(3, 'Done.');
    // Turn A start: user replies with a non-skip message → no waiver, claim cleared.
    applyTurnStart(session, gate, 'looks good, keep going');
    expect(session.gateWaived).toBeFalsy();
    expect(session.gateNudgedClaim).toBeUndefined();
    // Turn B: user says "we'll do docs later" — but no nudge is pending now → NOT waived.
    applyTurnStart(session, gate, "we'll do docs later");
    expect(session.gateWaived).toBeFalsy();
    // Eligibility intact: a fresh done-claim still nudges.
    expect(shouldGateNudge(gate, session, { ranGate: false, wroteFiles: true, toolCount: 4, resp: 'Done.' })).toBe(true);
  });
});
