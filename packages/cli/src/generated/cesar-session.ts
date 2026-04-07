// @kern-source: cesar-session:1
import type { PersistentSession, PersistentSessionConfig } from '@agon/core';

// @kern-source: cesar-session:2
import { EngineRegistry, loadConfig, ensureAgonHome, resolveWorkingDir, scanProjectContext, createPersistentSession, ToolRegistry, FileStateCache, buildToolSystemPrompt, toolsToOpenAIFormat, executeToolCall } from '@agon/core';

// @kern-source: cesar-session:3
import type { ToolContext, ToolCallResult } from '@agon/core';

// @kern-source: cesar-session:4
import type { HandlerContext } from '../handlers/types.js';

// @kern-source: cesar-session:5
import { createCesarToolRegistry } from './cesar-tools.js';

// @kern-source: cesar-session:6
import { buildRoutingContext } from './cesar-routing.js';

// @kern-source: cesar-session:8
export const CESAR_SYSTEM_PROMPT: string = `You are Cesar, Agon AI orchestrator. Be direct. Be concise.

RULE 1 — CONFIDENCE: Call ReportConfidence(value) FIRST on every turn. If you cannot call tools, write ~X% at the very start instead. No exceptions. Initial low confidence is EXPECTED — you haven't read the code yet. Investigate first, then the orchestrator evaluates your FINAL confidence after you finish.
RULE 2 — TIERS (applied after your turn, not during):
  93%+  = implement directly.
  88-92% = the orchestrator will activate Nero (adversarial self-challenge). Just respond normally — Nero is handled externally.
  70-87% = delegate to a DISCUSSION mode. Pick the right one:
    - Tribunal: when you are unsure about the APPROACH (debate pros/cons, architectural decisions).
    - Brainstorm: when you need more IDEAS (multiple perspectives, creative solutions).
    - Campfire: when the goal is unclear or exploratory (open-ended thinking, no competition).
    - Forge: ONLY for code/build tasks that are at least moderately complex. Forge = engines compete on implementation. Never forge a question or a simple fix.
  <70% = you are stuck. The orchestrator will automatically consult the best-ranked engine as advisor. Just explain your uncertainty — the advisor handles the rest.
RULE 3 — SOLO vs TEAM: When delegating, decide solo or team.
  Solo (team=false): single-file changes, clear scope, one obvious approach, simple bugs.
  Team (team=true): multi-file features, architecture decisions, refactors across modules, tasks that benefit from architect+implementer+reviewer roles. When in doubt, prefer solo — team costs more tokens.
RULE 4 — TOOLS: Call ReportConfidence first, then either respond directly (93%+) or call a delegation tool (Forge, Brainstorm, Tribunal, Campfire, Pipeline). Set team=true for team variants. Set hardened=true for forge-hardened. Set mode for tribunal variant (adversarial/synthesis/steelman/socratic/red-team/postmortem).
RULE 5 — WORKSPACE: Use Read for files. Use Grep for search. NEVER use cat/head/tail/grep via Bash.
RULE 6 — AFTER DELEGATION: After calling Forge/Brainstorm/Tribunal/Campfire/Pipeline, STOP. Do not continue responding. The orchestrator handles the rest.
RULE 7 — NO NARRATION: NEVER narrate your research process. Do not write "Reading the file...", "I'm checking...", "Let me look at...", "I've confirmed...". The user sees your text output — if you narrate exploration it looks like you have no clue. Instead: call tools SILENTLY, then speak ONLY when you have the answer or decision. Your visible output should be conclusions, answers, and actions — never a play-by-play of your investigation. If you need to read files or search code, call Read/Grep/Glob directly without announcing it.`;

// @kern-source: cesar-session:31
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
  if ((ctx as any).cesarMemory) {
    const memoryCtx = (ctx as any).cesarMemory.toPromptContext();
    if (memoryCtx) systemParts.push(memoryCtx);
  }
  
  if ((ctx as any).neroMode) {
    systemParts.push(`NERO MODE: Adversarial. Challenge assumptions, probe weaknesses, ask hard questions before implementing. Suggest tribunal-red-team or tribunal-adversarial.`);
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

// @kern-source: cesar-session:77
export function buildOnToolCall(ctx: HandlerContext, toolRegistry: ToolRegistry, config: any): ((name:string, args:Record<string,unknown>, callId:string) => Promise<string>) | undefined {
  const fsc = new FileStateCache();
  const toolResultCache = new Map<string, string>();
  const explorationMode = (ctx as any).explorationMode ?? false;
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
    // ── Orchestration signal tools — intercept before execution ──
    const ORCH_TOOLS = new Set(['Forge', 'Brainstorm', 'Tribunal', 'Campfire', 'Pipeline']);
    if (ORCH_TOOLS.has(name)) {
      (ctx as any)._pendingDelegation = {
        action: name.toLowerCase(),
        reasoning: (args as any).task ?? (args as any).question ?? (args as any).topic ?? '',
        hardened: (args as any).hardened ?? false,
        tribunalMode: (args as any).mode,
        team: (args as any).team ?? false,
        createdAt: Date.now(),
      };
      // [DELEGATION_BREAK] prefix signals persistent-session to stop the tool loop
      // immediately — the model must not continue after delegation.
      return '[DELEGATION_BREAK] Delegation accepted. The orchestrator will handle the rest.';
    }
  
    // ── ReportConfidence signal tool — record value, don't force delegation ──
    if (name === 'ReportConfidence') {
      const value = typeof (args as any).value === 'number' ? (args as any).value : null;
      if (value !== null && value >= 0 && value <= 100) {
        (ctx as any)._reportedConfidence = value;
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
          const d = (ctx as any)._lastDispatch;
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

// @kern-source: cesar-session:149
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
      const dispatch = (ctx as any)._lastDispatch;
      if (dispatch) {
        dispatch({ type: 'permission-ask', tool: agonTool, command, reason: `Cesar (${engineId}) wants to execute`, resolve } as any);
      } else {
        resolve(true);
      }
    });
  };
}

// @kern-source: cesar-session:188
export async function ensureCesarSession(ctx: HandlerContext): Promise<PersistentSession> {
  const config = ctx.config;
  const cesarEngineId = (config as any).cesarEngine ?? config.forgeFixedStarter ?? 'claude';
  
  // Return existing alive session IF it's for the same engine
  if (ctx.cesarSession && ctx.cesarSession.alive && ctx.cesarSession.engineId === cesarEngineId) {
    return ctx.cesarSession;
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
  
  // Build system prompt and tool registry
  const systemPrompt = buildCesarSystemPrompt(ctx);
  const toolRegistry = createCesarToolRegistry();
  
  // Store registry on context for tool execution during responses
  (ctx as any)._toolRegistry = toolRegistry;
  
  // Build native function calling tools for API engines (OpenAI-compatible)
  const nativeTools = (!binaryPath && engine.api) ? toolsToOpenAIFormat(toolRegistry) : undefined;
  (ctx as any)._hasNativeTools = !!nativeTools;
  
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
  
  const sessionConfig: PersistentSessionConfig = {
    engine,
    binaryPath,
    cwd: resolveWorkingDir(),
    systemPrompt: fullPrompt,
    nativeTools,
    onToolCall: nativeTools ? buildOnToolCall(ctx, toolRegistry, config) : undefined,
    onApproval: buildOnApproval(ctx, cesarEngineId),
  };
  
  const session = createPersistentSession(sessionConfig);
  await session.start();
  ctx.setCesarSession(session);
  return session;
}

