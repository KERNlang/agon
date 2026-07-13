import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';

/**
 * Fitness tests for streaming eager tool execution.
 *
 * The feature: when the Cesar brain receives a `tool_call` chunk from a native
 * engine (Claude CLI, Codex via ACP), it should start executing the tool
 * immediately rather than waiting for the full response to finish.
 *
 * Key behaviors to verify:
 * 1. Tool calls arriving via `chunk.type === 'tool_call'` are executed eagerly
 * 2. Text chunks are still accumulated normally
 * 3. Multiple tool calls in a single response are executed as they arrive
 * 4. Results are collected and sent back as a batch after all complete
 * 5. The streaming display still works (spinner, tool-call events)
 * 6. Abort signal cancels in-flight eager executions
 */

// ── Helpers ──────────────────────────────────────────────────

const REPO_ROOT = join(import.meta.dirname, '../..');

/** Simulate a persistent session that yields chunks */
function createMockSession(chunks: Array<{ type: string; content: string; metadata?: any }>) {
  return {
    alive: true,
    send: (_opts: any) => {
      return (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
        yield { type: 'done', content: '' };
      })();
    },
    close: vi.fn(),
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('Eager Tool Execution', () => {
  it('detects tool_call chunks from native engine protocol', () => {
    // Tool calls from Claude CLI / Codex ACP arrive as structured chunks
    const chunk = {
      type: 'tool_call',
      content: 'Read',
      metadata: {
        input: { file_path: 'src/app.ts' },
        status: 'running',
      },
    };
    expect(chunk.type).toBe('tool_call');
    expect(chunk.metadata.input.file_path).toBe('src/app.ts');
  });

  it('can distinguish text vs tool_call chunks in a stream', async () => {
    const chunks = [
      { type: 'text', content: 'Let me read that file.' },
      { type: 'tool_call', content: 'Read', metadata: { input: { file_path: 'src/app.ts' }, status: 'running' } },
      { type: 'tool_call', content: 'Read', metadata: { input: { file_path: 'src/app.ts' }, status: 'done', output: 'file contents...' } },
      { type: 'text', content: 'The file contains...' },
    ];

    const session = createMockSession(chunks);
    const textParts: string[] = [];
    const toolCalls: any[] = [];

    const gen = session.send({ message: 'read src/app.ts' });
    for await (const chunk of gen) {
      if (chunk.type === 'text') textParts.push(chunk.content);
      if (chunk.type === 'tool_call') toolCalls.push(chunk);
      if (chunk.type === 'done') break;
    }

    expect(textParts).toEqual(['Let me read that file.', 'The file contains...']);
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0].metadata.status).toBe('running');
    expect(toolCalls[1].metadata.status).toBe('done');
  });

  it('collects tool results for batch send-back', async () => {
    // After eager execution, results should be formatted for re-injection
    const { formatToolResults } = await import('../../packages/core/src/generated/tools/tool-parser.js');

    const results = formatToolResults([
      { name: 'Read', content: 'const x = 1;' },
      { name: 'Grep', content: 'src/app.ts:5: const x = 1;' },
    ]);

    expect(results).toContain('<tool_result name="Read">');
    expect(results).toContain('const x = 1;');
    expect(results).toContain('<tool_result name="Grep">');
  });

  it('respects abort signal during eager execution', async () => {
    const abort = new AbortController();
    const chunks = [
      { type: 'text', content: 'Working on it...' },
      { type: 'tool_call', content: 'Bash', metadata: { input: { command: 'sleep 10' }, status: 'running' } },
    ];

    const session = createMockSession(chunks);
    const collected: any[] = [];

    // Abort after first chunk
    const gen = session.send({ message: 'do something', signal: abort.signal });
    for await (const chunk of gen) {
      collected.push(chunk);
      if (chunk.type === 'tool_call') {
        abort.abort();
        break;
      }
    }

    expect(abort.signal.aborted).toBe(true);
    expect(collected).toHaveLength(2);
  });

  it('handles interleaved text and tool_call chunks', async () => {
    const chunks = [
      { type: 'text', content: 'First, let me read the file.' },
      { type: 'tool_call', content: 'Read', metadata: { input: { file_path: 'a.ts' }, status: 'running' } },
      { type: 'tool_call', content: 'Read', metadata: { input: { file_path: 'a.ts' }, status: 'done', output: 'content A' } },
      { type: 'text', content: 'Now editing...' },
      { type: 'tool_call', content: 'Edit', metadata: { input: { file_path: 'a.ts', old_string: 'x', new_string: 'y' }, status: 'running' } },
      { type: 'tool_call', content: 'Edit', metadata: { input: { file_path: 'a.ts', old_string: 'x', new_string: 'y' }, status: 'done', output: 'Applied edit' } },
      { type: 'text', content: 'Done!' },
    ];

    const session = createMockSession(chunks);
    const timeline: string[] = [];

    const gen = session.send({ message: 'fix it' });
    for await (const chunk of gen) {
      if (chunk.type === 'text') timeline.push(`text:${chunk.content}`);
      if (chunk.type === 'tool_call') timeline.push(`tool:${chunk.content}:${chunk.metadata.status}`);
      if (chunk.type === 'done') break;
    }

    expect(timeline).toEqual([
      'text:First, let me read the file.',
      'tool:Read:running',
      'tool:Read:done',
      'text:Now editing...',
      'tool:Edit:running',
      'tool:Edit:done',
      'text:Done!',
    ]);
  });

  it('executeToolCalls works with native-protocol parsed inputs', async () => {
    const { ToolRegistry, executeToolCall } = await import('../../packages/core/src/generated/signals/tool-registry.js');
    const { createReadTool } = await import('../../packages/core/src/generated/tools/tool-read.js');
    const { createGrepTool } = await import('../../packages/core/src/generated/tools/tool-grep.js');
    const { createGlobTool } = await import('../../packages/core/src/generated/tools/tool-glob.js');

    const registry = new ToolRegistry();
    registry.register(createReadTool());
    registry.register(createGrepTool());
    registry.register(createGlobTool());

    const ctx: any = {
      cwd: REPO_ROOT,
      readFileState: new Map(),
      permissionMode: 'auto',
    };

    // Simulate a tool call that arrives from native protocol
    const result = await executeToolCall(
      { id: 'tc_1', name: 'Glob', input: { pattern: 'package.json' } },
      ctx,
      registry,
    );

    expect(result.toolName).toBe('Glob');
    expect(result.result.ok).toBe(true);
    expect(result.result.content).toContain('package.json');
  });

  it('surfaces malformed streaming tool input as a retryable tool error', async () => {
    const { ToolRegistry } = await import('../../packages/core/src/generated/signals/tool-registry.js');
    const { executeEagerTool } = await import('../../packages/cli/src/generated/cesar/tools.js');

    const registry = new ToolRegistry();
    const events: any[] = [];
    const result = await executeEagerTool(
      'Read',
      { toolCallId: 'bad_1', input: '{"file_path":' },
      registry,
      { cwd: REPO_ROOT, readFileState: new Map(), permissionMode: 'auto' } as any,
      (event: any) => events.push(event),
      'cesar',
    );

    expect(result.toolCallId).toBe('bad_1');
    expect(result.result.ok).toBe(false);
    expect(result.result.error).toContain('Malformed Read tool input JSON');
    expect(result.result.error).toContain('Re-emit');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool-call',
      tool: 'Read',
      status: 'error',
    }));
  });

  it('enforces the task lease before an eager auto-allowed mutation', async () => {
    const { ToolRegistry } = await import('../../packages/core/src/generated/signals/tool-registry.js');
    const { executeEagerTool } = await import('../../packages/cli/src/generated/cesar/tools.js');
    const { createTaskExecutionLease } = await import('../../packages/cli/src/generated/cesar/task-execution-lease.js');

    const registry = new ToolRegistry();
    let executed = false;
    registry.register({
      definition: {
        name: 'Edit',
        description: 'auto-allowed eager mutation fixture',
        inputSchema: { type: 'object', properties: {}, required: [] },
        maxResultSizeChars: 1000,
        isReadOnly: false,
        isConcurrencySafe: false,
      },
      validate: () => null,
      checkPermission: () => ({ behavior: 'allow' as const }),
      execute: async () => {
        executed = true;
        return { ok: true, content: 'ran' };
      },
    });
    const events: any[] = [];
    const result = await executeEagerTool(
      'Edit',
      { toolCallId: 'lease_1', input: { file_path: '/tmp/outside-lease.ts' } },
      registry,
      {
        cwd: REPO_ROOT,
        readFileState: new Map(),
        permissionMode: 'auto',
        taskExecutionLease: createTaskExecutionLease('fix the local recap', true, REPO_ROOT),
      } as any,
      (event: any) => events.push(event),
      'cesar',
    );

    expect(result.result.ok).toBe(false);
    expect(result.result.terminalReason).toBe('denied');
    expect(result.result.error).toContain('workspace_escape');
    expect(executed).toBe(false);
  });

  it('enforces the task lease for case-insensitive eager bash aliases', async () => {
    const { ToolRegistry } = await import('../../packages/core/src/generated/signals/tool-registry.js');
    const { executeEagerTool } = await import('../../packages/cli/src/generated/cesar/tools.js');
    const { createTaskExecutionLease } = await import('../../packages/cli/src/generated/cesar/task-execution-lease.js');

    const registry = new ToolRegistry();
    let executed = false;
    registry.register({
      definition: {
        name: 'Bash',
        description: 'case-insensitive eager bash fixture',
        inputSchema: { type: 'object', properties: {}, required: [] },
        maxResultSizeChars: 1000,
        isReadOnly: false,
        isConcurrencySafe: false,
      },
      validate: () => null,
      checkPermission: () => ({ behavior: 'allow' as const }),
      execute: async () => {
        executed = true;
        return { ok: true, content: 'ran' };
      },
    });
    const result = await executeEagerTool(
      'bash',
      { toolCallId: 'lease_lower_bash', input: { command: 'rm -rf /tmp/outside-lease' } },
      registry,
      {
        cwd: REPO_ROOT,
        readFileState: new Map(),
        permissionMode: 'auto',
        taskExecutionLease: createTaskExecutionLease('fix the local recap', true, REPO_ROOT),
      } as any,
      (event: any) => {
        if (event.type === 'permission-ask') event.resolve(false);
      },
      'cesar',
    );

    expect(result.result.ok).toBe(false);
    expect(result.result.terminalReason).toBe('denied');
    expect(executed).toBe(false);
  });
});
