/**
 * Project-memory file, relative to cwd. Same file scanProjectContext injects and context-scanner parses for `fitness:`.
 */
export const MEMORY_FILE_REL: string = '.agon/project.md';

/**
 * Canonical section names. SaveMemory refuses any other section so the file stays predictable. Exported so the MCP write-tool branch validates/canonicalizes against the SAME list as the core tool (no two-path divergence).
 */
export const MEMORY_SECTIONS: string[] = ['Decisions', 'Constraints', 'Conventions', 'Session Notes'];

/**
 * Per-section cap. At the cap, the OLDEST entry is dropped (append still lands) so durable memory never silently fails to record the newest fact.
 */
export const SECTION_CAP: number = 30;

/**
 * Canonicalize a section name against MEMORY_SECTIONS (case-insensitive, trimmed). Returns the canonical casing ('decisions' -> 'Decisions') or null when it matches no managed section. Shared so every SaveMemory entry point (the core tool's validate/checkPermission/execute AND the MCP write-tool branch) produces identical headers and rejects the same non-canonical sections — no two-path divergence.
 */
export function canonicalMemorySection(section: unknown): string | null {
  const want = String(section ?? '').trim().toLowerCase();
  if (!want) return null;
  return MEMORY_SECTIONS.find((s) => s.toLowerCase() === want) ?? null;
}

/**
 * Normalize a memory line for dedup comparison: strip a leading markdown bullet and an optional leading YYYY-MM-DD date prefix, collapse internal whitespace, lowercase, trim. So '- 2026-06-11 Use   X' and 'use x' compare equal.
 */
export function normalizeMemoryLine(line: string): string {
  return String(line ?? '')
    .replace(/^[\s>*-]+/, '')              // leading bullet/quote/space
    .replace(/^\d{4}-\d{2}-\d{2}\s+/, '')  // leading date prefix
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Today's date as YYYY-MM-DD (UTC-stable via toISOString slice).
 */
export function todayPrefix(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface MemoryAppendResult {
  content: string;
  changed: boolean;
  status: 'added'|'duplicate'|'evicted';
}

/**
 * Pure append-with-dedup over markdown content. Inserts a dated one-liner ('- <dateStr> <text>') as the LAST item under '## <section>', creating the section (appended at end) when absent and the whole file when empty. Skips when a near-identical line already exists in that section (whitespace/case/date-insensitive via normalizeMemoryLine). Honors SECTION_CAP by dropping the OLDEST entry in the section when full. Never touches other sections or non-section lines (e.g. a `fitness:` line). dateStr is the YYYY-MM-DD prefix (caller passes todayPrefix()); kept as a param so this stays a PURE, deterministically-testable function (no clock dependency).
 */
export function appendMemoryLine(existing: string, section: string, text: string, dateStr: string): MemoryAppendResult {
  const datePrefix = dateStr;
  const cleanText = String(text ?? '').replace(/\s+/g, ' ').trim();
  const newLine = `- ${datePrefix} ${cleanText}`;
  const newKey = normalizeMemoryLine(newLine);

  const src = String(existing ?? '');
  const lines = src.length > 0 ? src.split('\n') : [];
  const headerRe = new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');

  // Find the section header index.
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (headerRe.test(lines[i])) { headerIdx = i; break; }
  }

  // Section absent — create it at the end (with a blank-line separator if the
  // file is non-empty and doesn't already end blank).
  if (headerIdx === -1) {
    const out = lines.slice();
    if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
    out.push(`## ${section}`);
    out.push(newLine);
    return { content: out.join('\n'), changed: true, status: 'added' };
  }

  // Determine the section body span: from header+1 up to (but not including)
  // the next '## ' header or EOF.
  let bodyEnd = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) { bodyEnd = i; break; }
  }

  // Collect existing bullet-entry indices in the section body for dedup + cap.
  const entryIdxs: number[] = [];
  for (let i = headerIdx + 1; i < bodyEnd; i += 1) {
    if (lines[i].trim().startsWith('-')) entryIdxs.push(i);
  }

  // Dedup: skip if a near-identical entry already exists in this section.
  for (const idx of entryIdxs) {
    if (normalizeMemoryLine(lines[idx]) === newKey) {
      return { content: src, changed: false, status: 'duplicate' };
    }
  }

  const out = lines.slice();
  let status: MemoryAppendResult['status'] = 'added';

  // Cap: if at/over the cap, drop the OLDEST entry (first '- ' line in the body).
  if (entryIdxs.length >= SECTION_CAP) {
    const oldest = entryIdxs[0];
    out.splice(oldest, 1);
    status = 'evicted';
    // Recompute the insertion point — everything after `oldest` shifted up by 1.
    bodyEnd -= 1;
  }

  // Insert the new line as the LAST entry in the section body. Find the index
  // just after the last existing entry (or right after the header if none),
  // skipping trailing blank lines so the entry sits with its peers.
  let insertAt = headerIdx + 1;
  for (let i = headerIdx + 1; i < bodyEnd; i += 1) {
    if (out[i] !== undefined && out[i].trim().startsWith('-')) insertAt = i + 1;
  }
  // If the line right before insertAt is blank but there were entries, step back
  // so the new entry groups with the existing list rather than after a gap.
  out.splice(insertAt, 0, newLine);

  return { content: out.join('\n'), changed: true, status };
}
