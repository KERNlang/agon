import { describe, it, expect } from 'vitest';
import {
  parseToolHooks,
  hasToolHooks,
  runPreToolUseHooks,
  runPostToolUseHooks,
  executeToolCall,
  ToolRegistry,
} from '@kernlang/agon-core';
import type { ToolContext, ParsedToolHooks, ToolHandler } from '@kernlang/agon-core';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A hook command that captures whatever it receives on stdin into a file, so
// tests can assert on the exact CC-shaped payload the hook engine sends.
function captureCmd(outFile: string, exitCode = 0): string {
  // `cat` the stdin into outFile, then exit with the requested code.
  return `cat > ${JSON.stringify(outFile)}; exit ${exitCode}`;
}

let _tmp: string | null = null;
function tmpFile(name: string): string {
  if (!_tmp) _tmp = mkdtempSync(join(tmpdir(), 'agon-hooks-'));
  return join(_tmp, name);
}

function hooks(over: Partial<ParsedToolHooks>): ParsedToolHooks {
  return { preToolUse: [], postToolUse: [], ...over };
}

describe('parseToolHooks', () => {
  it('returns empty lists for missing / non-object input', () => {
    expect(parseToolHooks(undefined)).toEqual({ preToolUse: [], postToolUse: [] });
    expect(parseToolHooks(null)).toEqual({ preToolUse: [], postToolUse: [] });
    expect(parseToolHooks('nope')).toEqual({ preToolUse: [], postToolUse: [] });
    expect(parseToolHooks([])).toEqual({ preToolUse: [], postToolUse: [] });
  });

  it('extracts preToolUse / postToolUse entries from the hooks record', () => {
    const parsed = parseToolHooks({
      preToolUse: [{ matcher: 'Bash', command: 'echo hi', timeout: 5 }],
      postToolUse: [{ command: 'echo bye' }],
      // an unrelated dispatch-lifecycle hook key must be ignored, not crash
      pre_dispatch: [{ command: 'echo lifecycle' }],
    });
    expect(parsed.preToolUse).toEqual([{ matcher: 'Bash', command: 'echo hi', timeout: 5 }]);
    expect(parsed.postToolUse).toEqual([{ matcher: undefined, command: 'echo bye', timeout: undefined }]);
  });

  it('skips malformed entries (no command / non-object / bad list) fail-safe', () => {
    const parsed = parseToolHooks({
      preToolUse: [{ matcher: 'Bash' }, 'string-entry', { command: '   ' }, { command: 'ok' }],
      postToolUse: 'not-an-array',
    });
    expect(parsed.preToolUse).toEqual([{ matcher: undefined, command: 'ok', timeout: undefined }]);
    expect(parsed.postToolUse).toEqual([]);
  });

  it('hasToolHooks reflects whether any hook is configured', () => {
    expect(hasToolHooks(undefined)).toBe(false);
    expect(hasToolHooks(hooks({}))).toBe(false);
    expect(hasToolHooks(hooks({ preToolUse: [{ command: 'x' }] }))).toBe(true);
    expect(hasToolHooks(hooks({ postToolUse: [{ command: 'x' }] }))).toBe(true);
  });
});

describe('runPreToolUseHooks', () => {
  it('no hooks → proceeds with zero overhead', async () => {
    expect(await runPreToolUseHooks('Bash', { command: 'ls' }, undefined)).toEqual({ block: false });
    expect(await runPreToolUseHooks('Bash', { command: 'ls' }, hooks({}))).toEqual({ block: false });
  });

  it('sends CC-shaped {tool_name, tool_input} JSON on stdin', async () => {
    const out = tmpFile('pre-stdin.json');
    const h = hooks({ preToolUse: [{ command: captureCmd(out, 0) }] });
    const res = await runPreToolUseHooks('Bash', { command: 'echo x', foo: 1 }, h);
    expect(res.block).toBe(false);
    const payload = JSON.parse(readFileSync(out, 'utf-8'));
    expect(payload).toEqual({ tool_name: 'Bash', tool_input: { command: 'echo x', foo: 1 } });
  });

  it('exit 2 blocks with stderr as the engine-visible reason', async () => {
    const h = hooks({ preToolUse: [{ command: 'echo "denied by policy" >&2; exit 2' }] });
    const res = await runPreToolUseHooks('Bash', { command: 'rm -rf /' }, h);
    expect(res.block).toBe(true);
    expect(res.reason).toBe('denied by policy');
  });

  it('exit 0 proceeds', async () => {
    const h = hooks({ preToolUse: [{ command: 'exit 0' }] });
    expect(await runPreToolUseHooks('Bash', { command: 'ls' }, h)).toEqual({ block: false, warning: undefined });
  });

  it('nonzero-non-2 exit proceeds (fail-open) with a warning', async () => {
    const h = hooks({ preToolUse: [{ command: 'exit 7' }] });
    const res = await runPreToolUseHooks('Bash', { command: 'ls' }, h);
    expect(res.block).toBe(false);
    expect(res.warning).toMatch(/exited 7/);
  });

  it('timeout proceeds (fail-open)', async () => {
    const h = hooks({ preToolUse: [{ command: 'sleep 5', timeout: 1 }] });
    const res = await runPreToolUseHooks('Bash', { command: 'ls' }, h);
    expect(res.block).toBe(false);
    expect(res.warning).toMatch(/timed out/);
  });

  it('matcher filtering: a Bash-only hook does not fire for Edit', async () => {
    const out = tmpFile('pre-matcher.json');
    if (existsSync(out)) rmSync(out);
    const h = hooks({ preToolUse: [{ matcher: 'Bash', command: captureCmd(out, 0) }] });
    await runPreToolUseHooks('Edit', { file_path: '/x' }, h);
    expect(existsSync(out)).toBe(false); // hook never ran for Edit
    await runPreToolUseHooks('Bash', { command: 'ls' }, h);
    expect(existsSync(out)).toBe(true); // hook ran for Bash
  });
});

describe('runPostToolUseHooks', () => {
  it('receives {tool_name, tool_input, tool_response} on stdin and never blocks', async () => {
    const out = tmpFile('post-stdin.json');
    const h = hooks({ postToolUse: [{ command: captureCmd(out, 0) }] });
    await runPostToolUseHooks('Bash', { command: 'echo hi' }, 'hi\n', h);
    const payload = JSON.parse(readFileSync(out, 'utf-8'));
    expect(payload).toEqual({ tool_name: 'Bash', tool_input: { command: 'echo hi' }, tool_response: 'hi\n' });
  });

  it('a failing post-hook is ignored (no throw, never blocks)', async () => {
    const h = hooks({ postToolUse: [{ command: 'exit 2' }] });
    await expect(runPostToolUseHooks('Bash', {}, 'x', h)).resolves.toBeUndefined();
  });
});

// ── Integration through the executeToolCall chokepoint ────────────────

function makeRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  const echo: ToolHandler = {
    definition: {
      name: 'Echo',
      description: 'test echo',
      inputSchema: {},
      maxResultSizeChars: 10000,
      isReadOnly: true,
      isConcurrencySafe: false,
    },
    validate: () => null,
    checkPermission: () => ({ behavior: 'allow' }),
    execute: async (input) => ({ ok: true, content: `ran:${(input as any).msg ?? ''}` }),
  };
  reg.register(echo);
  return reg;
}

function makeCtx(over?: Partial<ToolContext>): ToolContext {
  return { cwd: process.cwd(), readFileState: new Map(), permissionMode: 'auto', ...over } as ToolContext;
}

describe('executeToolCall hook integration', () => {
  it('PreToolUse exit 2 blocks the tool before it executes (error = stderr)', async () => {
    const reg = makeRegistry();
    const ctx = makeCtx({ toolHooks: hooks({ preToolUse: [{ command: 'echo "nope" >&2; exit 2' }] }) });
    const r = await executeToolCall({ id: '1', name: 'Echo', input: { msg: 'x' } }, ctx, reg);
    expect(r.result.ok).toBe(false);
    expect(r.result.error).toBe('nope');
  });

  it('PreToolUse exit 0 lets the tool run', async () => {
    const reg = makeRegistry();
    const ctx = makeCtx({ toolHooks: hooks({ preToolUse: [{ command: 'exit 0' }] }) });
    const r = await executeToolCall({ id: '2', name: 'Echo', input: { msg: 'y' } }, ctx, reg);
    expect(r.result.ok).toBe(true);
    expect(r.result.content).toBe('ran:y');
  });

  it('PostToolUse receives the tool_response and cannot block a successful call', async () => {
    const out = tmpFile('exec-post.json');
    const reg = makeRegistry();
    const ctx = makeCtx({ toolHooks: hooks({ postToolUse: [{ command: captureCmd(out, 2) }] }) });
    const r = await executeToolCall({ id: '3', name: 'Echo', input: { msg: 'z' } }, ctx, reg);
    expect(r.result.ok).toBe(true);
    expect(r.result.content).toBe('ran:z');
    const payload = JSON.parse(readFileSync(out, 'utf-8'));
    expect(payload.tool_name).toBe('Echo');
    expect(payload.tool_response).toBe('ran:z');
  });

  it('matcher filtering: a Bash-only hook does not block a different tool', async () => {
    const reg = makeRegistry();
    const ctx = makeCtx({ toolHooks: hooks({ preToolUse: [{ matcher: 'Bash', command: 'exit 2' }] }) });
    const r = await executeToolCall({ id: '4', name: 'Echo', input: {} }, ctx, reg);
    expect(r.result.ok).toBe(true);
  });

  it('no hooks configured → tool runs normally (zero-overhead path)', async () => {
    const reg = makeRegistry();
    const r = await executeToolCall({ id: '5', name: 'Echo', input: { msg: 'q' } }, makeCtx(), reg);
    expect(r.result.ok).toBe(true);
    expect(r.result.content).toBe('ran:q');
  });
});
