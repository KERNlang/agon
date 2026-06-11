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
});

describe('isGateSkipSignal — user waiver phrases', () => {
  it('detects skip/no-need/later phrasing', () => {
    expect(isGateSkipSignal('skip it')).toBe(true);
    expect(isGateSkipSignal('no need to run the tests')).toBe(true);
    expect(isGateSkipSignal("don't bother with the gate")).toBe(true);
    expect(isGateSkipSignal('later')).toBe(true);
    expect(isGateSkipSignal('skip the gate')).toBe(true);
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
    if (session.gateNudgedClaim && isGateSkipSignal('no need, skip it')) session.gateWaived = true;
    expect(session.gateWaived).toBe(true);
    expect(shouldGateNudge(gate, session, { ranGate: false, wroteFiles: true, toolCount: 3, resp: 'Done.' })).toBe(false);
  });
});
