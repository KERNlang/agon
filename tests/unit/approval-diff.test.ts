import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  approvalToolIsFileMutating,
  buildApprovalDiffPreview,
} from '../../packages/cli/src/generated/cesar/approval-diff.js';

describe('approvalToolIsFileMutating', () => {
  it('matches the file-mutating tools (raw + Agon-mapped names)', () => {
    for (const t of ['Edit', 'Write', 'AgonEdit', 'AgonWrite', 'edit', 'write', 'MultiEdit', 'multiedit', 'AgonMultiEdit', 'NotebookEdit', 'AgonNotebookEdit']) {
      expect(approvalToolIsFileMutating(t)).toBe(true);
    }
  });
  it('rejects non-mutating tools', () => {
    for (const t of ['Bash', 'AgonBash', 'Read', 'Grep', 'Glob', '', undefined]) {
      expect(approvalToolIsFileMutating(t)).toBe(false);
    }
  });
});

describe('buildApprovalDiffPreview', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'approval-diff-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('folds a MultiEdit batch into a sequential diff preview', () => {
    const file = join(dir, 'm.ts');
    writeFileSync(file, 'const a = 1;\nconst b = 2;\n');
    const preview = buildApprovalDiffPreview('MultiEdit', {
      file_path: file,
      edits: [
        { old_string: 'const a = 1;', new_string: 'const a = 10;' },
        { old_string: 'const b = 2;', new_string: 'const b = 20;' },
      ],
    });
    expect(preview).toBeTruthy();
    expect((preview as any).files?.length).toBeGreaterThan(0);
  });

  it('returns a fallback note when a MultiEdit edit will not apply', () => {
    const file = join(dir, 'm2.ts');
    writeFileSync(file, 'const a = 1;\n');
    const preview = buildApprovalDiffPreview('MultiEdit', {
      file_path: file,
      edits: [{ old_string: 'NOPE', new_string: 'x' }],
    });
    expect((preview as any)?.fallback).toMatch(/will not apply/);
  });

  it('renders an AgonWrite to a non-existent path as a new file (all additions)', () => {
    const file = join(dir, 'new.ts');
    const preview = buildApprovalDiffPreview('AgonWrite', {
      file_path: file,
      content: 'line a\nline b\nline c\n',
    });
    expect(preview).toBeTruthy();
    expect(preview.totalFiles).toBe(1);
    const f = preview.files[0];
    expect(f.status).toBe('created');
    expect(f.additions).toBe(3);
    expect(f.deletions).toBe(0);
    // First rendered line is the @@ hunk header marking a new file.
    expect(f.lines[0]).toMatch(/new file/);
    expect(f.lines.filter((l: string) => l.startsWith('+'))).toHaveLength(3);
  });

  it('computes a modify diff for AgonEdit (old from disk + proposed change)', () => {
    const file = join(dir, 'mod.ts');
    writeFileSync(file, 'keep\nold middle\ntail\n');
    const preview = buildApprovalDiffPreview('AgonEdit', {
      file_path: file,
      old_string: 'old middle',
      new_string: 'new middle',
    });
    expect(preview).toBeTruthy();
    const f = preview.files[0];
    expect(f.status).toBe('edited');
    expect(f.additions).toBe(1);
    expect(f.deletions).toBe(1);
    const body = f.lines.slice(1); // drop @@ header
    expect(body).toContain('-old middle');
    expect(body).toContain('+new middle');
  });

  it('returns null when AgonEdit old_string is absent (edit would fail)', () => {
    const file = join(dir, 'nomatch.ts');
    writeFileSync(file, 'alpha\nbeta\n');
    const preview = buildApprovalDiffPreview('AgonEdit', {
      file_path: file,
      old_string: 'does-not-exist',
      new_string: 'whatever',
    });
    expect(preview).toBeNull();
  });

  it('returns a fallback note when AgonEdit old_string is empty (edit will fail)', () => {
    const file = join(dir, 'empty-old.ts');
    writeFileSync(file, 'alpha\nbeta\n');
    const preview = buildApprovalDiffPreview('AgonEdit', {
      file_path: file,
      old_string: '',
      new_string: 'inserted',
    });
    expect(preview).toBeTruthy();
    expect(preview.files).toBeUndefined();
    expect(typeof preview.fallback).toBe('string');
    expect(preview.fallback).toMatch(/empty old_string/);
    expect(preview.fallback).toMatch(/edit will fail/);
  });

  it('returns null for a no-op edit (old === new)', () => {
    const file = join(dir, 'noop.ts');
    writeFileSync(file, 'same\n');
    const preview = buildApprovalDiffPreview('AgonEdit', {
      file_path: file,
      old_string: 'same',
      new_string: 'same',
    });
    expect(preview).toBeNull();
  });

  it('caps rendered lines per file and reports omitted count', () => {
    const file = join(dir, 'big.ts');
    // 30 added lines — well over APPROVAL_DIFF_MAX_LINES_PER_FILE (8).
    const content = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') + '\n';
    const preview = buildApprovalDiffPreview('AgonWrite', { file_path: file, content });
    expect(preview).toBeTruthy();
    const f = preview.files[0];
    expect(f.additions).toBe(30);
    // header + at most 8 body lines.
    const body = f.lines.slice(1);
    expect(body.length).toBeLessThanOrEqual(8);
    expect(f.omitted).toBe(30 - body.length);
  });

  it('falls back with a size note for a binary content write', () => {
    const file = join(dir, 'bin.dat');
    const preview = buildApprovalDiffPreview('AgonWrite', {
      file_path: file,
      content: 'before\u0000after',
    });
    expect(preview).toBeTruthy();
    expect(typeof preview.fallback).toBe('string');
    expect(preview.fallback).toMatch(/binary/);
    expect(preview.files).toBeUndefined();
  });

  it('falls back with a size note when the existing file is too large', () => {
    const file = join(dir, 'huge.ts');
    // Just over the 256KB guard.
    writeFileSync(file, 'x'.repeat(262144 + 10));
    const preview = buildApprovalDiffPreview('AgonEdit', {
      file_path: file,
      old_string: 'x',
      new_string: 'y',
    });
    expect(preview).toBeTruthy();
    expect(preview.fallback).toMatch(/KB/);
    expect(preview.files).toBeUndefined();
  });

  it('returns null when no file_path is provided', () => {
    expect(buildApprovalDiffPreview('AgonWrite', { content: 'x' })).toBeNull();
  });

  // ── Finding 2: executor-mirror semantics ──────────────────────────────

  it('returns a fallback note (no fake diff) when old_string matches >1 location and !replace_all', () => {
    const file = join(dir, 'multi.ts');
    writeFileSync(file, 'foo\nbar\nfoo\nbaz\nfoo\n');
    const preview = buildApprovalDiffPreview('AgonEdit', {
      file_path: file,
      old_string: 'foo',
      new_string: 'qux',
    });
    expect(preview).toBeTruthy();
    expect(preview.files).toBeUndefined();
    expect(typeof preview.fallback).toBe('string');
    expect(preview.fallback).toMatch(/matches 3 locations/);
    expect(preview.fallback).toMatch(/edit will fail/);
  });

  it('replace_all=true replaces ALL occurrences in the diff (split/join)', () => {
    const file = join(dir, 'all.ts');
    writeFileSync(file, 'foo\nbar\nfoo\nbaz\nfoo\n');
    const preview = buildApprovalDiffPreview('AgonEdit', {
      file_path: file,
      old_string: 'foo',
      new_string: 'qux',
      replace_all: true,
    });
    expect(preview).toBeTruthy();
    const f = preview.files[0];
    expect(f.additions).toBe(3);
    expect(f.deletions).toBe(3);
    const body = f.lines.slice(1);
    // Every foo line removed, every qux line added.
    expect(body.filter((l: string) => l === '-foo')).toHaveLength(3);
    expect(body.filter((l: string) => l === '+qux')).toHaveLength(3);
  });

  it('matches via curly-quote normalization (mirrors the executor)', () => {
    const file = join(dir, 'curly.ts');
    // On disk: curly quotes. old_string uses straight quotes.
    writeFileSync(file, 'const s = ‘hello’;\n');
    const preview = buildApprovalDiffPreview('AgonEdit', {
      file_path: file,
      old_string: "const s = 'hello';",
      new_string: "const s = 'world';",
    });
    expect(preview).toBeTruthy();
    const f = preview.files[0];
    expect(f.additions).toBe(1);
    expect(f.deletions).toBe(1);
    const body = f.lines.slice(1);
    expect(body).toContain("+const s = 'world';");
  });

  it('returns null for an Edit on a missing file', () => {
    const file = join(dir, 'does-not-exist.ts');
    const preview = buildApprovalDiffPreview('AgonEdit', {
      file_path: file,
      old_string: 'a',
      new_string: 'b',
    });
    expect(preview).toBeNull();
  });

  // ── Finding 4: Write with absent content ──────────────────────────────

  it('returns null for a Write with ABSENT content (degraded args), not a deletion diff', () => {
    const file = join(dir, 'absent.ts');
    writeFileSync(file, 'existing\ncontent\nhere\n');
    // No `content` key at all — degraded command-string args path.
    const preview = buildApprovalDiffPreview('AgonWrite', { file_path: file });
    expect(preview).toBeNull();
  });

  it('still previews a Write with INTENTIONAL empty content (truncation)', () => {
    const file = join(dir, 'truncate.ts');
    writeFileSync(file, 'a\nb\nc\n');
    const preview = buildApprovalDiffPreview('AgonWrite', { file_path: file, content: '' });
    expect(preview).toBeTruthy();
    const f = preview.files[0];
    expect(f.deletions).toBe(3);
    expect(f.additions).toBe(0);
  });

  // ── CRLF + trailing-newline handling ──────────────────────────────────

  it('shows a CRLF content change', () => {
    const file = join(dir, 'crlf.ts');
    writeFileSync(file, 'one\r\ntwo\r\nthree\r\n');
    const preview = buildApprovalDiffPreview('AgonEdit', {
      file_path: file,
      old_string: 'two',
      new_string: 'TWO',
    });
    expect(preview).toBeTruthy();
    const f = preview.files[0];
    expect(f.additions).toBeGreaterThanOrEqual(1);
    expect(f.deletions).toBeGreaterThanOrEqual(1);
  });

  it('makes a no-trailing-newline change visible', () => {
    const file = join(dir, 'nonl.ts');
    // File has NO trailing newline.
    writeFileSync(file, 'alpha\nbeta');
    const preview = buildApprovalDiffPreview('AgonEdit', {
      file_path: file,
      old_string: 'beta',
      new_string: 'gamma',
    });
    expect(preview).toBeTruthy();
    const f = preview.files[0];
    expect(f.additions).toBe(1);
    expect(f.deletions).toBe(1);
    const body = f.lines.slice(1);
    expect(body).toContain('-beta');
    expect(body).toContain('+gamma');
  });

  // ── Finding 3: prefix/suffix trim + LCS line-cap bail ─────────────────

  it('trims common prefix/suffix so a localized edit in a huge file still renders a real diff', () => {
    const file = join(dir, 'huge-localized.ts');
    // ~6000 identical lines surround a single changed line. Without prefix/
    // suffix trimming this would exceed the LCS line cap; with trimming the
    // changed region is tiny and renders normally.
    const head = Array.from({ length: 3000 }, (_, i) => `h${i}`);
    const tail = Array.from({ length: 3000 }, (_, i) => `t${i}`);
    const oldBody = [...head, 'OLD_LINE', ...tail].join('\n') + '\n';
    writeFileSync(file, oldBody);
    const preview = buildApprovalDiffPreview('AgonEdit', {
      file_path: file,
      old_string: 'OLD_LINE',
      new_string: 'NEW_LINE',
    });
    expect(preview).toBeTruthy();
    const f = preview.files[0];
    // Real diff, not the too-large bail.
    expect(f.additions).toBe(1);
    expect(f.deletions).toBe(1);
    expect(f.lines.join('\n')).not.toMatch(/too large/);
    const body = f.lines.slice(1);
    expect(body).toContain('-OLD_LINE');
    expect(body).toContain('+NEW_LINE');
  });

  it('bails to a count-only note when the changed region exceeds the LCS line cap', () => {
    const file = join(dir, 'fully-rewritten.ts');
    // 3000 distinct old lines fully rewritten to 3000 distinct new lines:
    // no common prefix/suffix, so trimming cannot help and n+m=6000 > 1200.
    const oldBody = Array.from({ length: 3000 }, (_, i) => `old-${i}`).join('\n') + '\n';
    const newBody = Array.from({ length: 3000 }, (_, i) => `new-${i}`).join('\n') + '\n';
    writeFileSync(file, oldBody);
    const preview = buildApprovalDiffPreview('AgonWrite', { file_path: file, content: newBody });
    expect(preview).toBeTruthy();
    const f = preview.files[0];
    expect(f.lines[0]).toMatch(/too large to preview/);
    expect(f.additions).toBe(3000);
    expect(f.deletions).toBe(3000);
  });
});
