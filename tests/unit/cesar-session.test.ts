import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolRegistry } from '@kernlang/agon-core';
import type { ToolContext, ToolHandler } from '@kernlang/agon-core';
import { buildCesarConversationSnapshot, buildOnApproval, buildOnToolCall, canUseCesarMcp, loadCesarMcpServers, normalizeCesarMcpServers } from '../../packages/cli/src/generated/cesar/session.js';

const testDirs: string[] = [];

afterEach(() => {
  for (const dir of testDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(name: string): string {
  const dir = join(tmpdir(), `agon-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  testDirs.push(dir);
  return dir;
}

describe('cesar MCP session config', () => {
  it('normalizes named mcpServers objects into an array with names', () => {
    const servers = normalizeCesarMcpServers({
      mcpServers: {
        github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
      },
    });

    expect(servers).toEqual([
      { name: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
    ]);
  });

  it('normalizes servers objects from vscode-style config', () => {
    const servers = normalizeCesarMcpServers({
      servers: {
        linear: { url: 'https://example.com/mcp' },
      },
    });

    expect(servers).toEqual([
      { name: 'linear', url: 'https://example.com/mcp' },
    ]);
  });

  it('returns undefined when Cesar MCP is disabled', () => {
    const dir = makeTempDir('mcp-disabled');
    const servers = loadCesarMcpServers({
      cesarMcpEnabled: false,
      cesarMcpConfigPath: join(dir, 'missing.json'),
    }, dir);

    expect(servers).toBeUndefined();
  });

  it('loads MCP config from a relative JSON path', () => {
    const dir = makeTempDir('mcp-relative');
    const configPath = join(dir, '.vscode');
    mkdirSync(configPath, { recursive: true });
    writeFileSync(join(configPath, 'mcp.json'), JSON.stringify({
      mcpServers: {
        github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
      },
    }));

    const servers = loadCesarMcpServers({
      cesarMcpEnabled: true,
      cesarMcpConfigPath: '.vscode/mcp.json',
    }, dir);

    expect(servers).toEqual([
      { name: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
    ]);
  });

  it('throws when enabled config contains no servers', () => {
    const dir = makeTempDir('mcp-empty');
    const file = join(dir, 'mcp.json');
    writeFileSync(file, JSON.stringify({ mcpServers: {} }));

    expect(() => loadCesarMcpServers({
      cesarMcpEnabled: true,
      cesarMcpConfigPath: file,
    }, dir)).toThrow(/No MCP servers found/);
  });

  it('allows MCP for companion CLI protocols including Codex jsonrpc', () => {
    expect(canUseCesarMcp({ companion: { protocol: 'acp' } }, '/usr/local/bin/gemini')).toBe(true);
    expect(canUseCesarMcp({ companion: { protocol: 'jsonrpc' } }, '/usr/local/bin/codex')).toBe(true);
    expect(canUseCesarMcp({ companion: { protocol: 'structured-cli' } }, '/usr/local/bin/other')).toBe(false);
    expect(canUseCesarMcp({ companion: { protocol: 'jsonrpc' } }, '')).toBe(false);
  });

  it('prefers direct session history for continuity snapshots', () => {
    const snapshot = buildCesarConversationSnapshot({
      engineId: 'claude',
      getMessageHistory: () => [
        { role: 'user', content: 'from session' },
        { role: 'assistant', content: 'session answer' },
      ],
    } as any, {
      messages: [
        { role: 'user', content: 'from chat transcript' },
      ],
    });

    expect(snapshot).toEqual([
      { role: 'user', content: 'from session' },
      { role: 'assistant', content: 'session answer' },
    ]);
  });

  it('falls back to the chat transcript when companion sessions have no local history', () => {
    const snapshot = buildCesarConversationSnapshot({
      engineId: 'codex',
      getMessageHistory: () => [],
    } as any, {
      messages: [
        { role: 'user', content: 'user prompt' },
        { role: 'engine', engineId: 'codex', content: 'other engine reply' },
        { role: 'engine', engineId: 'cesar', content: 'cesar reply' },
      ],
    });

    expect(snapshot).toEqual([
      { role: 'user', content: 'user prompt' },
      { role: 'assistant', content: '[codex] other engine reply' },
      { role: 'assistant', content: 'cesar reply' },
    ]);
  });

  it('caps a huge transcript message so a review/brainstorm reply does not flood Cesar context', () => {
    const huge = 'x'.repeat(30_000); // e.g. a full review or brainstorm engine reply
    const snapshot = buildCesarConversationSnapshot({
      engineId: 'codex',
      getMessageHistory: () => [],
    } as any, {
      messages: [
        { role: 'engine', engineId: 'codex', content: huge },
      ],
    });

    expect(snapshot).toHaveLength(1);
    const content = snapshot[0].content as string;
    // Prefix + 4000-char cap + truncation marker — nowhere near the 30k original.
    expect(content.startsWith('[codex] ')).toBe(true);
    expect(content.length).toBeLessThan(4200);
    expect(content).toContain('chars truncated for Cesar context');
  });

  it('leaves a normal-sized transcript message untouched', () => {
    const snapshot = buildCesarConversationSnapshot({
      engineId: 'codex',
      getMessageHistory: () => [],
    } as any, {
      messages: [{ role: 'engine', engineId: 'codex', content: 'short reply' }],
    });
    expect(snapshot[0].content).toBe('[codex] short reply');
  });

  it('reports blocked fast-path orchestration as a native tool error', async () => {
    const onToolCall = buildOnToolCall({
      cesar: { fastPathMode: 'answer' },
      explorationMode: false,
    } as any, {} as any, {});

    await expect(onToolCall?.('Forge', { task: 'simple question' }, 'call_1')).rejects.toThrow(/\[BLOCKED_FAST_PATH\]/);
  });

  it('blocks mutating Bash while a plan is waiting for approval', async () => {
    const events: any[] = [];
    const onApproval = buildOnApproval({
      config: {},
      activePlan: { id: 'cplan-pending', state: 'awaiting_approval' },
      cesar: {
        turnId: 'turn-pending',
        lastDispatch: (event: any) => events.push(event),
      },
      registry: { get: () => ({}) },
    } as any, 'claude');

    const result = await onApproval('Bash', 'npm run build');

    expect(result).toContain('BLOCKED: Plan mode');
    expect(result).toContain('mutating Bash');
    expect(events).toEqual([]);
  });

  it('does not open a permission prompt for mutating native Bash in plan mode', async () => {
    const registry = new ToolRegistry();
    let permissionAsked = false;
    const bashTool: ToolHandler = {
      definition: {
        name: 'Bash',
        description: 'test bash',
        inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
        maxResultSizeChars: 1000,
        isReadOnly: false,
        isConcurrencySafe: false,
      },
      validate: () => null,
      checkPermission: () => ({ behavior: 'ask', message: 'needs approval' }),
      execute: async () => ({ ok: true, content: 'ran' }),
    };
    registry.register(bashTool);

    const onToolCall = buildOnToolCall({
      cesar: { confidenceSatisfied: true, lastDispatch: () => { permissionAsked = true; } },
      explorationMode: false,
      activePlan: { id: 'cplan-pending', state: 'awaiting_approval' },
    } as any, registry, {});

    const result = await onToolCall?.('Bash', { command: 'npm run build' }, 'call_bash');

    expect(result).toContain('[BLOCKED]');
    expect(result).toContain('Mutating Bash');
    expect(permissionAsked).toBe(false);
  });

  it('stores ReportConfidence reasoning for inline display by the brain', async () => {
    const cesar: any = {
      confidenceSatisfied: false,
      blockedOnConfidence: null,
    };
    const onToolCall = buildOnToolCall({
      cesar,
      explorationMode: false,
    } as any, new ToolRegistry(), {});

    await expect(onToolCall?.('ReportConfidence', {
      value: 92,
      reasoning: 'Read the touched files; tests still need to run.',
    }, 'call_conf')).resolves.toContain('Confidence 92% recorded');

    expect(cesar.reportedConfidence).toBe(92);
    expect(cesar.reportedConfidenceReasoning).toBe('Read the touched files; tests still need to run.');
    expect(cesar.confidenceSatisfied).toBe(true);
  });

  it('creates and displays ProposePlan calls when a plan dispatch is available', async () => {
    const home = makeTempDir('propose-plan');
    const previousHome = process.env.AGON_HOME;
    process.env.AGON_HOME = home;
    try {
      const events: any[] = [];
      let activePlan: any = null;
      const cesar: any = {
        planDispatch: (event: any) => events.push(event),
      };
      const onToolCall = buildOnToolCall({
        cesar,
        explorationMode: false,
        setActivePlan: (plan: any) => { activePlan = plan; },
        registry: { availableIds: () => [] },
      } as any, new ToolRegistry(), {});

      const result = await onToolCall?.('ProposePlan', {
        intent: 'Build the telemetry dashboard.',
        steps: [
          {
            id: 'spec',
            type: 'self',
            description: 'Write the KERN telemetry model and dashboard spec.',
            estimatedTokens: 1000,
            estimatedCostUsd: 0.01,
          },
        ],
      }, 'call_plan');

      expect(result).toContain('[PLAN_PROPOSED]');
      expect(cesar.proposedPlan?.state).toBe('awaiting_approval');
      expect(activePlan?.id).toBe(cesar.proposedPlan.id);
      expect(events.some((event) => event.type === 'plan-proposal')).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env.AGON_HOME;
      else process.env.AGON_HOME = previousHome;
    }
  });

  it('does not falsely report ProposePlan success without a plan dispatch', async () => {
    const onToolCall = buildOnToolCall({
      cesar: {},
      explorationMode: false,
      registry: { availableIds: () => [] },
    } as any, new ToolRegistry(), {});

    await expect(onToolCall?.('ProposePlan', {
      intent: 'Build the telemetry dashboard.',
      steps: [
        {
          id: 'spec',
          type: 'self',
          description: 'Write the KERN telemetry model and dashboard spec.',
          estimatedTokens: 1000,
          estimatedCostUsd: 0.01,
        },
      ],
    }, 'call_plan')).resolves.toContain('[PLAN_ERROR]');
  });

  it('blocks nested ProposePlan calls while an approved plan is already running', async () => {
    const events: any[] = [];
    const cesar: any = {
      planDispatch: (event: any) => events.push(event),
    };
    const onToolCall = buildOnToolCall({
      cesar,
      explorationMode: false,
      activePlan: { id: 'cplan-running', state: 'running' },
      setActivePlan: () => { throw new Error('nested plan should not activate'); },
      registry: { availableIds: () => [] },
    } as any, new ToolRegistry(), {});

    const result = await onToolCall?.('ProposePlan', {
      intent: 'Nested plan',
      steps: [
        {
          id: 'nested',
          type: 'self',
          description: 'This should be blocked.',
          estimatedTokens: 1000,
          estimatedCostUsd: 0.01,
        },
      ],
    }, 'call_nested_plan');

    expect(result).toContain('[PLAN_ERROR]');
    expect(result).toContain('already active');
    expect(cesar.proposedPlan).toBeUndefined();
    expect(events).toEqual([]);
  });

  it('blocks nested ProposePlan calls while a plan is paused', async () => {
    const cesar: any = {
      planDispatch: () => { throw new Error('nested paused plan should not render'); },
    };
    const onToolCall = buildOnToolCall({
      cesar,
      explorationMode: false,
      activePlan: { id: 'cplan-paused', state: 'paused' },
      setActivePlan: () => { throw new Error('nested paused plan should not activate'); },
      registry: { availableIds: () => [] },
    } as any, new ToolRegistry(), {});

    const result = await onToolCall?.('ProposePlan', {
      intent: 'Nested paused plan',
      steps: [
        {
          id: 'nested',
          type: 'self',
          description: 'This should be blocked while paused.',
          estimatedTokens: 1000,
          estimatedCostUsd: 0.01,
        },
      ],
    }, 'call_paused_plan');

    expect(result).toContain('[PLAN_ERROR]');
    expect(result).toContain('already active');
    expect(cesar.proposedPlan).toBeUndefined();
  });

  it('does not session-cache Read tool calls above the mtime-aware Read tool', async () => {
    const registry = new ToolRegistry();
    let readCount = 0;
    const readTool: ToolHandler = {
      definition: {
        name: 'Read',
        description: 'test read',
        inputSchema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] },
        maxResultSizeChars: 1000,
        isReadOnly: true,
        isConcurrencySafe: true,
      },
      validate: () => null,
      checkPermission: (_input: Record<string, unknown>, _ctx: ToolContext) => ({ behavior: 'allow' }),
      execute: async () => ({ ok: true, content: `read-${++readCount}` }),
    };
    registry.register(readTool);

    const onToolCall = buildOnToolCall({
      cesar: { confidenceSatisfied: true },
      explorationMode: false,
    } as any, registry, {});

    await expect(onToolCall?.('Read', { file_path: 'package.json' }, 'call_1')).resolves.toBe('read-1');
    await expect(onToolCall?.('Read', { file_path: 'package.json' }, 'call_2')).resolves.toBe('read-2');
    expect(readCount).toBe(2);
  });
});
