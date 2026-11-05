import type { ConsensusFinding, ConsensusReport } from './consensus.js';

export const REVIEW_FORMATS = ['json', 'text', 'sarif'] as const;
export type ReviewFormat = (typeof REVIEW_FORMATS)[number];

export function parseReviewFormat(raw: unknown): ReviewFormat | null {
  const value = typeof raw === 'string' && raw.trim() ? raw.trim().toLowerCase() : 'json';
  return (REVIEW_FORMATS as readonly string[]).includes(value) ? (value as ReviewFormat) : null;
}

interface ReportSeat {
  readonly engineId: string;
  readonly status: string;
  readonly role?: string;
  readonly error?: string;
  readonly output?: string;
  readonly batch?: number;
}

export const SPLIT_CAVEAT = 'cross-file issues between batches may be missed';

export interface ReviewTextOptions {
  readonly verbose?: boolean;
}

export interface ReviewReport {
  readonly target: string;
  readonly diffSize?: { readonly chars: number; readonly maxChars: number };
  readonly reviews: readonly ReportSeat[];
  readonly consensus?: ConsensusReport;
  readonly warnings?: readonly string[];
  readonly runDir?: string;
  readonly panelHealth?: { readonly requested: number; readonly responded: number; readonly degraded: boolean };
  readonly split?: { readonly batches: number; readonly files: number; readonly incomplete?: number; readonly note: string; readonly details: readonly unknown[] };
}

export function lineRegion(lines: string | undefined): { startLine: number; endLine: number } | undefined {
  const match = /^\s*(\d+)(?:\s*[-–]\s*(\d+))?/.exec(lines ?? '');
  if (!match) return undefined;
  const startLine = Number(match[1]);
  if (startLine < 1) return undefined;
  const endLine = Math.max(startLine, Number(match[2] ?? match[1]));
  return { startLine, endLine };
}

const sarifLevel = (finding: ConsensusFinding) =>
  finding.blocks || finding.severity === 'blocking' ? 'error' : finding.severity === 'important' ? 'warning' : 'note';

const sarifUri = (file: string) => file.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');

function sarifResult(finding: ConsensusFinding) {
  const region = lineRegion(finding.lines);
  const message = finding.minimalFix ? `${finding.problem}\nFix: ${finding.minimalFix}` : finding.problem;
  return {
    ruleId: `agon-review/${finding.severity}`,
    level: sarifLevel(finding),
    message: { text: message },
    ...(finding.file
      ? { locations: [{ physicalLocation: { artifactLocation: { uri: sarifUri(finding.file) }, ...(region ? { region } : {}) } }] }
      : {}),
    properties: {
      tier: finding.tier,
      blocks: finding.blocks,
      engines: finding.engines,
      confidence: finding.maxConfidence,
      consensusLevel: finding.consensusLevel,
      ...(finding.existingCodeMatch !== undefined ? { existingCodeMatch: finding.existingCodeMatch } : {}),
    },
  };
}

export function formatSarif(report: ReviewReport): string {
  const findings = report.consensus?.findings ?? [];
  const severities = [...new Set(findings.map((finding) => finding.severity))];
  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'agon-review',
          informationUri: 'https://github.com/KERNlang/agon',
          rules: severities.map((severity) => ({ id: `agon-review/${severity}`, name: severity })),
        },
      },
      results: findings.map(sarifResult),
      properties: {
        target: report.target,
        ...(report.diffSize ? { diffSize: report.diffSize } : {}),
        seats: report.reviews.map((seat) => ({ engine: seat.engineId, status: seat.status })),
        ...(report.panelHealth ? { panelHealth: report.panelHealth } : {}),
        ...(report.split ? { split: report.split } : {}),
        degraded: Boolean(report.panelHealth?.degraded || report.consensus?.degraded),
        warnings: report.warnings ?? [],
      },
    }],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}

function textFinding(finding: ConsensusFinding): string {
  const where = finding.file ? `${finding.file}${finding.lines ? `:${finding.lines}` : ''}` : '(no file)';
  const quote = finding.existingCodeMatch === false ? ' [quote not found in file]' : '';
  const fix = finding.minimalFix ? `\n    fix: ${finding.minimalFix}` : '';
  return `  - [${finding.severity}] ${where} (${finding.engines.join(', ')})${quote}\n    ${finding.problem}${fix}`;
}

export function formatSummaryLine(report: ReviewReport): string {
  const ok = report.reviews.filter((seat) => seat.status === 'ok').length;
  const blocking = report.consensus ? `${report.consensus.blockers.length} blocking` : 'blocking unknown';
  const diff = report.diffSize ? `; diff ${report.diffSize.chars}/${report.diffSize.maxChars} chars` : '';
  const incomplete = report.split?.incomplete ? `, ${report.split.incomplete} of ${report.split.batches} batches incomplete` : '';
  const split = report.split ? `; split into ${report.split.batches} batches, ${SPLIT_CAVEAT}${incomplete}` : '';
  return `AGON_SUMMARY: ${ok}/${report.reviews.length} seats ok; ${blocking}${diff}${split}`;
}

export function formatText(report: ReviewReport, options: ReviewTextOptions = {}): string {
  const consensus = report.consensus;
  const ok = report.reviews.filter((seat) => seat.status === 'ok').length;
  const lines = [`Review: ${report.target}`];
  if (report.diffSize) lines.push(`Diff: ${report.diffSize.chars.toLocaleString('en-US')} chars (limit ${report.diffSize.maxChars.toLocaleString('en-US')})`);
  lines.push(`Seats: ${ok}/${report.reviews.length} ok`);
  for (const seat of report.reviews) {
    if (seat.status !== 'ok') lines.push(`  ${seat.engineId}${seat.batch ? ` [batch ${seat.batch}]` : ''}: ${seat.status}${seat.error ? ` (${seat.error})` : ''}`);
  }
  const groups: Array<[string, readonly ConsensusFinding[]]> = consensus
    ? [['Blockers', consensus.blockers], ['Needs check', consensus.needsCheck], ['Speculative', consensus.speculative], ['Nits', consensus.nits]]
    : [];
  for (const [title, findings] of groups) {
    if (findings.length) lines.push(`${title} (${findings.length}):`, ...findings.map(textFinding));
  }
  if (consensus && !consensus.findings.length) lines.push('No findings.');
  for (const warning of report.warnings ?? []) lines.push(`warning: ${warning}`);
  if (options.verbose) {
    for (const seat of report.reviews) if (seat.output) lines.push('', `--- ${seat.engineId} ---`, seat.output.trimEnd());
    lines.push('');
  }
  if (report.runDir) lines.push(`AGON_RUN: ${report.runDir}`);
  lines.push(formatSummaryLine(report));
  return `${lines.join('\n')}\n`;
}

export function formatReport(report: ReviewReport, format: ReviewFormat, options: ReviewTextOptions = {}): string {
  if (format === 'sarif') return formatSarif(report);
  if (format === 'text') return formatText(report, options);
  return `${JSON.stringify(report, null, 2)}\n`;
}
