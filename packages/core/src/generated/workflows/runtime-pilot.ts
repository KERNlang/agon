/**
 * Pure, non-authoritative pilot policy for KERN 4.5 direct source execution. No safety, approval, filesystem, network, or mutation decision consumes this result.
 */
export function classifyRuntimePilotChange(changeKind: string): string {
  if (changeKind === 'docs') {
    return 'live';
  }
  if (changeKind === 'bounded-code') {
    return 'review';
  }
  return 'plan';
}

/** Pure, non-authoritative pilot policy for KERN 4.5 direct source execution. No safety, approval, filesystem, network, or mutation decision consumes this result. */
