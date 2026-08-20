// Loose equality: null and undefined compare equal to each other; everything
// else compares strictly.
function looseEq(a: unknown, b: unknown): boolean {
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  return a === b;
}

import type { CesarRoutingHints } from './routing.js';

export type ModeRationaleKind = 'auto-escalation' | 'auto-approve' | 'speculation-gate' | 'breadth-choice' | 'scope-hint' | 'cost-warning';

export interface ModeRationale {
  kind: ModeRationaleKind;
  flow: string;
  reason: string;
  confidence?: number;
  engines?: string[];
  costUsd?: number;
}

export function buildModeRationale(hints: CesarRoutingHints, opts?: {confidence?:number,engines?:string[],costUsd?:number,forced?:boolean}): ModeRationale {
  const confidence = opts?.confidence ?? 85;
  const engines = opts?.engines ?? [];
  const costUsd = opts?.costUsd;
  const resolvedCostUsd = costUsd ?? 0;
  if (opts?.forced) {
    return { kind: 'auto-escalation', flow: hints.recommendedFlow, reason: `Forced by user pattern — ${hints.flowReason}`, confidence: confidence, engines: engines, costUsd: costUsd };
  }
  let kind: ModeRationaleKind = 'auto-escalation';
  let reason = hints.flowReason;
  if (hints.recommendedFlow === 'brainstorm' || hints.recommendedFlow === 'tribunal' || hints.recommendedFlow === 'campfire') {
    kind = 'breadth-choice';
    reason = `${hints.uncertaintyFamily} uncertainty → ${hints.recommendedFlow} (${hints.flowReason})`;
  } else if (hints.recommendedFlow === 'forge-slice' || hints.recommendedFlow === 'forge-full') {
    kind = 'auto-escalation';
    reason = `Implementation with ${hints.recommendedForgeScope} scope — ${hints.flowReason}`;
  } else if (hints.recommendedFlow === 'plan-first' || hints.recommendedFlow === 'spec-first') {
    kind = 'scope-hint';
    reason = `Multi-step work — ${hints.flowReason}`;
  }
  if (!looseEq(costUsd, null) && resolvedCostUsd > 1.0) {
    kind = 'cost-warning';
    reason = `${reason} (est. $${resolvedCostUsd.toFixed(2)})`;
  }
  return { kind: kind, flow: hints.recommendedFlow, reason: reason, confidence: confidence, engines: engines, costUsd: costUsd };
}

export function formatModeRationale(r: ModeRationale): string {
  const flowLabel = r.flow.replace(/-/g, ' ');
  const resolvedCostUsd = r.costUsd ?? 0;
  const cost = (!looseEq(r.costUsd, null)) ? ` [$${resolvedCostUsd.toFixed(2)}]` : '';
  const conf = (!looseEq(r.confidence, null)) ? ` ~${r.confidence}%` : '';
  return `▸ ${flowLabel}${conf}${cost} — ${r.reason}`;
}
