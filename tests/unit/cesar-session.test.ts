import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '@kernlang/agon-core';
import type { ToolContext, ToolHandler } from '@kernlang/agon-core';
import { buildCesarConversationSnapshot, buildOnApproval, buildOnToolCall, canUseCesarMcp, loadCesarMcpServers, normalizeCesarMcpServers } from '../../packages/cli/src/generated/cesar/session.js';
import { applyInvariantsRule1, _resetInvariantsRule1DriftWarning, CESAR_RULE_1_STRICT, CESAR_RULE_1_INVARIANTS, CESAR_SYSTEM_PROMPT } from '../../packages/cli/src/generated/cesar/session.js';

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

  it('confidence gate exempts read-only Bash but still gates mutating Bash + Edit', async () => {
    const registry = new ToolRegistry();
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
      checkPermission: () => ({ behavior: 'allow' }),
      execute: async () => ({ ok: true, content: 'ran' }),
    };
    registry.register(bashTool);

    const cesar: any = { confidenceSatisfied: false, blockedOnConfidence: null, confidenceBlockCount: 0 };
    const onToolCall = buildOnToolCall({ cesar, explorationMode: false } as any, registry, {});

    // read-only Bash investigates freely — NOT confidence-blocked
    const ro = await onToolCall?.('Bash', { command: 'ls -la' }, 'c1');
    expect(String(ro)).not.toContain('Report confidence first');

    // mutating Bash still requires confidence first (it never hits the permission
    // UI in auto-approve/conquer modes, so the confidence signal is the checkpoint)
    const mut = await onToolCall?.('Bash', { command: 'rm -rf /tmp/agon-test-foo' }, 'c2');
    expect(String(mut)).toContain('Report confidence first');

    // Edit still gated
    const edit = await onToolCall?.('Edit', { file_path: 'x.ts', old_string: 'a', new_string: 'b' }, 'c3');
    expect(String(edit)).toContain('Report confidence first');
  });

  it('appends a codebase-brief nudge once after many read/search calls in a turn', async () => {
    const registry = new ToolRegistry();
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
      checkPermission: () => ({ behavior: 'allow' }),
      execute: async () => ({ ok: true, content: 'file body' }),
    };
    registry.register(readTool);

    const cesar: any = { confidenceSatisfied: true };
    const onToolCall = buildOnToolCall({ cesar, explorationMode: false } as any, registry, {});

    let last = '';
    for (let i = 1; i <= 41; i++) {
      last = String(await onToolCall?.('Read', { file_path: `f${i}.ts` }, `c${i}`));
      if (i < 40) expect(last).not.toContain('CODEBASE BRIEF'); // not yet
      if (i === 40) {
        expect(last).toContain('[NOTE]');
        expect(last).toContain('CODEBASE BRIEF');
        expect(last).toContain('40 read/search calls');
      }
      if (i === 41) expect(last).not.toContain('CODEBASE BRIEF'); // once per turn only
    }
    expect(cesar.searchToolCount).toBe(41);
    expect(cesar.searchNudged).toBe(true);
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

describe('mode-aware RULE 1 — CONFIDENCE (guard mode invariants)', () => {
  it('CESAR_RULE_1_STRICT matches the RULE 1 paragraph baked into CESAR_SYSTEM_PROMPT verbatim', () => {
    // The whole mode-aware swap hinges on this exact-string match: if RULE 1's
    // wording in CESAR_SYSTEM_PROMPT ever drifts out of sync with the const, the
    // .replace() silently no-ops and invariants would keep the strict ceremony.
    expect(CESAR_SYSTEM_PROMPT.includes(CESAR_RULE_1_STRICT)).toBe(true);
  });

  it('strict text orders ReportConfidence FIRST every turn; invariants text demotes it to on-demand', () => {
    expect(CESAR_RULE_1_STRICT).toContain('Call ReportConfidence(value) FIRST on every turn');
    expect(CESAR_RULE_1_INVARIANTS).toContain('ONLY when you are about to run a risky command');
    expect(CESAR_RULE_1_INVARIANTS).toContain('a well-formed Edit after reading the file IS the confidence signal');
    // The on-demand text must NOT re-introduce the every-turn ceremony.
    expect(CESAR_RULE_1_INVARIANTS).not.toContain('FIRST on every turn');
  });

  it('applyInvariantsRule1 swaps ONLY the RULE 1 paragraph, keeping RULE 1b and the rest byte-identical', () => {
    const rewritten = applyInvariantsRule1(CESAR_SYSTEM_PROMPT);
    // RULE 1 is rewritten…
    expect(rewritten).toContain(CESAR_RULE_1_INVARIANTS);
    expect(rewritten).not.toContain(CESAR_RULE_1_STRICT);
    // …but RULE 1b (which we keep) and everything else is preserved verbatim.
    expect(rewritten).toContain('RULE 1b — CONFIDENCE IS NOT AN ANSWER: ReportConfidence is telemetry, not completion.');
    expect(rewritten).toContain('RULE 10 — TURN CLOSURE');
    // The transform replaces exactly one paragraph: the only byte delta is
    // strict→invariants RULE 1. Reconstructing the strict text reverses it.
    expect(rewritten.replace(CESAR_RULE_1_INVARIANTS, CESAR_RULE_1_STRICT)).toBe(CESAR_SYSTEM_PROMPT);
  });

  it('is a no-op (returns the prompt unchanged) when the strict RULE 1 text is absent — fail-safe to every-turn ceremony', () => {
    _resetInvariantsRule1DriftWarning();
    const noRule1 = 'You are Cesar.\nRULE 2 — YOU DECIDE: ...';
    expect(applyInvariantsRule1(noRule1)).toBe(noRule1);
  });

  it('FIX 3: warns ONCE when the strict RULE 1 text is absent (drift observable) and stays silent on a matching prompt', () => {
    // A deliberately drifted prompt (no CESAR_RULE_1_STRICT paragraph) must make
    // the drift OBSERVABLE: applyInvariantsRule1 fails safe to the strict ceremony
    // (returns the prompt unchanged) AND emits exactly ONE console.warn carrying the
    // exact drift message — gated by a module-level once-flag so the per-turn call
    // cadence can't spam it.
    _resetInvariantsRule1DriftWarning();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const drifted = 'You are Cesar.\nRULE 1 — CONFIDENCE: (reworded so the exact strict const no longer matches)';
      // Sanity: the drifted prompt genuinely lacks the strict paragraph.
      expect(drifted.includes(CESAR_RULE_1_STRICT)).toBe(false);

      // First call on a drifted prompt → unchanged + one warn with the exact text.
      expect(applyInvariantsRule1(drifted)).toBe(drifted);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith('[agon] invariants RULE 1 rewrite failed — CESAR_SYSTEM_PROMPT drifted from CESAR_RULE_1_STRICT; serving strict confidence ceremony');

      // Second drifted call → still no second warn (once-flag holds).
      expect(applyInvariantsRule1(drifted)).toBe(drifted);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // A matching prompt rewrites cleanly and NEVER warns.
      warnSpy.mockClear();
      _resetInvariantsRule1DriftWarning();
      const rewritten = applyInvariantsRule1(CESAR_SYSTEM_PROMPT);
      expect(rewritten).toContain(CESAR_RULE_1_INVARIANTS);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      _resetInvariantsRule1DriftWarning();
    }
  });
});
