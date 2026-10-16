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
