// @kern-source: session:1
import { readFileSync, statSync } from 'node:fs';

// @kern-source: session:2
import { isAbsolute, resolve } from 'node:path';

// @kern-source: session:3
import { join } from 'node:path';

// @kern-source: session:4
import { mkdirSync } from 'node:fs';

// @kern-source: session:5
import type { PersistentSession, PersistentSessionConfig } from '@agon/core';

// @kern-source: session:6
import { EngineRegistry, loadConfig, ensureAgonHome, resolveWorkingDir, scanProjectContext, createPersistentSession, ToolRegistry, FileStateCache, buildToolSystemPrompt, toolsToOpenAIFormat, executeToolCall, RUNS_DIR, tracker } from '@agon/core';

// @kern-source: session:7
import type { ToolContext, ToolCallResult } from '@agon/core';

// @kern-source: session:8
import type { HandlerContext } from '../../handlers/types.js';

// @kern-source: session:9
import { createCesarToolRegistry } from './tools.js';

// @kern-source: session:10
import { buildRoutingContext } from './routing.js';

// @kern-source: session:11
import { extractDelegation } from './brain.js';

// @kern-source: session:13
export const CESAR_SYSTEM_PROMPT: string = `You are Cesar, Agon AI orchestrator.

PERSONALITY: You are the user's trusted partner, not a servant. Warm, sharp, and competent. Talk like a senior engineer who happens to have a good sense of humor — relaxed but never sloppy. Drop a dry joke when the moment calls for it, but never force it. Be human: say "I don't know" when you don't, say "this is tricky" when it is, and celebrate when something works. Never be cold or robotic. Never be performatively enthusiastic. Just be real.

TRUST THROUGH HONESTY: The user trusts you because you never fake certainty. If you're unsure, say so — that's what the confidence system is for. A low confidence number is not failure, it's information. "~60% — I haven't read the code yet" is always better than "Sure, I'll handle it!" followed by wrong output. Show your work: when you make a decision, briefly say why. When you investigate, share what you found. The user doesn't need a play-by-play, but they need to know you actually looked.

STYLE: Be concise but not terse. One good sentence beats three filler sentences. Use the user's language — if they're casual, be casual. If they write in German, respond in German. Adapt to them, not the other way around.

RULE 1 — CONFIDENCE: Call ReportConfidence(value) FIRST on every turn. If you cannot call tools, write ~X% at the very start instead. No exceptions. Initial low confidence is EXPECTED — you haven't read the code yet. Investigate first, then report your INFORMED confidence.
RULE 2 — YOU DECIDE: You own the escalation decision. No automatic triggers. Calling multi-engine tools is a sign of intelligence, not weakness — the best engineers know when to get a second opinion. Each tool has a specific cognitive purpose:

  Brainstorm — multiple engines bid with confidence + approach. YOU decide who executes.
    USE WHEN: multiple valid approaches exist, you need creative solutions, architecture/design choices, or you genuinely don't know the best path.
    DON'T USE WHEN: you have a clear plan, it's a straightforward bug fix, or the task is operational (commit/push/deploy).
    EXAMPLE: "Should we use WebSockets or SSE for live updates?" → Brainstorm. "Fix the null check on line 42" → Solo.

  Tribunal — engines debate and argue, producing a verdict with reasoning.
    USE WHEN: there's a real tradeoff (performance vs readability), a controversial decision, breaking changes, or you want to stress-test an approach before committing.
    DON'T USE WHEN: the answer is clear, or it's a matter of preference not correctness.
    EXAMPLE: "Rewrite auth from JWT to session tokens — worth it?" → Tribunal. "Add a missing import" → Solo.

  Campfire — all engines think together collaboratively, building on each other.
    USE WHEN: exploring an open-ended question, synthesizing ambiguous requirements, brainstorming UX flows, or when the problem space is fuzzy.
    DON'T USE WHEN: you need a concrete implementation, or the task has a clear right answer.
    EXAMPLE: "How should the onboarding flow feel?" → Campfire. "Parse JSON from the API response" → Solo.

  Forge — engines compete to implement code. Best implementation wins via fitness test.
    USE WHEN: quality matters and you want the best code, complex implementations where different approaches could yield different quality, or when you want to see multiple solutions.
    DON'T USE WHEN: the implementation is straightforward, or it's a one-liner fix.
    Set hardened=true for extra validation rounds. Set team=true for architect+implementer+reviewer roles.
    EXAMPLE: "Implement the rate limiter with sliding window" → Forge. "Rename variable from x to count" → Solo.

  Delegate(engine, task) — send a focused subtask to a specific engine, get result inline.
    USE WHEN: another engine has known strengths (security review → Claude, performance → Codex), you need a quick second opinion on one piece, or composing results from multiple engines.
    DON'T USE WHEN: you can handle it yourself confidently.

  DEFAULT IS SOLO. Investigate first. Most tasks don't need multi-engine debate. But when one does — use the right tool without hesitation.
RULE 3 — SOLO vs TEAM: When delegating, decide solo or team.
  Solo (team=false): single-file changes, clear scope, one obvious approach, simple bugs.
  Team (team=true): multi-file features, architecture decisions, refactors across modules, tasks that benefit from architect+implementer+reviewer roles. When in doubt, prefer solo — team costs more tokens.
RULE 4 — CONFIDENCE HINTS (not enforced, just awareness):
  96%+ = you're confident, just implement.
  90-95% = solid but consider a quick self-check — did you miss anything?
  80-89% = you probably have a plan but some unknowns. Consider whether Brainstorm or Delegate would help, or just investigate more.
  <80% = significant uncertainty. Think about whether this is a "I need to read more code" situation (investigate!) or a "this is genuinely hard and needs debate" situation (Tribunal/Brainstorm). Don't default to asking for help — default to investigating. But when you genuinely need other perspectives, that's exactly what these tools are for.
RULE 4b — PATTERNS OBSERVED (early data, 25 sessions — treat as suggestions, not rules):
  Tribunal tends to work well for architecture and risky decisions.
  Brainstorm alone may not catch implementation bugs — consider following up with review.
  Multi-mode pipelines (brainstorm → tribunal → forge) tend to catch more issues.
  Your code will be auto-reviewed after implementation — write carefully the first time.
  Investigation is almost always cheaper than dispatching engines — read 3 files before dispatching 3 AIs.
RULE 4c — REVIEW: Use Review(target?, engine?) to delegate code review. Default target is "uncommitted". Targets: "uncommitted", "branch:NAME", "commit:SHA". Optionally specify engine. Use when the user asks to review code, changes, a PR, or a diff.
RULE 5 — WORKSPACE: Use Read for files. Use Grep for search. NEVER use cat/head/tail/grep via Bash. For git operations (commit, push, branch, etc.) use Bash directly — permission system will ask the user to approve write operations. When the user says "commit", do it: git add the relevant files, write a good commit message, commit. Don't overthink it.
RULE 6 — AFTER DELEGATION: After calling Forge/Brainstorm/Tribunal/Campfire/Pipeline/Review, STOP. Do not continue responding. The orchestrator handles the rest. After calling Delegate, WAIT for the result — do NOT stop. Incorporate the delegated result into your response.
RULE 7 — NO NARRATION: NEVER narrate your research process. Do not write "Reading the file...", "I'm checking...", "Let me look at...", "I've confirmed...". The user sees your text output — if you narrate exploration it looks like you have no clue. Instead: call tools SILENTLY, then speak ONLY when you have the answer or decision. Your visible output should be conclusions, answers, and actions — never a play-by-play of your investigation. If you need to read files or search code, call Read/Grep/Glob directly without announcing it.`;

// @kern-source: session:72
/**
 * Build the full Cesar system prompt with project context, engine list, and mode flags.
 */
export function buildCesarSystemPrompt(ctx: HandlerContext): string {
  const config = ctx.config;
      const cesarCwd = resolveWorkingDir();
      const projectCtx = scanProjectContext(cesarCwd, config.projectContext || undefined);
      const available = ctx.activeEngines();
      const engineList = available.map((id: string) => {
        try {
          const e = ctx.registry.get(id);
          const hasAgent = !!e.agent;
          return `- ${id}${hasAgent ? ' (agent-capable)' : ''}`;
        } catch { return `- ${id}`; }
      }).join('\n');
  
      const systemParts: string[] = [CESAR_SYSTEM_PROMPT];
      if (projectCtx) systemParts.push(`## PROJECT CONTEXT\n${projectCtx}`);
      // Engine list is now in ROUTING CONTEXT (per-turn), but keep a basic list for fallback
      systemParts.push(`## AVAILABLE ENGINES\n${engineList}`);
      if (ctx.explorationMode) {
        systemParts.push(`## OPERATING MODE\nExploration mode is ON. Stay read-only: inspect files, search, and use read-only shell commands only. Do not call Edit or Write. Do not run non-read-only Bash commands.`);
      }
      // Inject Cesar memory context
      if (ctx.cesarMemory) {
        const memoryCtx = ctx.cesarMemory.toPromptContext();
        if (memoryCtx) systemParts.push(memoryCtx);
      }
  
      if (ctx.neroMode) {
        systemParts.push(`NERO MODE: Adversarial. Challenge assumptions, probe weaknesses, ask hard questions before implementing. Suggest tribunal-red-team or tribunal-adversarial.`);
      }
  
      // Inject extension system prompt fragments
      const fragments = ctx.extensionPromptFragments;
      if (Array.isArray(fragments) && fragments.length > 0) {
        systemParts.push(`## EXTENSIONS\n${fragments.join('\n')}`);
      }
  
      // Always present — Cesar should suggest plan mode for complex tasks
      systemParts.push(`RULE 8 — SUGGEST PLANNING: For complex tasks that would require multi-engine orchestration (forge, brainstorm + forge, or multiple delegations), suggest plan mode to the user BEFORE executing. Say: "This looks like it needs a plan. Want me to plan it first? Use /plan <task> to enter plan mode." Do NOT auto-enter plan mode — the user decides. Simple questions and single-engine tasks do not need plans.`);
  
      if (ctx.activePlan && ['planning', 'awaiting_approval'].includes(ctx.activePlan.state)) {
        const stats = tracker.getStats();
        let budgetWarning = '';
        if (stats.totalCostUsd > 1.0) {
          budgetWarning = `\n\nWARNING: Planning phase has spent $${stats.totalCostUsd.toFixed(2)}. Wrap up your analysis and call ProposePlan now.`;
        }
        systemParts.push(`RULE 9 — PLAN MODE: You are in PLAN MODE. Your goal is to produce the best possible plan, then propose it with ProposePlan.
  
  ALLOWED: Brainstorm, Campfire, Tribunal, Delegate, Read, Grep, Glob, Bash (read-only), ReportConfidence, ProposePlan. Use these freely to analyze the task and build your strategy.
  
  BLOCKED: Forge, Pipeline, Edit, Write. No code execution until the plan is approved.
  
  Think deeply. Use other engines to challenge your approach. Then propose a structured plan with specific engine assignments and cost estimates for each step.${budgetWarning}`);
      }
  
      // History replay — only needed when session reboots (new process loses context).
      if (ctx.chatSession && ctx.chatSession.messages && ctx.chatSession.messages.length > 0) {
        const recent = ctx.chatSession.messages.slice(-20);
        const lines = recent.map((msg: any) => {
          const role = msg.role === 'user' ? 'U' : (msg.engineId ?? 'E');
          const text = msg.content.length > 500 ? msg.content.slice(0, 500) + '…' : msg.content;
          return `${role}: ${text}`;
        });
        systemParts.push(`HISTORY:\n${lines.join('\n')}`);
      }
  
      return systemParts.join('\n\n');
}

// @kern-source: session:142
/**
 * Build the onToolCall callback for API engines with native function calling.
 */
export function buildOnToolCall(ctx: HandlerContext, toolRegistry: ToolRegistry, config: any): ((name:string, args:Record<string,unknown>, callId:string) => Promise<string>) | undefined {
  const fsc = new FileStateCache();
  const toolResultCache = new Map<string, string>();
  const explorationMode = ctx.explorationMode ?? false;
  const sharedToolCtx: ToolContext = {
    cwd: resolveWorkingDir(),
    readFileState: (fsc as any).cache,
    abortSignal: undefined,
    permissionMode: (config as any).permissionMode ?? 'ask',
    explorationMode,
    allowedCommands: (config as any).allowedCommands ?? [],
    toolPermissions: (config as any).toolPermissions ?? {},
  };
  return async (name: string, args: Record<string, unknown>, callId: string) => {
    // Plan mode: block execution tools
    const activePlan = ctx.activePlan;
    if (activePlan && ['planning', 'awaiting_approval'].includes(activePlan.state)) {
      const BLOCKED_IN_PLAN = ['Forge', 'Pipeline', 'Edit', 'Write'];
      if (BLOCKED_IN_PLAN.includes(name)) {
        return `[BLOCKED] Tool "${name}" is not available in plan mode. Use ProposePlan to propose your execution strategy.`;
      }
      if (name === 'Bash') {
        const cmd = String((args as any).command ?? '');
        // Block destructive shell commands in plan mode — but NOT git commit/push (user-requested operations)
        const destructivePatterns = /\b(rm\s+-rf|rm\s+--force|chmod\s+777|mkfs\.|dd\s+if=)\b/;
        if (destructivePatterns.test(cmd)) {
          return `[BLOCKED] Destructive commands are not available in plan mode. Use ProposePlan to propose your execution strategy.`;
        }
      }
    }
  
    // ── Orchestration signal tools — intercept before execution ──
    const ORCH_TOOLS = new Set(['Forge', 'Brainstorm', 'Tribunal', 'Campfire', 'Pipeline', 'Review']);
    if (ORCH_TOOLS.has(name)) {
      ctx.cesar!.pendingDelegation = extractDelegation(name, args);
      // [DELEGATION_BREAK] prefix signals persistent-session to stop the tool loop
      // immediately — the model must not continue after delegation.
      return '[DELEGATION_BREAK] Delegation accepted. The orchestrator will handle the rest.';
    }
  
    // ── Delegate tool — actually dispatches to another engine and returns result ──
    if (name === 'Delegate') {
      const targetId = (args as any).engine as string;
      const task = (args as any).task as string;
      const mode = ((args as any).mode as string) ?? 'exec';
      const cesarEngineId = (ctx.config as any).cesarEngine ?? ctx.config.forgeFixedStarter ?? 'claude';
  
      // Validate: can't delegate to yourself
      if (targetId === cesarEngineId) {
        return `Error: Cannot delegate to yourself (${cesarEngineId}). Pick a different engine.`;
      }
  
      // Look up target engine
      let targetEngine;
      try {
        targetEngine = ctx.registry.get(targetId);
      } catch {
        const available = ctx.registry.availableIds().filter((id: string) => id !== cesarEngineId);
        return `Error: Engine "${targetId}" not found. Available: ${available.join(', ')}`;
      }
  
      // Dispatch to target engine
      const outDir = join(RUNS_DIR, `delegate-${targetId}-${Date.now()}`);
      mkdirSync(outDir, { recursive: true });
  
      try {
        const result = await ctx.adapter.dispatch({
          engine: targetEngine,
          prompt: task,
          cwd: resolveWorkingDir(),
          mode: mode as any,
          timeout: ctx.config.timeout ?? 120,
          outputDir: outDir,
          signal: sharedToolCtx.abortSignal,
        });
  
        if (!result.stdout.trim()) {
          return `[Delegate → ${targetId}] Engine returned empty response.`;
        }
  
        // Strip <think> blocks from response
        const cleaned = result.stdout.trim().replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
  
        // Track token usage — real if available, estimated otherwise
        if (result.usage) {
          tracker.record(targetId, { usage: result.usage });
        } else {
          tracker.record(targetId, { prompt: task, response: cleaned });
        }
  
        return `[Delegate → ${targetId}]\n${cleaned}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `[Delegate → ${targetId}] Error: ${msg}`;
      }
    }
  
    if (name === 'ProposePlan') {
      // Validate engines exist before creating the plan
      const proposedSteps = (args as any).steps ?? [];
      for (const step of proposedSteps) {
        const engines = step.engines ?? (step.engine ? [step.engine] : []);
        for (const engineId of engines) {
          try {
            ctx.registry.get(engineId);
          } catch {
            return `[PLAN_ERROR] Engine "${engineId}" in step "${step.id}" is not available. Available engines: ${ctx.registry.availableIds().join(', ')}. Revise your plan.`;
          }
        }
      }
  
      // Wire ProposePlan tool to actual plan creation + display
      const { handleProposePlan } = await import('../handlers/plan-mode.js');
      const dispatch = ctx.cesar!.planDispatch;
      if (dispatch) {
        try {
          const plan = await handleProposePlan(args, dispatch, ctx);
          // Set React state for UI
          if (ctx.setActivePlan) {
            ctx.setActivePlan(plan);
          }
          // Stash on ctx so app-dispatch can read it synchronously after routeWithCesar returns
          ctx.cesar!.proposedPlan = plan;
        } catch (err) {
          console.warn(`[agon] ProposePlan handling failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return '[DELEGATION_BREAK] [PLAN_PROPOSED] Plan submitted for user approval.';
    }
  
    // ── ReportConfidence signal tool — record value, don't force delegation ──
    if (name === 'ReportConfidence') {
      const value = typeof (args as any).value === 'number' ? (args as any).value : null;
      if (value !== null && value >= 0 && value <= 100) {
        ctx.cesar!.reportedConfidence = value;
      }
    }
  
    // Dedup: if exact same tool+args was called before, return cached result
    const cacheKey = `${name}:${JSON.stringify(args)}`;
    const cached = toolResultCache.get(cacheKey);
    if (cached !== undefined) return cached;
  
    const result = await executeToolCall(
      { id: callId, name, input: args },
      sharedToolCtx,
      toolRegistry,
      async (tool: string, message: string) => {
        return new Promise<boolean>((resolve) => {
          const d = ctx.cesar!.lastDispatch;
          if (d) {
            const cmd = (args as any).command ?? (args as any).file_path ?? JSON.stringify(args);
            d({ type: 'permission-ask', tool, command: cmd, reason: message, resolve } as any);
          } else {
            resolve(true);
          }
        });
      },
    );
    const output = result.result.ok ? result.result.content : (result.result.error ?? 'Tool execution failed');
    // Cache read-only results. Invalidate on writes.
    if (['Read', 'Grep', 'Glob'].includes(name)) {
      toolResultCache.set(cacheKey, output);
    } else if (['Edit', 'Write', 'Bash'].includes(name)) {
      toolResultCache.clear();
    }
    return output;
  };
}

// @kern-source: session:314
/**
 * Build the onApproval callback for engine tool approvals.
 */
export function buildOnApproval(ctx: HandlerContext, engineId: string): (tool:string, command:string) => Promise<boolean> {
  const engine = ctx.registry.get(engineId);
  return async (tool: string, command: string) => {
    const cfg = ctx.config;
    const perms = (cfg as any).toolPermissions ?? {};
    const allowed = (cfg as any).allowedCommands ?? [];
    const mode = (cfg as any).permissionMode ?? 'ask';
  
    // Map engine tool names to Agon tool names
    const toolMap: Record<string, string> = { shell: 'Bash', bash: 'Bash', edit: 'Edit', write: 'Write', read: 'Read', grep: 'Grep', glob: 'Glob' };
    const agonTool = toolMap[tool.toLowerCase()] ?? tool;
    const perm = perms[agonTool];
  
    // Block writes during exploration mode
    if (ctx.explorationMode) {
      const WRITE_TOOLS = ['Edit', 'Write', 'Bash'];
      if (WRITE_TOOLS.includes(agonTool)) {
        return false;
      }
    }
  
    // deny → block immediately
    if (perm === 'deny' || mode === 'deny-all') return false;
  
    // allow → auto-approve
    if (perm === 'allow' || mode === 'auto') return true;
  
    // For Bash: check allowedCommands whitelist
    if (agonTool === 'Bash' && allowed.length > 0) {
      const cmdLower = command.toLowerCase();
      if (allowed.some((a: string) => cmdLower.startsWith(a.toLowerCase()))) return true;
    }
  
    // ask → show permission prompt (same UI as Claude Code)
    return new Promise<boolean>((resolve) => {
      const dispatch = ctx.cesar!.lastDispatch;
      if (dispatch) {
        dispatch({ type: 'permission-ask', tool: agonTool, command, reason: `Cesar (${engineId}) wants to execute`, resolve } as any);
      } else {
        resolve(true);
      }
    });
  };
}

// @kern-source: session:361
export function normalizeCesarMcpServers(raw: unknown): Array<Record<string,unknown>> {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
  
  const normalizeArray = (value: unknown): Array<Record<string, unknown>> =>
    Array.isArray(value) ? value.filter(isRecord) : [];
  
  const normalizeNamedRecord = (value: unknown): Array<Record<string, unknown>> => {
    if (!isRecord(value)) return [];
    return Object.entries(value)
      .filter(([, server]) => isRecord(server))
      .map(([name, server]) => ({ name, ...(server as Record<string, unknown>) }));
  };
  
  if (Array.isArray(raw)) return normalizeArray(raw);
  if (!isRecord(raw)) return [];
  
  const directKeys = ['mcpServers', 'mcp_servers', 'servers'];
  let sawDirectKey = false;
  for (const key of directKeys) {
    if (!(key in raw)) continue;
    sawDirectKey = true;
    const value = raw[key];
    const asArray = normalizeArray(value);
    if (asArray.length > 0) return asArray;
    const asRecord = normalizeNamedRecord(value);
    if (asRecord.length > 0) return asRecord;
  }
  
  if (sawDirectKey) return [];
  return normalizeNamedRecord(raw);
}

// @kern-source: session:395
export function loadCesarMcpServers(config: any, cwd: string): Array<Record<string,unknown>>|undefined {
  if (!(config as any).cesarMcpEnabled) return undefined;
  
  const rawPath = String((config as any).cesarMcpConfigPath ?? '').trim();
  if (!rawPath) {
    throw new Error('Cesar MCP is enabled but cesarMcpConfigPath is empty');
  }
  
  const resolvedPath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolvedPath, 'utf-8'));
  } catch (err) {
    throw new Error(`Failed to load Cesar MCP config at ${resolvedPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  
  const servers = normalizeCesarMcpServers(parsed);
  if (servers.length === 0) {
    throw new Error(`No MCP servers found in ${resolvedPath}. Expected an array or a JSON object with mcpServers or servers.`);
  }
  return servers;
}

// @kern-source: session:419
export function canUseCesarMcp(engine: any, binaryPath: string): boolean {
  if (!binaryPath) return false;
  const protocol = engine?.companion?.protocol;
  return protocol === 'acp' || protocol === 'jsonrpc';
}

// @kern-source: session:426
/**
 * Compute a simple fingerprint of MCP-related config to detect changes.
 */
export function mcpConfigFingerprint(config: any): string {
  const enabled = !!(config as any).cesarMcpEnabled;
  const configPath = String((config as any).cesarMcpConfigPath ?? '');
  // Include file mtime when the path exists, so edits to the MCP config file are detected
  let mtime = '';
  if (enabled && configPath) {
    try {
      const resolvedPath = isAbsolute(configPath) ? configPath : resolve(resolveWorkingDir(), configPath);
      mtime = String(statSync(resolvedPath).mtimeMs);
    } catch { /* file may not exist yet */ }
  }
  return `${enabled}:${configPath}:${mtime}`;
}

// @kern-source: session:442
export async function ensureCesarSession(ctx: HandlerContext): Promise<PersistentSession> {
  const config = ctx.config;
  const cesarEngineId = (config as any).cesarEngine ?? config.forgeFixedStarter ?? 'claude';
  const cwd = resolveWorkingDir();
  
  // Ensure cesar state bag exists
  if (!ctx.cesar) {
    ctx.cesar = {
      busy: false, busySince: null, queue: null,
      toolRegistry: null, hasNativeTools: false, lastDispatch: null,
      pendingDelegation: null, reportedConfidence: undefined,
      autoNero: false, advisorPending: false, lastEscalation: null as string | null,
      mcpFingerprint: undefined, planDispatch: null, proposedPlan: undefined,
    };
  }
  
  // Return existing alive session IF it's for the same engine AND MCP config hasn't changed
  const currentMcpFp = mcpConfigFingerprint(config);
  if (ctx.cesarSession && ctx.cesarSession.alive && ctx.cesarSession.engineId === cesarEngineId) {
    const storedFp = ctx.cesar!.mcpFingerprint as string | undefined;
    if (storedFp === currentMcpFp) {
      return ctx.cesarSession;
    }
    // MCP config changed — close stale session and recreate
    ctx.cesarSession.close();
    ctx.setCesarSession(null);
  }
  
  // Wrong engine or dead session — close old one
  if (ctx.cesarSession && ctx.cesarSession.engineId !== cesarEngineId) {
    ctx.cesarSession.close();
    ctx.setCesarSession(null);
  }
  
  // Session exists but died — try restarting it before creating a new one
  if (ctx.cesarSession && !ctx.cesarSession.alive) {
    try {
      await ctx.cesarSession.start();
      if (ctx.cesarSession.alive) return ctx.cesarSession;
    } catch {
      // Restart failed — fall through to create fresh session
    }
  }
  
  let engine;
  try {
    engine = ctx.registry.get(cesarEngineId);
  } catch {
    throw new Error(`Cesar engine "${cesarEngineId}" not found`);
  }
  
  // Resolve backend: user preference → auto (CLI first, API fallback)
  const cesarBackend = (config as any).cesarBackend ?? 'auto';
  const hasBinary = !!(engine.binary && ctx.registry.findBinary(engine));
  const hasApi = !!(engine.api && process.env[engine.api?.apiKeyEnv]);
  
  let binaryPath = '';
  if (cesarBackend === 'api' && hasApi) {
    binaryPath = ''; // force API path
  } else if (cesarBackend === 'cli' && hasBinary) {
    binaryPath = ctx.registry.findBinary(engine)!;
  } else if (cesarBackend === 'auto') {
    if (hasBinary) {
      binaryPath = ctx.registry.findBinary(engine)!;
    } else if (hasApi) {
      binaryPath = '';
    } else {
      throw new Error(`No backend for "${cesarEngineId}" — install CLI or set ${engine.api?.apiKeyEnv ?? 'API key'}`);
    }
  } else {
    if (hasBinary) binaryPath = ctx.registry.findBinary(engine)!;
    else if (hasApi) binaryPath = '';
    else throw new Error(`No backend for "${cesarEngineId}"`);
  }
  const usingApi = !binaryPath;
  const mcpServers = canUseCesarMcp(engine, binaryPath)
    ? loadCesarMcpServers(config, cwd)
    : undefined;
  
  // Build system prompt and tool registry
  const systemPrompt = buildCesarSystemPrompt(ctx);
  const toolRegistry = createCesarToolRegistry(cesarEngineId);
  
  // Store registry on context for tool execution during responses
  ctx.cesar!.toolRegistry = toolRegistry;
  
  // Build native function calling tools for API engines (OpenAI-compatible)
  const nativeTools = (!binaryPath && engine.api) ? toolsToOpenAIFormat(toolRegistry) : undefined;
  ctx.cesar!.hasNativeTools = !!nativeTools;
  
  // API engines with native tools: DON'T inject XML tool descriptions — the native
  // tools parameter is enough and XML descriptions confuse models into narrating
  // instead of calling tools. CLI engines still need the XML prompt.
  let fullPrompt = systemPrompt;
  if (!nativeTools) {
    const toolPrompt = buildToolSystemPrompt(toolRegistry);
    fullPrompt += '\n\nTOOLS: XML format below. Never ask permission — just call. Never describe changes when you can execute.\n\n' + toolPrompt;
  } else {
    fullPrompt += '\n\nYou have tools available via function calling. Call them directly — do NOT describe them in XML or narrate what you would call. Just call the function.';
  }
  if (mcpServers && mcpServers.length > 0) {
    fullPrompt += '\n\nMCP is enabled for this session. Use MCP only when the task clearly needs capabilities outside the workspace or built-in Agon tools. Prefer Read/Grep/Glob/Edit/Bash first, and keep MCP calls to the minimum needed.';
  }
  
  const sessionConfig: PersistentSessionConfig = {
    engine,
    binaryPath,
    cwd,
    systemPrompt: fullPrompt,
    nativeTools,
    mcpServers,
    onToolCall: buildOnToolCall(ctx, toolRegistry, config),
    onApproval: buildOnApproval(ctx, cesarEngineId),
    onTurnEnd: (learnings: {filesRead:string[], filesModified:string[], decisions:string[], discoveries:string[], toolsUsed:string[]}) => {
      // Write API engine learnings to Cesar's persistent memory
      const mem = ctx.cesarMemory;
      if (!mem) return;
      for (const file of learnings.filesModified.slice(0, 5)) {
        mem.savePersistent({ key: `modified:${file}`, value: `Modified in API session`, timestamp: new Date().toISOString(), category: 'file' });
      }
      for (const discovery of learnings.discoveries.slice(0, 3)) {
        mem.savePersistent({ key: `discovery:${discovery.slice(0, 50)}`, value: discovery, timestamp: new Date().toISOString(), category: 'pattern' });
      }
      for (const decision of learnings.decisions.slice(0, 3)) {
        mem.savePersistent({ key: `decision:${decision.slice(0, 50)}`, value: decision, timestamp: new Date().toISOString(), category: 'decision' });
      }
    },
  };
  
  const session = createPersistentSession(sessionConfig);
  await session.start();
  ctx.setCesarSession(session);
  // Store MCP config fingerprint so we can detect changes on next reuse check
  ctx.cesar!.mcpFingerprint = currentMcpFp;
  return session;
}

