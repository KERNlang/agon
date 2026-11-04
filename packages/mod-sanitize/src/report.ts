import type { ScanReport } from "./text-forensics.js";

const MAX_LISTED_FINDINGS = 50;

function table(rows: readonly (readonly string[])[]): string[] {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
  return rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column]!)).join("  ").trimEnd());
}

export function formatForensicReport(source: string, report: ScanReport): string {
  const lines = [`Sanitize: ${source}`];
  if (report.findings.length === 0) {
    lines.push("No hidden channels found: text is clean at the character level.");
  } else {
    lines.push("", ...table([["Channel", "Count"], ...Object.entries(report.byChannel).map(([channel, count]) => [channel, String(count)])]));
    const listed = report.findings.slice(0, MAX_LISTED_FINDINGS).map((finding) => [
      String(finding.offset), finding.channel, finding.hex || finding.codepoint, finding.action, finding.detail.slice(0, 50),
    ]);
    lines.push("", ...table([["Offset", "Channel", "Codepoint", "Action", "Detail"], ...listed]));
    if (report.findings.length > MAX_LISTED_FINDINGS) lines.push(`... and ${report.findings.length - MAX_LISTED_FINDINGS} more findings`);
  }
  if (report.notAssessable.length) lines.push("", `Not assessable: ${report.notAssessable.join("; ")}`);
  return `${lines.join("\n")}\n`;
}
