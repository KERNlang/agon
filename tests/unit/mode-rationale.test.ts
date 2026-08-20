import { describe, expect, it } from 'vitest';

import { buildModeRationale, formatModeRationale } from '../../packages/cli/src/cesar/mode-rationale.js';
import type { CesarRoutingHints } from '../../packages/cli/src/cesar/routing.js';

function hints(over: Partial<CesarRoutingHints> = {}): CesarRoutingHints {
  return {
    taskClass: 'feature',
    intakeKind: 'feature',
    scopeFileCount: 3,
    scopeDirSpread: 1,
    inputTokens: 400,
    complexityHint: 'medium',
    recommendedFlow: 'forge-slice',
    flowReason: 'one slice, clear contract',
    uncertaintyFamily: 'implementation',
    escalationHint: 'forge',
    recommendedBreadth: 'solo',
    recommendedForgeScope: 'slice',
    fanoutLikely: false,
    reviewLikely: true,
    explicitEngineMention: false,
    ...over,
  } as CesarRoutingHints;
}

// mode-rationale distinguishes "no cost was estimated" (null/undefined) from
// "a cost was estimated" via a loose-equality helper. If that helper treated a
// real number as null-ish, an expensive route would never earn the cost-warning
// kind and the price tag would vanish from the line the user reads before
// approving the spend.
describe('mode rationale cost handling', () => {
  it('upgrades an expensive route to a cost warning', () => {
    const r = buildModeRationale(hints(), { costUsd: 2.5 });

    expect(r.kind).toBe('cost-warning');
    expect(r.reason).toContain('$2.50');
    expect(r.costUsd).toBe(2.5);
  });

  it('leaves a cheap route on its structural kind', () => {
    const r = buildModeRationale(hints(), { costUsd: 0.25 });

    expect(r.kind).toBe('auto-escalation');
    expect(r.reason).not.toContain('$');
  });

  it('does not invent a cost warning when no cost was estimated', () => {
    const r = buildModeRationale(hints());

    expect(r.kind).toBe('auto-escalation');
    expect(r.costUsd).toBeUndefined();
  });

  it('classifies a breadth flow as a breadth choice', () => {
    const r = buildModeRationale(hints({ recommendedFlow: 'brainstorm', uncertaintyFamily: 'tradeoff' }));

    expect(r.kind).toBe('breadth-choice');
    expect(r.reason).toContain('brainstorm');
  });
});

describe('formatModeRationale', () => {
  it('prints an estimated cost, including a sub-dollar one', () => {
    const line = formatModeRationale({
      kind: 'cost-warning',
      flow: 'forge-slice',
      reason: 'one slice',
      confidence: 88,
      costUsd: 0.5,
    });

    expect(line).toContain('[$0.50]');
    expect(line).toContain('~88%');
    expect(line).toContain('forge slice');
  });

  it('prints a zero cost rather than hiding it', () => {
    expect(formatModeRationale({ kind: 'scope-hint', flow: 'plan-first', reason: 'multi step', costUsd: 0 }))
      .toContain('[$0.00]');
  });

  it('omits the cost and confidence segments when neither was estimated', () => {
    const line = formatModeRationale({ kind: 'scope-hint', flow: 'plan-first', reason: 'multi step' });

    expect(line).not.toContain('$');
    expect(line).not.toContain('~');
    expect(line).toBe('▸ plan first — multi step');
  });
});
