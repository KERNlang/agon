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
