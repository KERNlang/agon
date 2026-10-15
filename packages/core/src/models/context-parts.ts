export interface TextPart {
  kind: 'text';
  text: string;
}

export interface ToolCallPart {
  kind: 'tool_call';
  toolName: string;
  toolCallId: string;
  args: Record<string,unknown>;
}

/**
 * preview = first 300 chars inline. cachedRef = toolCallId pointing to disk file when result > 800 chars.
 */
export interface ToolResultPart {
  kind: 'tool_result';
  toolCallId: string;
  toolName: string;
  preview: string;
  cachedRef: string|null;
}

export interface ReasoningPart {
  kind: 'reasoning';
  text: string;
}

/**
 * Situational continuity carried forward through a compaction so post-compaction turns keep a live working-set picture. filesInPlay = files the session is actively touching (modified-first, recency-biased, cap 10); pendingVerifier = the last DiagnosticDigest status (e.g. '<pkg>: N introduced errors unresolved' or '<pkg>: clean'), null when none; openHypotheses = the most-recent few folded decisions/discoveries (no new extraction). Compaction-only — there is NO per-turn injection of this (deferred, P3).
 */
export type { WorkingSet, CompactionSummaryPart, ToolCacheEntry } from '@kernlang/agon-support-persistence';
import type { CompactionSummaryPart } from '@kernlang/agon-support-persistence';

export type MessagePart =
  | TextPart
  | ToolCallPart
  | ToolResultPart
  | ReasoningPart
  | CompactionSummaryPart;

export type { StageDecision, ToolResultRef, StageContext } from '@kernlang/agon-mod-forge';
export { buildStageContext, renderStageContext } from '@kernlang/agon-mod-forge';
