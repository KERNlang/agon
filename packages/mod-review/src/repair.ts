import type { InvocationContext, Json, ModServices } from '@kernlang/agon-mod-api';
import { extractReviewFindings } from './findings.js';

export const REVIEW_SENTINEL = '<!--AGON_REVIEW_FINDINGS_v1-->';

export type Finding = {
  file: string;
  lines: string;
  severity: 'blocking' | 'important' | 'nit';
  blocking: boolean;
  confidence: number;
  problem: string;
  minimalFix: string;
};

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function parseFindings(output: string): { valid: boolean; findings: Finding[] } {
  const raw = extractReviewFindings(output);
  if (raw === null) return { valid: false, findings: [] };
  const findings = raw
      .filter((v) => v && typeof v === 'object' && !Array.isArray(v))
      .map((v: any) => ({
        file: text(v.file),
        lines: text(v.lines),
        severity: ['blocking', 'important', 'nit'].includes(v.severity) ? v.severity : v.blocking ? 'blocking' : 'important',
        blocking: v.blocking === true,
        confidence: Math.max(0, Math.min(1, Number(v.confidence) || 0)),
        problem: text(v.problem),
        minimalFix: text(v.minimalFix),
      }))
      .filter((v) => v.file && v.problem);
  const hasFindingShape = raw.some((v: any) => v && typeof v === 'object' && text(v.problem));
  return { valid: raw.length === 0 || hasFindingShape, findings };
}

export function buildRepairPrompt(priorReview: string): string {
  return [
    'You previously produced this code review:',
    priorReview,
    `Now convert the findings above into a JSON array — output ONLY the array, nothing else. Your entire response must be valid JSON: start with [ and end with ]. No prose, no explanation, no markdown, no code fence. Include every verified blocking finding, then at most the 8 highest-priority, best-verified non-blocking findings; omit duplicates and weak speculation.\n\nEach element: {"file":"path","lines":"10-12","severity":"blocking|important|nit","blocking":true,"confidence":0.0,"problem":"what is wrong","minimalFix":"smallest fix"}\n\nconfidence is your 0.00-1.00 certainty the issue is real and correctly diagnosed (1.0 = you verified it in the code; lower it when you are guessing).\n\nExample of a valid response:\n[{"file":"src/auth.ts","lines":"42","severity":"important","blocking":false,"confidence":0.7,"problem":"missing null check","minimalFix":"guard before deref"}]\n\nIf the review found no issues, your entire response must be exactly: []\nDerive the findings from the review above — do not re-analyze.`,
  ].join('\n\n');
}

export const UNREPORTED_REVIEW_TIMEOUT_SECONDS = 420;

export interface ReviewDeadline {
  readonly startedAtMs: number;
  readonly seconds?: number;
  readonly now: () => number;
  readonly seatCeilingsSeconds?: number[];
}

export function reportSeatCeiling(deadline: ReviewDeadline, ceilingSeconds: number): void {
  deadline.seatCeilingsSeconds?.push(ceilingSeconds);
}

function aggregateDeadlineSeconds(deadline: ReviewDeadline, seatTimeoutSeconds: number): number {
  return deadline.seconds ?? Math.max(seatTimeoutSeconds, ...(deadline.seatCeilingsSeconds ?? [])) * 2;
}

export function followUpBudget(deadline: ReviewDeadline, timeoutSeconds: number | undefined): { timeoutSeconds?: number; maxWallSeconds?: number } {
  if (deadline.seconds === undefined) return timeoutSeconds !== undefined ? { timeoutSeconds } : {};
  const remaining = Math.max(1, Math.floor((deadline.startedAtMs + deadline.seconds * 1000 - deadline.now()) / 1000));
  return { timeoutSeconds: Math.min(timeoutSeconds ?? remaining, remaining), maxWallSeconds: remaining };
}

export function canStartRepair(deadline: ReviewDeadline, seatTimeoutSeconds: number, signal: AbortSignal): boolean {
  const endsAtMs = deadline.startedAtMs + aggregateDeadlineSeconds(deadline, seatTimeoutSeconds) * 1000;
  return !signal.aborted && endsAtMs - deadline.now() >= seatTimeoutSeconds * 1000;
}

export function dispatchCost(out: Record<string, Json>): number {
  return typeof out.costUsd === 'number' && Number.isFinite(out.costUsd) && out.costUsd >= 0 ? out.costUsd : 0;
}

export function dispatchText(out: Record<string, Json>): string {
  return typeof out.cleanedText === 'string' ? out.cleanedText.trim() : text(out.stdout);
}

export interface RepairOutcome {
  readonly block?: string;
  readonly findings?: Finding[];
  readonly costUsd: number;
  readonly error?: string;
}

export async function runRepair(
  engineId: string,
  priorReview: string,
  timeoutSeconds: number | undefined,
  context: InvocationContext,
  services: ModServices,
  maxWallSeconds?: number,
): Promise<RepairOutcome> {
  try {
    const out = (await services.engines.dispatch(engineId, buildRepairPrompt(priorReview), context, {
      ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
      ...(maxWallSeconds !== undefined ? { maxWallSeconds } : {}),
      mode: 'review',
      systemPrompt: 'Convert an existing code review into a JSON findings array. Do not modify files or use tools.',
    })) as Record<string, Json>;
    const costUsd = dispatchCost(out);
    if (out.timedOut === true || out.exitCode !== 0) {
      return { costUsd, error: `repair dispatch failed: ${text(out.stderr) || (out.timedOut === true ? 'timed out' : `exit ${String(out.exitCode)}`)}` };
    }
    const reply = dispatchText(out);
    if (!reply) return { costUsd, error: 'repair returned no output' };
    const block = `${REVIEW_SENTINEL}\n${reply}`;
    const parsed = parseFindings(block);
    return parsed.valid ? { block, findings: parsed.findings, costUsd } : { costUsd, error: 'repair output was not a JSON findings array' };
  } catch (error) {
    return { costUsd: 0, error: `repair dispatch failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
