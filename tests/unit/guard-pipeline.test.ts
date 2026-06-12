import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setupTestAgonHome, cleanupTestAgonHome, agonHomePath } from '../helpers/agon-home.js';

// ── Mode resolution + config reader ───────────────────────────────────
import {
  resolveGuardMode, readGuardModesFromConfig, asGuardMode, DEFAULT_GUARD_MODE,
} from '../../packages/core/src/generated/guards/config.js';
// ── Read-path registry ────────────────────────────────────────────────
import {
  ReadPathRegistry, canonicalizePath, extractResultPaths,
} from '../../packages/core/src/generated/guards/read-path-registry.js';
// ── Grounded-write ────────────────────────────────────────────────────
import {
  consultGroundedWrite, isWriteTool, writeTargetPath,
} from '../../packages/core/src/generated/guards/grounded-write.js';
// ── Evidence ──────────────────────────────────────────────────────────
import {
  consultFinalText, isCompletionClaim, hasUnresolvedFailure, hasEvidence,
  stripNonAssertionSpans, isEvidenceTool,
} from '../../packages/core/src/generated/guards/evidence.js';
// ── Information-gain ──────────────────────────────────────────────────
import {
  computeInfoGain, isStallStep, advanceStall, createInfoGainState, hashBashStdout,
} from '../../packages/core/src/generated/guards/information-gain.js';
// ── Confidence gate ───────────────────────────────────────────────────
import {
  consultConfidenceGate, isRiskyBash, isGatedCall, gatedCategory, BROAD_WRITE_THRESHOLD,
} from '../../packages/core/src/generated/guards/confidence-gate.js';
// ── Pipeline orchestrator ─────────────────────────────────────────────
import {
  consultGuard, consultBatch, applyShadow, countDistinctWriteFiles,
} from '../../packages/core/src/generated/guards/guard-pipeline.js';
import type {
  GuardSnapshot, GuardCall, GuardMode,
} from '../../packages/core/src/generated/guards/guard-types.js';

// ──────────────────────────────────────────────────────────────────────
// Snapshot builder — minimal, overridable.
// ──────────────────────────────────────────────────────────────────────

function snap(over: Partial<GuardSnapshot> = {}): GuardSnapshot {
  return {
    engineId: 'codex',
    step: 1,
    mode: 'invariants',
    readPaths: new Set<string>(),
    everReadPaths: new Set<string>(),
    fileExists: () => true,
    evidence: { successfulNonReadTool: false, diagnosticGreen: false, exhausted: false },
    spin: { consecutiveStallSteps: 0, globalStallSteps: 0 },
    confidence: { lastValue: null, reportedThisTurn: false },
    ...over,
  };
}

// ──────────────────────────────────────────────────────────────────────
// resolveGuardMode — flag precedence.
// ──────────────────────────────────────────────────────────────────────

describe('guard-pipeline — resolveGuardMode precedence', () => {
  it('defaults to strict when nothing specifies a mode', () => {
    expect(resolveGuardMode('codex', undefined, null)).toBe('strict');
    expect(DEFAULT_GUARD_MODE).toBe('strict');
  });

  it('engine `guards` field beats the strict default', () => {
    expect(resolveGuardMode('codex', 'invariants', null)).toBe('invariants');
    expect(resolveGuardMode('codex', 'shadow', null)).toBe('shadow');
  });

  it('user config `default` beats the engine field', () => {
    const cfg = { guardModes: { default: 'shadow' } };
    expect(resolveGuardMode('codex', 'invariants', cfg)).toBe('shadow');
  });

  it('user config per-engine override beats the user default AND the engine field (highest)', () => {
    const cfg = { guardModes: { default: 'shadow', codex: 'invariants' } };
    expect(resolveGuardMode('codex', 'strict', cfg)).toBe('invariants');
    // a DIFFERENT engine falls through to the user default.
    expect(resolveGuardMode('agy', 'strict', cfg)).toBe('shadow');
  });

  it('ignores invalid values at every precedence level and falls through', () => {
    // invalid per-engine → invalid default → valid engine field.
    const cfg = { guardModes: { codex: 'bogus', default: 'nonsense' } };
    expect(resolveGuardMode('codex', 'invariants', cfg)).toBe('invariants');
    // all invalid → strict.
    expect(resolveGuardMode('codex', 'also-bad' as unknown as GuardMode, cfg)).toBe('strict');
  });

  it('asGuardMode validates the three modes and rejects everything else', () => {
    expect(asGuardMode('strict')).toBe('strict');
    expect(asGuardMode('invariants')).toBe('invariants');
    expect(asGuardMode('shadow')).toBe('shadow');
    expect(asGuardMode('off')).toBeNull();
    expect(asGuardMode(undefined)).toBeNull();
    expect(asGuardMode(42)).toBeNull();
  });
});

describe('guard-pipeline — readGuardModesFromConfig (AGON_HOME-aware, best-effort)', () => {
  let home = '';
  beforeEach(() => { home = setupTestAgonHome('guard-config'); });
  afterEach(() => { cleanupTestAgonHome(home); });

  it('returns null when no config.json exists', () => {
    expect(readGuardModesFromConfig()).toBeNull();
  });

  it('returns null when config.json has no guardModes key', () => {
    writeFileSync(agonHomePath('config.json'), JSON.stringify({ someOther: true }));
    expect(readGuardModesFromConfig()).toBeNull();
  });

  it('reads guardModes from config.json and feeds resolveGuardMode', () => {
    writeFileSync(agonHomePath('config.json'), JSON.stringify({ guardModes: { codex: 'invariants', default: 'shadow' } }));
    const cfg = readGuardModesFromConfig();
    expect(cfg).not.toBeNull();
    expect(resolveGuardMode('codex', undefined, cfg)).toBe('invariants');
    expect(resolveGuardMode('agy', undefined, cfg)).toBe('shadow');
  });

  it('never throws on a malformed config.json (returns null)', () => {
    writeFileSync(agonHomePath('config.json'), '{ this is not json');
    expect(() => readGuardModesFromConfig()).not.toThrow();
    expect(readGuardModesFromConfig()).toBeNull();
  });

  it('returns null when guardModes is the wrong type (array)', () => {
    writeFileSync(agonHomePath('config.json'), JSON.stringify({ guardModes: ['nope'] }));
    expect(readGuardModesFromConfig()).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Read-path registry — record / canonicalization / serialize-restore.
// ──────────────────────────────────────────────────────────────────────

describe('guard-pipeline — ReadPathRegistry', () => {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'guard-reg-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('records a Read path (canonicalized) and answers isKnown', () => {
    const f = join(dir, 'a.ts');
    writeFileSync(f, 'export const a = 1;');
    const reg = new ReadPathRegistry();
    reg.record('Read', { file_path: f }, undefined);
    expect(reg.isKnown(f)).toBe(true);
    expect(reg.isKnown(join(dir, 'b.ts'))).toBe(false);
    expect(reg.size()).toBe(1);
  });

  it('records every Glob result path', () => {
    const reg = new ReadPathRegistry();
    const f1 = join(dir, 'x.ts'); const f2 = join(dir, 'y.ts');
    writeFileSync(f1, '1'); writeFileSync(f2, '2');
    reg.record('Glob', {}, [f1, f2]);
    expect(reg.isKnown(f1)).toBe(true);
    expect(reg.isKnown(f2)).toBe(true);
  });

  it('records Grep matched paths by default, and skips them when grepAsRead=false', () => {
    const f = join(dir, 'g.ts');
    writeFileSync(f, 'match');
    const on = new ReadPathRegistry();
    on.record('Grep', {}, [{ path: f }]);
    expect(on.isKnown(f)).toBe(true);

    const off = new ReadPathRegistry({ grepAsRead: false });
    off.record('Grep', {}, [{ path: f }]);
    expect(off.isKnown(f)).toBe(false);
  });

  it('canonicalizes through a symlink so the real path is the membership key', () => {
    const real = join(dir, 'real.ts');
    const link = join(dir, 'link.ts');
    writeFileSync(real, 'export const r = 1;');
    symlinkSync(real, link);
    const reg = new ReadPathRegistry();
    // Read via the SYMLINK.
    reg.record('Read', { file_path: link }, undefined);
    // The canonical (realpath) form is what's stored — both forms resolve to it.
    expect(reg.isKnown(real)).toBe(true);
    expect(reg.isKnown(link)).toBe(true);
    expect(canonicalizePath(link)).toBe(canonicalizePath(real));
  });

  it('serialize() / restore() round-trips the canonical set', () => {
    const f = join(dir, 's.ts');
    writeFileSync(f, '1');
    const reg = new ReadPathRegistry();
    reg.record('Read', { file_path: f }, undefined);
    const serialized = reg.serialize();
    expect(serialized).toHaveLength(1);

    const restored = new ReadPathRegistry();
    restored.restore(serialized);
    expect(restored.isKnown(f)).toBe(true);
    // An old session file without readPaths restores nothing, no throw.
    const empty = new ReadPathRegistry();
    expect(() => empty.restore(undefined as unknown as string[])).not.toThrow();
    expect(empty.size()).toBe(0);
  });

  it('extractResultPaths handles arrays, {path} objects, and newline strings', () => {
    expect(extractResultPaths(['/a', '/b'])).toEqual(['/a', '/b']);
    expect(extractResultPaths([{ path: '/a' }, { file: '/b' }])).toEqual(['/a', '/b']);
    expect(extractResultPaths('/a\n/b\n')).toEqual(['/a', '/b']);
    expect(extractResultPaths({ files: ['/a'] })).toEqual(['/a']);
    expect(extractResultPaths(null)).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Grounded-write — blocked / net-new / read-then-edit / symlink-canonical.
// ──────────────────────────────────────────────────────────────────────

describe('guard-pipeline — grounded-write', () => {
  it('isWriteTool / writeTargetPath cover the write tools and arg shapes', () => {
    expect(isWriteTool('Edit')).toBe(true);
    expect(isWriteTool('Write')).toBe(true);
    expect(isWriteTool('MultiEdit')).toBe(true);
    expect(isWriteTool('Read')).toBe(false);
    expect(writeTargetPath({ file_path: '/a.ts' })).toBe('/a.ts');
    expect(writeTargetPath({ path: '/b.ts' })).toBe('/b.ts');
    expect(writeTargetPath({})).toBeNull();
  });

  it('BLOCKS an Edit to an existing file never read this session', () => {
    const call: GuardCall = { name: 'Edit', args: { file_path: '/proj/a.ts' } };
    const v = consultGroundedWrite(call, snap({ fileExists: () => true }));
    expect(v.action).toBe('block');
    if (v.action === 'block') {
      expect(v.guardId).toBe('grounded-write');
      expect(v.reason).toBe('ungrounded-write');
      expect(v.feedback).toContain('/proj/a.ts');
      expect(v.feedback).toContain('Read /proj/a.ts');
    }
  });

  it('ALLOWS a net-new file (fileExists false)', () => {
    const call: GuardCall = { name: 'Write', args: { file_path: '/proj/new.ts' } };
    const v = consultGroundedWrite(call, snap({ fileExists: () => false }));
    expect(v.action).toBe('allow');
  });

  it('ALLOWS read-then-edit on the same path (path in readPaths)', () => {
    const call: GuardCall = { name: 'Edit', args: { file_path: '/proj/a.ts' } };
    const v = consultGroundedWrite(call, snap({
      fileExists: () => true,
      readPaths: new Set(['/proj/a.ts']),
    }));
    expect(v.action).toBe('allow');
  });

  it('ALLOWS when the path is in everReadPaths (read an earlier step)', () => {
    const call: GuardCall = { name: 'Edit', args: { file_path: '/proj/a.ts' } };
    const v = consultGroundedWrite(call, snap({
      fileExists: () => true,
      everReadPaths: new Set(['/proj/a.ts']),
    }));
    expect(v.action).toBe('allow');
  });

  it('ALLOWS a non-write tool and a path-less write', () => {
    expect(consultGroundedWrite({ name: 'Read', args: { file_path: '/proj/a.ts' } }, snap()).action).toBe('allow');
    expect(consultGroundedWrite({ name: 'Edit', args: {} }, snap()).action).toBe('allow');
  });

  it('FIX 2: BLOCKS a MultiEdit to an existing file never read this session', () => {
    // MultiEdit's args carry file_path + edits[]; writeTargetPath reads file_path,
    // so grounded-write governs it exactly like Edit/Write.
    const call: GuardCall = { name: 'MultiEdit', args: { file_path: '/proj/m.ts', edits: [{ old_string: 'a', new_string: 'b' }] } };
    const v = consultGroundedWrite(call, snap({ fileExists: () => true }));
    expect(v.action).toBe('block');
    if (v.action === 'block') {
      expect(v.guardId).toBe('grounded-write');
      expect(v.feedback).toContain('/proj/m.ts');
    }
    // …and a read-then-MultiEdit on the same path passes.
    expect(consultGroundedWrite(call, snap({ fileExists: () => true, everReadPaths: new Set(['/proj/m.ts']) })).action).toBe('allow');
  });

  it('integration: a real symlinked file read via its link allows the edit to the real path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-gw-'));
    try {
      const real = join(dir, 'real.ts');
      const link = join(dir, 'link.ts');
      writeFileSync(real, 'x');
      symlinkSync(real, link);
      const reg = new ReadPathRegistry();
      reg.record('Read', { file_path: link }, undefined);
      // Build a snapshot whose everReadPaths is the registry's canonical set,
      // and whose fileExists actually probes the fs — but the guard takes a
      // pre-canonicalized target path, so canonicalize the edit target too.
      const v = consultGroundedWrite(
        { name: 'Edit', args: { file_path: canonicalizePath(real) } },
        snap({ fileExists: existsSync, everReadPaths: reg.snapshot() }),
      );
      expect(v.action).toBe('allow');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// Evidence — claim+no evidence → nudge once; claim+result → allow;
// quoted/code-block claim → no fire; unresolved-failure → allow.
// ──────────────────────────────────────────────────────────────────────

describe('guard-pipeline — evidence', () => {
  it('isCompletionClaim fires on real completion phrasing', () => {
    expect(isCompletionClaim('Done — the tests are passing now.')).toBe(true);
    expect(isCompletionClaim("I've fixed the bug and everything works.")).toBe(true);
    expect(isCompletionClaim('Let me look at the next file.')).toBe(false);
  });

  it('a quoted / code-block claim does NOT read as a claim', () => {
    expect(isCompletionClaim('The instruction said "all tests are passing" — let me verify.')).toBe(false);
    expect(isCompletionClaim('```\nDone: tests passing\n```\nNow I will check.')).toBe(false);
  });

  it('claim + NO evidence → nudge with guardId evidence', () => {
    const v = consultFinalText('Done. The build is green.', snap());
    expect(v.action).toBe('nudge');
    if (v.action === 'nudge') {
      expect(v.guardId).toBe('evidence');
      expect(v.feedback).toContain('[EVIDENCE]');
    }
  });

  it('claim + a successful non-read tool result this turn → allow', () => {
    const v = consultFinalText('Done. The build is green.', snap({
      evidence: { successfulNonReadTool: true, diagnosticGreen: false, exhausted: false },
    }));
    expect(v.action).toBe('allow');
  });

  it('claim + a green diagnostic this turn → allow', () => {
    const v = consultFinalText('Fixed and passing.', snap({
      evidence: { successfulNonReadTool: false, diagnosticGreen: true, exhausted: false },
    }));
    expect(v.action).toBe('allow');
  });

  it('claim + an explicit unresolved-failure statement → allow (honest report)', () => {
    expect(hasUnresolvedFailure('I fixed part of it but the build still failing on module X.')).toBe(true);
    const v = consultFinalText('I implemented the fix but I could not get the tests to pass.', snap());
    expect(v.action).toBe('allow');
  });

  it('fires at most ONCE per turn (exhausted → pass-through)', () => {
    const first = consultFinalText('Done, all green.', snap({
      evidence: { successfulNonReadTool: false, diagnosticGreen: false, exhausted: false },
    }));
    expect(first.action).toBe('nudge');
    const second = consultFinalText('Done, all green.', snap({
      evidence: { successfulNonReadTool: false, diagnosticGreen: false, exhausted: true },
    }));
    expect(second.action).toBe('allow');
  });

  it('non-claim final text → allow', () => {
    expect(consultFinalText('Here is what I found in the file.', snap()).action).toBe('allow');
  });

  it('hasEvidence + stripNonAssertionSpans are exported and pure', () => {
    expect(hasEvidence({ successfulNonReadTool: true, diagnosticGreen: false, exhausted: false }, '')).toBe(true);
    expect(stripNonAssertionSpans('`done`').includes('done')).toBe(false);
  });

  // ── FIX 2: evidence counts ONLY genuinely state-advancing tools ──
  it('isEvidenceTool: writes / Bash / orchestration count, ReportConfidence + read-class do NOT', () => {
    // State-advancing → evidence.
    for (const t of ['Edit', 'Write', 'MultiEdit', 'Bash', 'Forge', 'Brainstorm', 'Tribunal', 'Agent', 'Delegate', 'Pipeline', 'Review', 'ProposePlan', 'Campfire']) {
      expect(isEvidenceTool(t)).toBe(true);
    }
    // Self-report + read-class → NOT evidence.
    for (const t of ['ReportConfidence', 'RetrieveResult', 'Read', 'Grep', 'Glob']) {
      expect(isEvidenceTool(t)).toBe(false);
    }
  });

  it('FIX 2: a completion claim after only a successful ReportConfidence still nudges', () => {
    // The session loop sets successfulNonReadTool ONLY via isEvidenceTool, so a
    // turn whose single successful tool was ReportConfidence leaves it false →
    // the evidence guard still fires the nudge for an unsupported claim.
    expect(isEvidenceTool('ReportConfidence')).toBe(false);
    const v = consultFinalText('Done. The fix is complete.', snap({
      evidence: { successfulNonReadTool: false, diagnosticGreen: false, exhausted: false },
    }));
    expect(v.action).toBe('nudge');
  });

  it('FIX 2: a completion claim after a successful Bash → no nudge (Bash is evidence)', () => {
    expect(isEvidenceTool('Bash')).toBe(true);
    // A Bash success flips successfulNonReadTool=true in the loop; the guard allows.
    const v = consultFinalText('Done. The fix is complete.', snap({
      evidence: { successfulNonReadTool: true, diagnosticGreen: false, exhausted: false },
    }));
    expect(v.action).toBe('allow');
  });
});

// ──────────────────────────────────────────────────────────────────────
// Information-gain — computeInfoGain + ladder + 4×-same vs 4-different.
// ──────────────────────────────────────────────────────────────────────

describe('guard-pipeline — information-gain', () => {
  it('computeInfoGain counts new tokens once and mutates the seen-state', () => {
    const state = createInfoGainState();
    expect(computeInfoGain({ resultPaths: ['/a', '/b'] }, state)).toBe(2);
    // Same paths again → no new info.
    expect(computeInfoGain({ resultPaths: ['/a', '/b'] }, state)).toBe(0);
    // A new path + a new error string → 2.
    expect(computeInfoGain({ resultPaths: ['/c'], errorStrings: ['boom'] }, state)).toBe(2);
    // Same bash stdout twice → only the first counts.
    expect(computeInfoGain({ bashStdout: ['hello'] }, state)).toBe(1);
    expect(computeInfoGain({ bashStdout: ['hello'] }, state)).toBe(0);
  });

  it('hashBashStdout is stable and content-sensitive', () => {
    expect(hashBashStdout('x')).toBe(hashBashStdout('x'));
    expect(hashBashStdout('x')).not.toBe(hashBashStdout('y'));
  });

  it('isStallStep: read-only + paths ⊆ everRead + zero gain = stall', () => {
    const ever = new Set(['/a', '/b']);
    expect(isStallStep(true, new Set(['/a']), ever, 0)).toBe(true);
    // touched a NEW file → not a stall.
    expect(isStallStep(true, new Set(['/c']), ever, 0)).toBe(false);
    // had info gain → not a stall.
    expect(isStallStep(true, new Set(['/a']), ever, 1)).toBe(false);
    // non-read step → not a stall.
    expect(isStallStep(false, new Set(['/a']), ever, 0)).toBe(false);
  });

  it('ladder: 1–3 silent, 4 nudge, 5–7 stronger, 8 hard stop', () => {
    let spinState = { consecutiveStallSteps: 0, globalStallSteps: 0 };
    const labels: string[] = [];
    for (let i = 1; i <= 8; i++) {
      const r = advanceStall(true, spinState);
      spinState = r.spin;
      labels.push(r.verdict.action);
    }
    // steps 1-3 allow, 4 nudge, 5-7 nudge (stronger text), 8 block.
    expect(labels).toEqual(['allow', 'allow', 'allow', 'nudge', 'nudge', 'nudge', 'nudge', 'block']);
  });

  it('a non-stall step resets consecutiveStallSteps but not the global backstop', () => {
    let spinState = { consecutiveStallSteps: 3, globalStallSteps: 3 };
    const r = advanceStall(false, spinState);
    expect(r.spin.consecutiveStallSteps).toBe(0);
    expect(r.spin.globalStallSteps).toBe(3);
    expect(r.verdict.action).toBe('allow');
  });

  it('global backstop hard-stops at 12 even with resets in between', () => {
    let spinState = { consecutiveStallSteps: 0, globalStallSteps: 11 };
    const r = advanceStall(true, spinState); // global → 12
    expect(r.spin.globalStallSteps).toBe(12);
    expect(r.verdict.action).toBe('block');
  });

  it('integration contract: 4× same file-set re-reads → nudge at the 4th; 4 DIFFERENT files → nothing', () => {
    // 4× same set: each step re-reads {/a,/b}, already in everRead, zero gain.
    const ever = new Set(['/a', '/b']);
    let spinState = { consecutiveStallSteps: 0, globalStallSteps: 0 };
    const actions: string[] = [];
    for (let i = 0; i < 4; i++) {
      const state = createInfoGainState();
      // pre-seed the seen-paths so re-reading /a,/b yields zero gain.
      state.seenPaths.add('/a'); state.seenPaths.add('/b');
      const gain = computeInfoGain({ resultPaths: ['/a', '/b'] }, state);
      const stall = isStallStep(true, new Set(['/a', '/b']), ever, gain);
      const r = advanceStall(stall, spinState);
      spinState = r.spin;
      actions.push(r.verdict.action);
    }
    expect(actions).toEqual(['allow', 'allow', 'allow', 'nudge']);

    // 4 DIFFERENT files: each read is a NEW path → gain > 0 → never a stall.
    let spin2 = { consecutiveStallSteps: 0, globalStallSteps: 0 };
    const ever2 = new Set<string>();
    const actions2: string[] = [];
    const state2 = createInfoGainState();
    for (const p of ['/w', '/x', '/y', '/z']) {
      const gain = computeInfoGain({ resultPaths: [p] }, state2);
      const stall = isStallStep(true, new Set([p]), ever2, gain);
      ever2.add(p);
      const r = advanceStall(stall, spin2);
      spin2 = r.spin;
      actions2.push(r.verdict.action);
    }
    expect(actions2).toEqual(['allow', 'allow', 'allow', 'allow']);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Confidence-gate — risky bash gated, ls not, 3-file write gated, 2-file not.
// ──────────────────────────────────────────────────────────────────────

describe('guard-pipeline — confidence-gate', () => {
  it('isRiskyBash flags mutating/long-running, not read-only', () => {
    expect(isRiskyBash('rm -rf build')).toBe(true);
    expect(isRiskyBash('git push origin main')).toBe(true);
    expect(isRiskyBash('git commit -m x')).toBe(true);
    expect(isRiskyBash('npm publish')).toBe(true);
    expect(isRiskyBash('npx vitest run')).toBe(true);
    expect(isRiskyBash('npm run build')).toBe(true);
    expect(isRiskyBash('echo hi > out.txt')).toBe(true);
    expect(isRiskyBash('sudo reboot')).toBe(true);
    // read-only → not risky
    expect(isRiskyBash('ls -la')).toBe(false);
    expect(isRiskyBash('cat file.ts')).toBe(false);
    expect(isRiskyBash('pwd')).toBe(false);
    expect(isRiskyBash('git status')).toBe(false);
    expect(isRiskyBash('grep -r foo .')).toBe(false);
    expect(isRiskyBash('echo hello')).toBe(false);
  });

  it('escalates a risky bash when confidence not reported this turn', () => {
    const call: GuardCall = { name: 'Bash', args: { command: 'git push' } };
    const v = consultConfidenceGate(call, snap({ confidence: { lastValue: null, reportedThisTurn: false } }), 0);
    expect(v.action).toBe('escalate');
    if (v.action === 'escalate') {
      expect(v.guardId).toBe('confidence-escalation');
      expect(v.reason).toContain('risky-bash');
    }
  });

  it('does NOT escalate ls (read-only bash)', () => {
    const call: GuardCall = { name: 'Bash', args: { command: 'ls -la' } };
    expect(consultConfidenceGate(call, snap(), 0).action).toBe('allow');
  });

  it('does NOT escalate when confidence WAS reported this turn', () => {
    const call: GuardCall = { name: 'Bash', args: { command: 'git push' } };
    const v = consultConfidenceGate(call, snap({ confidence: { lastValue: 90, reportedThisTurn: true } }), 0);
    expect(v.action).toBe('allow');
  });

  it('escalates a broad (≥3-file) write step, not a 2-file one', () => {
    const call: GuardCall = { name: 'Write', args: { file_path: '/a.ts' } };
    expect(BROAD_WRITE_THRESHOLD).toBe(3);
    expect(isGatedCall(call, 3)).toBe(true);
    expect(isGatedCall(call, 2)).toBe(false);
    expect(consultConfidenceGate(call, snap(), 3).action).toBe('escalate');
    expect(consultConfidenceGate(call, snap(), 2).action).toBe('allow');
  });

  it('escalates a Delegate/Forge/Agent dispatch', () => {
    expect(gatedCategory({ name: 'Forge', args: {} })).toBe('dispatch');
    expect(consultConfidenceGate({ name: 'Forge', args: {} }, snap(), 0).action).toBe('escalate');
    expect(consultConfidenceGate({ name: 'Delegate', args: {} }, snap(), 0).action).toBe('escalate');
  });

  it('FIX 2: 3 MultiEdits to 3 distinct files trips the broad-write gate', () => {
    // countDistinctWriteFiles must count MultiEdit (the guards-module isWriteTool
    // governs it); the legacy {Edit,Write} set would have under-counted to 0.
    const calls: GuardCall[] = [
      { name: 'MultiEdit', args: { file_path: '/a.ts', edits: [] } },
      { name: 'MultiEdit', args: { file_path: '/b.ts', edits: [] } },
      { name: 'MultiEdit', args: { file_path: '/c.ts', edits: [] } },
    ];
    expect(countDistinctWriteFiles(calls)).toBe(3);
    // A MultiEdit IS gated at the broad-write threshold, and escalates when
    // confidence is unreported.
    const me: GuardCall = { name: 'MultiEdit', args: { file_path: '/a.ts', edits: [] } };
    expect(isGatedCall(me, 3)).toBe(true);
    expect(isGatedCall(me, 2)).toBe(false);
    expect(consultConfidenceGate(me, snap(), 3).action).toBe('escalate');
  });

  it('NEVER applies in strict mode (the inline guard owns strict)', () => {
    const call: GuardCall = { name: 'Bash', args: { command: 'git push' } };
    expect(consultConfidenceGate(call, snap({ mode: 'strict' }), 0).action).toBe('allow');
  });
});

// ──────────────────────────────────────────────────────────────────────
// Pipeline orchestrator — composition, batch, shadow downgrades.
// ──────────────────────────────────────────────────────────────────────

describe('guard-pipeline — orchestrator + shadow', () => {
  it('consultGuard: grounded-write block dominates the confidence escalation for the same write', () => {
    // An ungrounded broad write would both block (grounded-write) and escalate
    // (confidence) — grounded-write runs first and its block wins.
    const call: GuardCall = { name: 'Write', args: { file_path: '/proj/a.ts' } };
    const r = consultGuard(call, snap({ fileExists: () => true }), 3);
    expect(r.verdict.action).toBe('block');
    expect(r.shadowed).toBeUndefined();
  });

  it('consultGuard: a grounded (read) broad write still escalates on confidence', () => {
    const call: GuardCall = { name: 'Write', args: { file_path: '/proj/a.ts' } };
    const r = consultGuard(call, snap({ fileExists: () => true, everReadPaths: new Set(['/proj/a.ts']) }), 3);
    expect(r.verdict.action).toBe('escalate');
  });

  it('consultGuard: a clean allow returns allow with no shadow', () => {
    const r = consultGuard({ name: 'Read', args: { file_path: '/a.ts' } }, snap(), 0);
    expect(r.verdict.action).toBe('allow');
  });

  it('shadow mode downgrades a block to allow but preserves the original in shadowed', () => {
    const call: GuardCall = { name: 'Edit', args: { file_path: '/proj/a.ts' } };
    const r = consultGuard(call, snap({ mode: 'shadow', fileExists: () => true }), 0);
    expect(r.verdict.action).toBe('allow');
    expect(r.shadowed).toBeDefined();
    expect(r.shadowed!.action).toBe('block');
    if (r.shadowed!.action === 'block') expect(r.shadowed!.guardId).toBe('grounded-write');
  });

  it('applyShadow: invariants passes through unchanged; shadow downgrades', () => {
    const block = { action: 'block', guardId: 'grounded-write', reason: 'r', feedback: 'f' } as const;
    expect(applyShadow(block, 'invariants').verdict.action).toBe('block');
    expect(applyShadow(block, 'invariants').shadowed).toBeUndefined();
    const s = applyShadow(block, 'shadow');
    expect(s.verdict.action).toBe('allow');
    expect(s.shadowed).toEqual(block);
    // allow is never shadowed.
    expect(applyShadow({ action: 'allow' }, 'shadow').shadowed).toBeUndefined();
  });

  it('consultBatch maps per-call verdicts in order', () => {
    const calls: GuardCall[] = [
      { name: 'Read', args: { file_path: '/a.ts' } },
      { name: 'Edit', args: { file_path: '/proj/b.ts' } },
    ];
    const out = consultBatch(calls, snap({ fileExists: () => true }), 0);
    expect(out).toHaveLength(2);
    expect(out[0].index).toBe(0);
    expect(out[0].result.verdict.action).toBe('allow');
    expect(out[1].result.verdict.action).toBe('block');
  });

  it('countDistinctWriteFiles tallies distinct write targets across a step', () => {
    const calls: GuardCall[] = [
      { name: 'Edit', args: { file_path: '/a.ts' } },
      { name: 'Write', args: { file_path: '/b.ts' } },
      { name: 'Edit', args: { file_path: '/a.ts' } }, // dup
      { name: 'Read', args: { file_path: '/c.ts' } }, // not a write
    ];
    expect(countDistinctWriteFiles(calls)).toBe(2);
  });
});
