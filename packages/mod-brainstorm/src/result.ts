import type { BrainstormGroup, BrainstormDedupStatus } from '@kernlang/agon-support-dedup';
import type { buildPanelHealth } from '@kernlang/agon-support-panel';
import type { BrainstormBid } from './workflow.js';

/** Canonical workflow result, shared by the session boundary and legacy readers. */
export interface BrainstormResult {
  question: string;
  bids: BrainstormBid[];
  winner: string;
  response: string;
  groups?: BrainstormGroup[];
  dedup?: BrainstormDedupStatus;
  synthesis?: { status: 'completed' | 'fallback'; detail?: string };
  panelHealth?: ReturnType<typeof buildPanelHealth>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function isArrayOf(value: unknown, accepts: (item: unknown) => boolean): boolean {
  if (!Array.isArray(value)) return false;
  // Iteration visits holes as undefined; Array.every would silently skip them.
  for (const item of value) if (!accepts(item)) return false;
  return true;
}
function isStrings(value: unknown): value is string[] {
  return isArrayOf(value, item => typeof item === 'string');
}
function isStatus(value: unknown, statuses: readonly string[]): boolean {
  return isRecord(value) && typeof value.status === 'string' && statuses.includes(value.status)
    && (value.detail === undefined || typeof value.detail === 'string');
}

function isBrainstormResult(value: unknown): value is BrainstormResult {
  if (!isRecord(value) || typeof value.question !== 'string'
    || typeof value.winner !== 'string' || typeof value.response !== 'string'
    || !isArrayOf(value.bids, bid => isRecord(bid)
      && typeof bid.engineId === 'string' && typeof bid.reasoning === 'string'
      && typeof bid.approach === 'string' && isFiniteNumber(bid.confidence)
      && (bid.score === undefined || isFiniteNumber(bid.score)))) return false;
  if (value.groups !== undefined && !isArrayOf(value.groups, group => isRecord(group)
    && isStrings(group.members) && typeof group.representative === 'string' && isFiniteNumber(group.similarity))) return false;
  if (value.dedup !== undefined && !isStatus(value.dedup, ['not-needed', 'applied', 'unavailable', 'failed', 'timed-out'])) return false;
  if (value.synthesis !== undefined && !isStatus(value.synthesis, ['completed', 'fallback'])) return false;
  if (value.panelHealth !== undefined) {
    const health = value.panelHealth;
    if (!isRecord(health) || !isFiniteNumber(health.requested) || !isFiniteNumber(health.responded)
      || typeof health.degraded !== 'boolean' || !isStrings(health.notes)
      || (health.banner !== null && typeof health.banner !== 'string')) return false;
  }
  return true;
}

/** Validate without normalizing or stripping evidence fields from the result. */
export function parseBrainstormResult(value: unknown): BrainstormResult {
  if (!isBrainstormResult(value)) throw new Error('Invalid Brainstorm result: result fields do not match the workflow contract.');
  return value;
}
