import { isTestFile, parsePatch, newFilesInDiff } from '@kernlang/agon-support-worktree';

export interface DoneOracleInput {
  gateOk: boolean;
  oracleTampered: boolean;
  weakenedTests: boolean;
  claim: string;
  neroFalsified: boolean;
}

/** Check deterministic evidence before the human merge gate. */
export function doneOracleDecision(i: DoneOracleInput): { passed: boolean; reason: string } {
  if (i.oracleTampered) return { passed: false, reason: 'L0: the frozen baseline oracle was modified' };
  if (i.weakenedTests) return { passed: false, reason: 'L1: existing tests were weakened or rewritten (acceptance drift)' };
  if (!i.gateOk) return { passed: false, reason: 'L0: the gate (build / typecheck / lint / tests) is not green' };
  if (!i.claim || !i.claim.trim()) return { passed: false, reason: 'L2: the builder produced no disprovable claim' };
  if (i.neroFalsified) return { passed: false, reason: 'L5: nero produced a runnable counterexample against the claim' };
  return { passed: true, reason: 'L0–L5 clean — ready for the human merge gate' };
}

export interface DoneEvidenceInput extends Omit<DoneOracleInput, 'weakenedTests'> {
  diff: string;
}

/** Reject changes to existing tests before accepting a completion claim. */
export function evaluateDoneEvidence(input: DoneEvidenceInput): { passed: boolean; reason: string } {
  const changed = parsePatch(input.diff);
  const newSet = new Set(newFilesInDiff(input.diff));
  const weakenedTests = changed.some(file =>
    (file.renamedFrom !== undefined && isTestFile(file.renamedFrom))
    || (isTestFile(file.path) && !newSet.has(file.path)));
  return doneOracleDecision({ ...input, weakenedTests });
}

/**
 * Parse a builder turn for the conquer sentinels: a line starting CONQUER_DONE claims completion (the rest of that line is the disprovable claim for the done-oracle); a line `CONQUER_ASK: <question>` is a fork to resolve. Pure — exported for testing.
 */
export function parseBuilderSignals(turnText: string): { claimedDone: boolean; ask: string | null; claim: string } {
  const lines = turnText.split('\n');
  let claimedDone = false;
  let claim = '';
  let ask: string | null = null;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('CONQUER_DONE')) {
      claimedDone = true;
      const rest = t.slice('CONQUER_DONE'.length).replace(/^[:\s-]+/, '').trim();
      if (rest) claim = rest;
    } else if (t.startsWith('CONQUER_ASK')) {
      const idx = t.indexOf(':');
      ask = idx >= 0 ? t.slice(idx + 1).trim() : '';
    }
  }
  return { claimedDone, ask, claim };
}

/**
 * The protocol Cesar gives the builder: work autonomously in this repo toward the task; when you hit a genuine fork you cannot resolve, emit a single line `CONQUER_ASK: <question + options>` and STOP for guidance; when finished and the project's tests pass, emit `CONQUER_DONE: <one disprovable claim about what now works>`. Pure — exported for testing.
 */
export function buildConquerSystemPrompt(): string {
  return [
    'You are an autonomous build agent supervised by Cesar (you do NOT talk to a human directly).',
    'Work toward the task in the current repository, making and running real changes.',
    'PROTOCOL — use these exact sentinels on their own line:',
    `- When you hit a genuine fork or are stuck and need a decision, emit "${'CONQUER_ASK'}: <the question, with the concrete options>" and STOP. Cesar will consult a panel and reply.`,
    `- When the work is complete AND the project's tests pass, emit "${'CONQUER_DONE'}: <one concrete, disprovable claim about the new behavior, e.g. a command + expected output>".`,
    'Do not weaken, skip, or rewrite existing tests to make them pass. Add new tests in new files.',
    'Keep going until you emit one of the sentinels.',
  ].join('\n');
}
