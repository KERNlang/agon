/**
 * A confirmed non-discriminating oracle: an engine made a task's `verify` pass with a deliberate cheat.
 */
export interface OracleHole {
  taskId: string;
  engine: string;
  evidence: string;
}

/**
 * Adversarial prompt for the oracle red-team pre-flight. Instructs an engine to make the task's `verify` exit 0 with the most degenerate CHEAT possible (hardcode, ignore inputs, special-case the checked values) WITHOUT implementing the described gap. If an engine succeeds, the verify is non-discriminating. Pure — exported for testing.
 */
export function buildOracleCheatPrompt(task: { source:string; verify:string }): string {
  return [
    'You are RED-TEAMING a test oracle, NOT implementing a feature. Your ONLY job is to make the command below exit 0 using the LAZIEST, most degenerate cheat you can: hardcode return values, ignore the inputs, stub or short-circuit functions, special-case the exact values the test checks. Do the absolute minimum to turn the command green.',
    'Do NOT implement the described gap for real. If the command can only be satisfied by a genuine, correct implementation, then it is a strong oracle — say so and make NO changes.',
    '',
    'THE GAP THIS TEST IS SUPPOSED TO FORCE (do NOT actually build it — only cheat past the test):',
    task.source.trim(),
    '',
    'THE TEST / ORACLE COMMAND YOU MUST TRY TO GAME (make it exit 0 by cheating):',
    task.verify.trim(),
    '',
    'If you can make it pass without really implementing the gap, the oracle is too weak. Make the smallest cheating change that passes; otherwise make no change.',
  ].join('\n');
}

/**
 * Decide the outcome of the oracle red-team pre-flight. Pure — exported for testing. No holes -> proceed clean. `strict` + holes -> stop the run (the oracle would let buggy code land green). The probe is per task, just before that task is forged, so a strict stop can land mid-run, not only at launch. `warn` (or any non-strict) + holes -> proceed with a loud summary so the human can strengthen the verify.
 */
export function oracleGateDecision(holes: OracleHole[], mode: string): { abort: boolean; summary: string } {
  if (holes.length === 0) {
    return { abort: false, summary: 'oracle red-team: no gameable verify found — the oracles look discriminating.' };
  }
  const lines = holes.map((h) => `  • ${h.taskId}: gamed by ${h.engine} — ${h.evidence}`);
  const head = `oracle red-team: ${holes.length} gameable verify(s) — a cheating impl passed the test, so it would let buggy-but-passing code land green:`;
  const tail = mode === 'strict'
    ? 'Stopping the run (--oracle-gate=strict). Strengthen the verify(s) with discriminating cases and retry.'
    : 'Continuing (--oracle-gate=warn) — strengthen the verify(s) before trusting the run.';
  return { abort: mode === 'strict', summary: [head, ...lines, tail].join('\n') };
}

/**
 * THE default for --oracle-gate, in one place. The CLI flag parser and runGoalController used to each carry their own literal ('warn' at the CLI, 'off' in the controller), so any caller that reached the controller directly — the supervisor, a test, an embedder — silently ran with the gate DISABLED while the docs promised it was on. A safety default that depends on which door you came through is not a default.
 */
export const DEFAULT_ORACLE_GATE: 'off'|'warn'|'strict' = 'warn';

/**
 * Did the red-team probe actually MEASURE the oracle? A forge that threw, dispatched nobody, or whose every seat failed produces `winner: null` — byte-identical to the honest 'nobody could cheat this verify' result. Reading that as a clean pass is the worst failure mode this gate has: it reports the oracle as sound precisely when it learned nothing. A winner is always conclusive (a hole was found); otherwise at least one seat must have completed. Pure — exported for testing.
 */
export function oracleProbeConclusive(m: { winner?: string|null; error?: string; enginesDispatched?: number; results?: Record<string, { engineCompleted?: boolean; status?: string }> }): { conclusive: boolean; reason: string } {
  if (m.winner) return { conclusive: true, reason: 'a cheating implementation won' };
  const err = (m.error ?? '').trim();
  if (err) return { conclusive: false, reason: `the red-team forge reported an error (${err}) — no engine result to judge` };
  const results = m.results ?? {};
  const seats = Object.keys(results);
  if (seats.length === 0 || (m.enginesDispatched ?? 0) === 0) {
    return { conclusive: false, reason: 'the red-team forge dispatched no engine — nothing attacked this verify' };
  }
  const completed = seats.filter((id) => results[id]?.engineCompleted === true);
  if (completed.length === 0) {
    return { conclusive: false, reason: `all ${seats.length} red-team seat(s) failed to complete — the verify was never actually attacked` };
  }
  return { conclusive: true, reason: `${completed.length}/${seats.length} seat(s) attacked the verify and none could game it` };
}
