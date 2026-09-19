import type { GuardCall, GuardVerdict } from './guard-types.js';

export interface ShadowableVerdict {
  verdict: GuardVerdict;
  shadowed?: GuardVerdict;
}

export interface BatchVerdict {
  index: number;
  call: GuardCall;
  result: ShadowableVerdict;
}

export function applyShadow(verdict: GuardVerdict, mode: string): ShadowableVerdict {
  if (mode === 'shadow' && verdict.action !== 'allow') {
    return { verdict: { action: 'allow' }, shadowed: verdict };
  }
  return { verdict };
}
