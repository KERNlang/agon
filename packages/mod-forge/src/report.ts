export interface ForgeTextCandidate {
  readonly engineId: string;
  readonly pass: boolean;
  readonly status?: string;
  readonly score: number;
  readonly diffLines: number;
  readonly filesChanged: number;
  readonly durationMs?: number;
  readonly patchPath?: string;
}

export interface ForgeTextReport {
  readonly status: string;
  readonly error?: string;
  readonly task: string;
  readonly fitness: string;
  readonly baseline: { readonly exitCode?: number | null } | null;
  readonly winner: string | null | undefined;
  readonly candidates: readonly ForgeTextCandidate[];
  readonly skippedEngines: readonly { readonly engineId: string; readonly reason?: string; readonly status?: string }[];
  readonly requested: number;
  readonly runDir: string;
}

function table(rows: readonly (readonly string[])[]): string[] {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map(row => row[column]!.length)));
  return rows.map(row => row.map((cell, column) => cell.padEnd(widths[column]!)).join('  ').trimEnd());
}

export function formatForgeText(report: ForgeTextReport): string {
  const lines = [`Forge: ${report.task}`];
  if (report.fitness) lines.push(`Fitness: ${report.fitness}`);
  if (report.baseline && report.baseline.exitCode !== 0) lines.push('warning: baseline fails before candidate patches');
  const header = ['', 'Engine', 'Status', 'Score', 'Diff', 'Files', 'Time'];
  const rows = report.candidates.map(candidate => [
    candidate.engineId === report.winner ? '*' : '',
    candidate.engineId,
    candidate.status ?? (candidate.pass ? 'passed' : 'failed'),
    String(candidate.score),
    String(candidate.diffLines),
    String(candidate.filesChanged),
    candidate.durationMs === undefined ? '' : `${Math.round(candidate.durationMs / 1000)}s`,
  ]);
  if (rows.length) lines.push('', ...table([header, ...rows]), '');
  for (const skipped of report.skippedEngines) lines.push(`skipped ${skipped.engineId}: ${skipped.reason ?? skipped.status ?? 'unavailable'}`);
  if (report.error) lines.push(`Failed: ${report.error}`);
  lines.push(report.winner ? `Winner: ${report.winner}` : 'No winner');
  const patch = report.candidates.find(candidate => candidate.engineId === report.winner)?.patchPath;
  if (patch) lines.push(`Patch: ${patch}`);
  lines.push(`AGON_RUN: ${report.runDir}`);
  const passed = report.candidates.filter(candidate => candidate.pass).length;
  lines.push(`AGON_SUMMARY: ${passed}/${report.requested} passed`);
  return `${lines.join('\n')}\n`;
}
