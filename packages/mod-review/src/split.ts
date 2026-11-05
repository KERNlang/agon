import type { CommandResult, InvocationContext, Json, ModServices } from '@kernlang/agon-mod-api';
import { gitHeaderPath, inferReviewRisk, redactSecretsDeep, redactSecretsPreservingLines, type ReviewRiskRequest, type ReviewTarget } from '@kernlang/agon-support-verification';
import type { ConsensusReport } from './consensus.js';
import { formatReport, formatSummaryLine, SPLIT_CAVEAT, type ReviewFormat, type ReviewReport } from './report.js';

interface FileDiff {
  readonly path: string;
  readonly text: string;
}

export function splitDiffByFile(diff: string): FileDiff[] {
  const headers = [...diff.matchAll(/^diff --(git|cc|combined) (.+)$/gm)];
  if (!headers.length) return [{ path: '(no file headers found)', text: diff }];
  return headers.map((header, index) => ({
    path: header[1] === 'git' ? gitHeaderPath(header[2]!) : header[2]!,
    text: diff.slice(index === 0 ? 0 : header.index, headers[index + 1]?.index ?? diff.length),
  }));
}

/** Fills batches in diff order, so neighbouring files stay together. */
export function batchFiles(files: readonly FileDiff[], limit: number): FileDiff[][] {
  const batches: FileDiff[][] = [];
  let used = 0;
  for (const file of files) {
    if (!batches.length || used + file.text.length > limit) {
      batches.push([]);
      used = 0;
    }
    batches.at(-1)!.push(file);
    used += file.text.length;
  }
  return batches;
}

function oversizedFilesMessage(label: string, oversized: readonly FileDiff[], limit: number): string {
  const chars = (value: number) => value.toLocaleString('en-US');
  const named = oversized.map(file => `${file.path} (${chars(file.text.length)} chars)`).join(', ');
  const largest = Math.max(...oversized.map(file => file.text.length));
  return `Refusing to review ${label} with --split: a single file cannot be divided and ${named} is over the ${chars(limit)} limit. Raise the limit with --max-diff-chars ${largest} or review a smaller target.`;
}

type BatchReport = Record<string, unknown> & Partial<ReviewReport> & { findings?: unknown[]; engines?: string[]; roles?: Record<string, string> };

export function mergeConsensus(reports: readonly ConsensusReport[], unitLabel: (index: number) => string = index => `batch ${index + 1}`): ConsensusReport | undefined {
  if (!reports.length) return undefined;
  const all = <K extends 'findings' | 'verified' | 'needsCheck' | 'speculative' | 'nits' | 'blockers' | 'engineFailures'>(key: K) =>
    reports.flatMap(report => report[key] as unknown[]) as unknown as ConsensusReport[K];
  const autoBlock = reports.some(report => report.autoBlock);
  return {
    findings: all('findings'), verified: all('verified'), needsCheck: all('needsCheck'), speculative: all('speculative'),
    nits: all('nits'), blockers: all('blockers'), engineFailures: all('engineFailures'),
    panelSize: reports.reduce((sum, report) => sum + report.panelSize, 0),
    okCount: reports.reduce((sum, report) => sum + report.okCount, 0),
    autoBlock,
    needsJudge: !autoBlock && reports.some(report => report.needsJudge),
    summary: reports.map((report, index) => `${unitLabel(index)}: ${report.summary}`).join(' | '),
    degraded: reports.find(report => report.degraded)?.degraded,
  };
}

export type ReviewBatchRunner = (target: ReviewTarget, input: Record<string, Json>) => Promise<CommandResult>;

export const DEFAULT_MAX_BATCHES = 10;
const RISK_REQUESTS: readonly string[] = ['auto', 'low', 'medium', 'high'];
const chars = (value: number) => value.toLocaleString('en-US');

function parseMaxBatches(raw: Json | undefined): number | string {
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_MAX_BATCHES;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value >= 1 ? value : '--max-batches must be a positive integer.';
}

function preflight(input: Record<string, Json>, batchCount: number, label: string): { error: string } | Record<string, never> {
  if (input.mutate === true) {
    return { error: `Refusing to review ${label} with --split --mutate: each batch would run its own mutation pass and the results would be lost from the merged report. Review with --split, then run agon mutate --diff <target> separately.` };
  }
  const maxBatches = parseMaxBatches(input['max-batches']);
  if (typeof maxBatches === 'string') return { error: maxBatches };
  if (batchCount > maxBatches) {
    return { error: `Refusing to review ${label} with --split: it needs ${batchCount} batches, over the limit of ${maxBatches}, and each batch spends a full panel. Raise the limit with --max-batches ${batchCount} or review a smaller target.` };
  }
  return {};
}

export async function runSplitReview(
  target: ReviewTarget,
  limit: number,
  input: Record<string, Json>,
  format: ReviewFormat,
  context: InvocationContext,
  services: ModServices,
  runBatch: ReviewBatchRunner,
): Promise<CommandResult> {
  const files = splitDiffByFile(target.diff);
  const oversized = files.filter(file => file.text.length > limit);
  if (oversized.length) return { exitCode: 1, stderr: `${oversizedFilesMessage(target.label, oversized, limit)}\n` };

  const batches = batchFiles(files, limit);
  const refused = preflight(input, batches.length, target.label);
  if ('error' in refused) return { exitCode: 1, stderr: `${refused.error}\n` };
  const requestedRisk = (typeof input.risk === 'string' && input.risk.trim() ? input.risk.trim().toLowerCase() : 'auto');
  if (!RISK_REQUESTS.includes(requestedRisk)) return { exitCode: 1, stderr: `Unknown review risk "${requestedRisk}". Use auto, low, medium, or high.\n` };
  const wholeDiffRisk = inferReviewRisk(target.diff, requestedRisk as ReviewRiskRequest).final;
  process.stderr.write(`agon review --split: ${batches.length} batches of at most ${chars(limit)} chars, each with the full routed panel\n`);

  const startedAtMs = Date.now();
  const deadlineSeconds = typeof input.deadline === 'string' && input.deadline.trim() ? Number(input.deadline) : undefined;
  const run = await services.runs?.start('review', typeof input.label === 'string' && input.label.trim() ? input.label.trim() : undefined, context);
  const reports: BatchReport[] = [];
  const details: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];
  let exitCode = 0;
  let incomplete = 0;
  let haltedBy: number | undefined;
  const markIncomplete = (detail: Record<string, unknown>, status: 'failed' | 'skipped', reason: string, number: number) => {
    detail.status = status;
    detail.exitCode = 1;
    detail.error = reason;
    incomplete += 1;
    warnings.push(`batch ${number}/${batches.length} was ${status === 'failed' ? 'not usably reviewed' : 'not reviewed'}: ${reason}`);
  };
  for (const [index, batch] of batches.entries()) {
    const number = index + 1;
    const text = batch.map(file => file.text).join('');
    const remaining = deadlineSeconds === undefined ? undefined : Math.ceil(deadlineSeconds - (Date.now() - startedAtMs) / 1000);
    const detail: Record<string, unknown> = { batch: number, files: batch.map(file => file.path), chars: text.length };
    details.push(detail);
    if (haltedBy !== undefined) {
      markIncomplete(detail, 'skipped', `batch ${haltedBy} produced no usable review, so remaining batches were not dispatched`, number);
      continue;
    }
    if (context.signal.aborted || (remaining !== undefined && remaining < 1)) {
      markIncomplete(detail, 'skipped', context.signal.aborted ? 'review was aborted before this batch' : 'review deadline passed before this batch', number);
      continue;
    }
    let outcome: CommandResult;
    try {
      outcome = await runBatch(
        { diff: text, label: `${target.label} (batch ${number}/${batches.length})`, maxDiffChars: limit },
        { ...input, split: false, format: 'json', quiet: false, risk: wholeDiffRisk, ...(remaining !== undefined ? { deadline: String(remaining) } : {}) },
      );
    } catch (error) {
      markIncomplete(detail, 'failed', error instanceof Error ? error.message : String(error), number);
      haltedBy = number;
      continue;
    }
    detail.exitCode = outcome.exitCode;
    const report = outcome.result as BatchReport | undefined;
    if (report) {
      reports.push({ ...report, batch: number });
      if (report.runDir) detail.runDir = report.runDir;
      if (report.routing) detail.routing = report.routing;
      warnings.push(...(report.warnings ?? []).map(warning => `batch ${number}: ${warning}`));
    }
    if (outcome.exitCode === 1) {
      markIncomplete(detail, 'failed', outcome.stderr?.trim() || 'no reviewer produced evidence', number);
      haltedBy = number;
    } else {
      detail.status = 'ok';
      exitCode = Math.max(exitCode, outcome.exitCode);
    }
  }
  if (incomplete) exitCode = 1;

  const summaryLine = `split into ${batches.length} batches of at most ${chars(limit)} chars (${chars(target.diff.length)} chars total)`;
  const incompleteNote = incomplete ? `${incomplete} of ${batches.length} batches incomplete` : undefined;
  const merged = {
    target: target.label,
    split: {
      batches: batches.length, files: files.length, totalChars: target.diff.length, ...(incomplete ? { incomplete } : {}),
      note: `${summaryLine}; ${SPLIT_CAVEAT}${incompleteNote ? `; ${incompleteNote}` : ''}`, details,
    },
    engines: [...new Set(reports.flatMap(report => report.engines ?? []))],
    roles: Object.assign({}, ...reports.map(report => report.roles ?? {})) as Record<string, string>,
    reviews: reports.flatMap(report => (report.reviews ?? []).map(review => ({ ...review, batch: report.batch as number }))),
    findings: reports.flatMap(report => report.findings ?? []),
    consensus: mergeConsensus(reports.flatMap(report => report.consensus ? [report.consensus] : [])),
    panelHealth: {
      requested: reports.reduce((sum, report) => sum + (report.panelHealth?.requested ?? 0), 0),
      responded: reports.reduce((sum, report) => sum + (report.panelHealth?.responded ?? 0), 0),
      degraded: incomplete > 0 || reports.some(report => report.panelHealth?.degraded),
    },
    warnings: [`${summaryLine}; ${SPLIT_CAVEAT}`, ...(incompleteNote ? [`${incompleteNote}; the verdict does not cover the whole diff`] : []), ...warnings],
    ...(run ? { runDir: run.path } : {}),
  };
  const report = redactSecretsDeep(merged);
  if (run) {
    await services.runs!.writeArtifact(run, 'diff.patch', redactSecretsPreservingLines(target.diff), context);
    await services.runs!.writeArtifact(run, 'report.json', `${JSON.stringify(report, null, 2)}\n`, context);
    await services.runs!.finish(run, {
      mode: 'review', startedAt: run.startedAt, endedAt: new Date().toISOString(),
      engines: merged.reviews.map(review => ({ id: review.engineId, status: review.status, detail: review.error || null })),
      requested: merged.engines, timeoutSec: null,
      summary: `${summaryLine}; ${merged.panelHealth.responded}/${merged.panelHealth.requested} seats produced machine-readable evidence${incompleteNote ? `; ${incompleteNote}` : ''}`,
      ok: exitCode === 0,
    }, context);
  }
  return {
    exitCode,
    stdout: input.quiet === true && format !== 'sarif'
      ? `${run ? `${run.path}\n` : ''}${formatSummaryLine(report as unknown as ReviewReport)}\n`
      : formatReport(report as unknown as ReviewReport, format, { verbose: input.verbose === true }),
    result: report as unknown as Json,
  };
}
