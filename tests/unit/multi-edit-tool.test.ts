// MultiEdit: an ordered, ATOMIC batch of exact string replacements to a
// single file. Edits fold sequentially over an in-memory buffer (each edit
// sees the result of the previous one); the file is written exactly once and
// only if every edit succeeds — a mid-batch failure leaves disk untouched.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolContext } from '@kernlang/agon-core';
import { createMultiEditTool } from '../../packages/core/src/generated/tools/tool-multi-edit.js';

// Redirect AGON_HOME to a temp dir so takeSnapshot() (called on the real-FS
// write path) never writes under the user's real ~/.agon in CI/sandboxes.
// Set at module scope — runs after imports but before any test executes.
process.env.AGON_HOME = mkdtempSync(join(tmpdir(), 'agon-home-'));

function makeCtx(cwd: string, filePath: string, content: string, timestamp?: number): ToolContext {
  return {
    cwd,
    source: 'tool',
    permissionMode: 'auto',
    readFileState: new Map([
      [filePath, {
        content,
        timestamp: timestamp ?? statSync(filePath).mtimeMs,
        offset: 0,
        limit: 2000,
        isPartialView: false,
      }],
    ]),
  } as unknown as ToolContext;
}

function setup(content: string): { cwd: string; filePath: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-multiedit-'));
  const filePath = join(cwd, 'src.ts');
  writeFileSync(filePath, content);
  return { cwd, filePath };
}

const tool = createMultiEditTool();

describe('MultiEdit · validate', () => {
  it('rejects a missing/empty edits array', () => {
    expect(tool.validate!({ file_path: 'a.ts' }, {} as ToolContext)).toMatch(/edits/);
    expect(tool.validate!({ file_path: 'a.ts', edits: [] }, {} as ToolContext)).toMatch(/non-empty/);
  });

  it('rejects an empty old_string (no file-creation mode — use Write)', () => {
    const err = tool.validate!({ file_path: 'a.ts', edits: [{ old_string: '', new_string: 'x' }] }, {} as ToolContext);
    expect(err).toMatch(/empty/);
    expect(err).toMatch(/Write/);
  });

  it('rejects a no-op edit (old_string === new_string)', () => {
    expect(tool.validate!({ file_path: 'a.ts', edits: [{ old_string: 'x', new_string: 'x' }] }, {} as ToolContext)).toMatch(/identical/);
  });

  it('reports the failing edit index', () => {
    const err = tool.validate!({ file_path: 'a.ts', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 5, new_string: 'c' }] }, {} as ToolContext);
    expect(err).toMatch(/edits\[1\]/);
  });

  it('accepts a well-formed batch', () => {
    expect(tool.validate!({ file_path: 'a.ts', edits: [{ old_string: 'a', new_string: 'b' }] }, {} as ToolContext)).toBeNull();
  });
});

describe('MultiEdit · execute', () => {
  it('applies edits sequentially over the same buffer (edit B sees edit A output)', async () => {
    const { cwd, filePath } = setup('const a = 1;\nconst b = 2;\n');
    const res = await tool.execute({
      file_path: filePath,
      edits: [
        { old_string: 'const a = 1;', new_string: 'const a = 10;' },
        { old_string: 'const a = 10;', new_string: 'const a = 100;' }, // targets edit A's output
        { old_string: 'const b = 2;', new_string: 'const b = 20;' },
      ],
    }, makeCtx(cwd, filePath, 'const a = 1;\nconst b = 2;\n'));
    expect(res.ok).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe('const a = 100;\nconst b = 20;\n');
  });

  it('is ATOMIC: a later failing edit leaves the file untouched on disk', async () => {
    const original = 'alpha\nbeta\ngamma\n';
    const { cwd, filePath } = setup(original);
    const res = await tool.execute({
      file_path: filePath,
      edits: [
        { old_string: 'alpha', new_string: 'ALPHA' },
        { old_string: 'beta', new_string: 'BETA' },
        { old_string: 'DOES_NOT_EXIST', new_string: 'x' }, // fails — whole batch aborts
      ],
    }, makeCtx(cwd, filePath, original));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/edits\[2\]/);
    expect(res.error).toMatch(/not found/);
    expect(readFileSync(filePath, 'utf-8')).toBe(original); // untouched
  });

  it('enforces uniqueness per edit unless replace_all is set', async () => {
    const original = 'x = 1\nx = 1\n';
    const { cwd, filePath } = setup(original);
    const fail = await tool.execute({
      file_path: filePath,
      edits: [{ old_string: 'x = 1', new_string: 'x = 2' }],
    }, makeCtx(cwd, filePath, original));
    expect(fail.ok).toBe(false);
    expect(fail.error).toMatch(/matches 2/);
    expect(readFileSync(filePath, 'utf-8')).toBe(original);

    const ok = await tool.execute({
      file_path: filePath,
      edits: [{ old_string: 'x = 1', new_string: 'x = 2', replace_all: true }],
    }, makeCtx(cwd, filePath, original));
    expect(ok.ok).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe('x = 2\nx = 2\n');
  });

  it('blocks edits to a file that was never read', async () => {
    const { cwd, filePath } = setup('hello\n');
    const ctx = { cwd, source: 'tool', permissionMode: 'auto', readFileState: new Map() } as unknown as ToolContext;
    const res = await tool.execute({ file_path: filePath, edits: [{ old_string: 'hello', new_string: 'bye' }] }, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not been read/);
  });

  it('blocks edits when the file is stale (modified since last read)', async () => {
    const original = 'v1\n';
    const { cwd, filePath } = setup(original);
    const ctx = makeCtx(cwd, filePath, original, statSync(filePath).mtimeMs - 10_000); // cached older than disk
    const res = await tool.execute({ file_path: filePath, edits: [{ old_string: 'v1', new_string: 'v2' }] }, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/modified since last read/);
  });

  it('falls back to curly-quote normalization when an exact match fails', async () => {
    const original = 'const msg = “hi”;\n'; // smart double quotes
    const { cwd, filePath } = setup(original);
    const res = await tool.execute({
      file_path: filePath,
      edits: [{ old_string: 'const msg = "hi";', new_string: 'const msg = "bye";' }], // straight quotes
    }, makeCtx(cwd, filePath, original));
    expect(res.ok).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toContain('bye');
  });

  it('curly-quote fallback leaves UNRELATED smart quotes in the file untouched', async () => {
    // The matched region uses smart quotes; an unrelated comment also has them.
    const original = '// keep “these” curlies\nconst msg = “hi”;\n';
    const { cwd, filePath } = setup(original);
    const res = await tool.execute({
      file_path: filePath,
      edits: [{ old_string: 'const msg = "hi";', new_string: 'const msg = "bye";' }],
    }, makeCtx(cwd, filePath, original));
    expect(res.ok).toBe(true);
    const out = readFileSync(filePath, 'utf-8');
    expect(out).toContain('const msg = "bye";');     // matched region → straight quotes
    expect(out).toContain('// keep “these” curlies'); // unrelated curlies preserved
  });

  it('routes through VirtualFS when present (no disk read-before-write needed)', async () => {
    const store = new Map<string, string>([['/v/a.ts', 'one two three\n']]);
    const virtualFs = {
      read: (p: string) => (store.has(p) ? store.get(p)! : null),
      write: (p: string, c: string) => { store.set(p, c); },
    };
    const ctx = { cwd: '/v', source: 'tool', permissionMode: 'auto', readFileState: new Map(), virtualFs } as unknown as ToolContext;
    const res = await tool.execute({
      file_path: '/v/a.ts',
      edits: [{ old_string: 'one', new_string: 'ONE' }, { old_string: 'three', new_string: 'THREE' }],
    }, ctx);
    expect(res.ok).toBe(true);
    expect(store.get('/v/a.ts')).toBe('ONE two THREE\n');
  });
});
