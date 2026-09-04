import { FIRST_PARTY_SURFACE_CATALOG, assertContributionInput } from '@kernlang/agon-kernel';

import { ToolRegistry, getProjectFileStateCache, createReadTool, createEditTool, createMultiEditTool, createWriteTool, createBashTool, createGrepTool, createGlobTool, createForgeTool, createBrainstormTool, createTribunalTool, createCampfireTool, createPipelineTool, createGoalTool, createConquerTool, createReviewTool, createDelegateTool, createAgentTool, createReportConfidenceTool, createProposePlanTool, createExitPlanModeTool, createListPlansTool, createRetrieveResultTool, createQuickNeroTool, createTodoWriteTool, createSaveMemoryTool, executeToolCall, resolveWorkingDir, parsePermissionRuleSet, parseToolHooks, isReadOnlyCommand, loadConfig } from '@kernlang/agon-core';

import { assertCanonicalSurfaceSelectionCurrent, processSurfaceClient, processSurfaceNames } from '../surface-authority-runtime.js';

import type { ToolContext, ToolCallResult, ToolHandler } from '@kernlang/agon-core';

import type { Dispatch, HandlerContext } from '../handlers/types.js';

import { createCouncilTool } from './council-tool.js';

import { createEngineReliabilityTool } from './tool-engine-reliability.js';

import { createRenderProbeTool } from '../surfaces/tool-render-probe.js';

import { createTuiProbeTool } from './tool-tui-probe.js';

import { isTaskFileMutationAction, taskActionApprovalMessage, isApprovedPermissionResponse } from './task-execution-lease.js';

import { authorizeResolvedTaskAction } from './permission-resolver.js';

import { getSessionAllowList } from '../signals/output.js';

import { asLiveTodos } from '../signals/todos.js';

import { isBashToolName } from './brain-helpers.js';

/**
 * Create and populate the standard Cesar tool registry. Single source of truth — no more duplication.
 */
const CESAR_SURFACE_IDS = new Set(FIRST_PARTY_SURFACE_CATALOG.filter((entry) => entry.category === 'cesarTools').map((entry) => entry.publicId));

export function createCesarToolRegistry(engineId?: string, available: ReadonlySet<string> = processSurfaceNames('cesar')): ToolRegistry {
  const toolRegistry = new ToolRegistry();
  const register = (handler: ToolHandler): void => { if (CESAR_SURFACE_IDS.has(handler.definition.name) && available.has(handler.definition.name)) toolRegistry.register(handler); };
  register(createReadTool());
  register(createEditTool());
  register(createMultiEditTool());
  register(createWriteTool());
  register(createBashTool());
  register(createGrepTool());
  register(createGlobTool());
  register(createForgeTool());
  register(createBrainstormTool());
  register(createTribunalTool());
  register(createCampfireTool());
  register(createCouncilTool());
  register(createPipelineTool());
  register(createGoalTool());
  register(createConquerTool());
  register(createReviewTool());
  register(createDelegateTool());
  register(createAgentTool());
  register(createReportConfidenceTool());
  register(createQuickNeroTool());
  register(createTodoWriteTool());
  register(createSaveMemoryTool());
  register(createProposePlanTool());
  register(createExitPlanModeTool());
  register(createListPlansTool());
  register(createRetrieveResultTool(engineId));
  register(createEngineReliabilityTool());
  register(createRenderProbeTool());
  register(createTuiProbeTool());
  for (const record of processSurfaceClient('cesar').project().entries) {
    if (record.kind !== 'cesar-tool') continue;
    const payload = record.payload as {
      readonly description: string;
      readonly inputSchema: Record<string, unknown>;
      readonly effect: 'read' | 'write' | 'network' | 'process';
      run(input: Record<string, unknown>, context: Record<string, unknown>): Promise<unknown> | unknown;
    };
    const readOnly = payload.effect === 'read';
    for (const name of [record.id, ...record.aliases]) {
      if (toolRegistry.has(name) || !available.has(name)) continue;
      const validate = (input: Record<string, unknown>): string | null => {
        try { assertCanonicalSurfaceSelectionCurrent(); assertContributionInput(payload.inputSchema, input); return null; }
        catch (error) { return error instanceof Error ? error.message : String(error); }
      };
      toolRegistry.register({
        definition: { name, description: payload.description, inputSchema: payload.inputSchema,
          maxResultSizeChars: 100_000, isReadOnly: readOnly, isConcurrencySafe: readOnly },
        validate,
        checkPermission: () => {
          assertCanonicalSurfaceSelectionCurrent();
          return readOnly ? { behavior: 'allow' } : { behavior: 'ask', message: `Allow external mod tool ${name}?` };
        },
        execute: async (input, context) => {
          assertCanonicalSurfaceSelectionCurrent();
          assertContributionInput(payload.inputSchema, input);
          const platform = `${process.platform}-${process.arch}`;
          if (!['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].includes(platform)) return { ok: false, content: '', error: `unsupported platform: ${platform}` };
          const value = await payload.run(input, {
            invocationId: `cesar-${Date.now()}`, cwd: context.cwd, platform,
            signal: context.abortSignal ?? new AbortController().signal, config: Object.freeze({}),
          });
          return { ok: true, content: typeof value === 'string' ? value : JSON.stringify(value) };
        },
      });
    }
  }
  return toolRegistry;
}

/**
 * Create a shared ToolContext for eager tool execution during streaming.
 */
export function createEagerToolContext(ctx: HandlerContext, config: any, signal: AbortSignal, dispatch: Dispatch): ToolContext {
  const cwd = resolveWorkingDir();
  const fsc = getProjectFileStateCache(cwd);
  const explorationMode = (ctx as any).explorationMode ?? false;
  return { cwd: cwd, readFileState: (fsc as any).cache, abortSignal: signal, permissionMode: (config as any).permissionMode ?? 'ask', explorationMode: explorationMode, allowedCommands: (config as any).allowedCommands ?? [], toolPermissions: (config as any).toolPermissions ?? {}, source: 'orchestrator' as const, permissionRules: parsePermissionRuleSet((config as any).permissions), toolHooks: parseToolHooks((config as any).hooks), taskExecutionLease: ctx.cesar?.taskExecutionLease, onProgress: (msg: string) => dispatch({ type: 'spinner-update', message: `Cesar: ${msg}` }), onTodos: (todos: any[]) => dispatch({ type: 'todos-set', todos: asLiveTodos(todos) } as any) } as any;
}

/**
 * Parse a streaming tool input into a JSON object. Malformed input is returned as an explicit retryable error instead of being silently coerced.
 */
export function parseEagerToolInput(toolName: string, input: unknown): {ok:boolean,input?:Record<string,unknown>,error?:string,raw:string} {
  const raw = typeof input === 'string'
    ? input
    : input === undefined ? ''
    : (() => {
      try { return JSON.stringify(input) ?? String(input); }
      catch { return String(input); }
    })();
  
  if (input === undefined) {
    return { ok: true, input: {}, raw };
  }
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return { ok: true, input: input as Record<string, unknown>, raw };
  }
  if (typeof input !== 'string') {
    return {
      ok: false,
      raw,
      error: `Malformed ${toolName} tool input: expected a JSON object, got ${input === null ? 'null' : Array.isArray(input) ? 'array' : typeof input}. Re-emit the ${toolName} tool call with a complete JSON object matching its schema.`,
    };
  }
  
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: true, input: {}, raw };
  }
  
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, input: parsed as Record<string, unknown>, raw };
    }
    return {
      ok: false,
      raw,
      error: `Malformed ${toolName} tool input: expected a JSON object, got ${parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed}. Re-emit the ${toolName} tool call with a complete JSON object matching its schema.`,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      raw,
      error: `Malformed ${toolName} tool input JSON: ${detail}. Re-emit the ${toolName} tool call with a complete JSON object matching its schema.`,
    };
  }
}

/**
 * Execute a tool eagerly during streaming — parse input, run, dispatch result.
 */
export async function executeEagerTool(toolName: string, meta: Record<string,unknown>, toolRegistry: ToolRegistry, toolCtx: ToolContext, dispatch: Dispatch, cesarEngineId: string): Promise<ToolCallResult> {
  const callId = (meta.toolCallId as string) ?? `eager-${Date.now()}`;
  const parsed = parseEagerToolInput(toolName, meta.input);
  const toolInput = parsed.raw;
  if (!parsed.ok) {
    const error = parsed.error ?? `Malformed ${toolName} tool input`;
    const result: ToolCallResult = {
      toolCallId: callId,
      toolName,
      result: { ok: false, content: '', error, terminalReason: 'failed' },
      durationMs: 0,
    };
    dispatch({ type: 'tool-call', engineId: cesarEngineId, tool: toolName, input: toolInput, toolCallId: callId, terminalReason: 'failed', status: 'error', output: error, durationMs: result.durationMs } as any);
    return result;
  }
  const parsedInput = parsed.input ?? {};
  const lease = (toolCtx as any).taskExecutionLease;
  const requestTaskApproval = (tool: string, message: string) => new Promise<boolean>((resolve) => {
    const command = (parsedInput as any).command ?? (parsedInput as any).file_path ?? toolInput;
    dispatch({ type: 'permission-ask', tool, command, reason: message, resolve: (approved: boolean | string) => {
      resolve(isApprovedPermissionResponse(approved));
    } } as any);
  });
  const authorizeEagerTaskAction = async (tool: string, input: Record<string, unknown>): Promise<boolean | string> => {
    const target = isBashToolName(tool)
      ? String((input as any).command ?? '')
      : String((input as any).file_path ?? (input as any).notebook_path ?? (input as any).path ?? (input as any).task ?? '');
    const needsAuthorization = isTaskFileMutationAction(tool)
      || (isBashToolName(tool) && !isReadOnlyCommand(target));
    if (!lease || !needsAuthorization) return true;
    const authorization = await authorizeResolvedTaskAction(
      { tool, target, cwd: (toolCtx as any).cwd ?? resolveWorkingDir(), source: 'native', config: loadConfig(), lease, sessionAllowList: getSessionAllowList() },
      (evaluation: any) => requestTaskApproval(
        tool,
        taskActionApprovalMessage(evaluation),
      ),
    );
    return authorization.decision === 'allow'
      ? true
      : `Task execution lease denied ${tool} (${authorization.reason}).`;
  };
  
  const streamId = `eager-stream-${callId}`;
  let streamStarted = false;
  
  const streamingCtx: ToolContext = {
    ...toolCtx,
    authorizeToolCall: authorizeEagerTaskAction,
    onStreamChunk: (chunk: string) => {
      if (!streamStarted) {
        streamStarted = true;
        dispatch({ type: 'tool-stream-start', streamId, engineId: cesarEngineId, tool: toolName, input: toolInput } as any);
      }
      dispatch({ type: 'tool-stream-chunk', streamId, chunk } as any);
    },
  };
  
  const result = await executeToolCall(
    { id: callId, name: toolName, input: parsedInput },
    streamingCtx,
    toolRegistry,
    async (tool: string, message: string) => {
      const permissionTarget = isBashToolName(tool)
        ? String((parsedInput as any).command ?? '')
        : String((parsedInput as any).file_path ?? (parsedInput as any).notebook_path ?? (parsedInput as any).path ?? (parsedInput as any).task ?? '');
      const permissionNeedsTaskAuthorization = isTaskFileMutationAction(tool)
        || (isBashToolName(tool) && !isReadOnlyCommand(permissionTarget));
      if (lease && permissionNeedsTaskAuthorization) {
        return authorizeEagerTaskAction(tool, parsedInput);
      }
      return requestTaskApproval(tool, message);
    },
  );
  
  const out = result.result.ok ? result.result.content : result.result.error;
  const status = result.result.ok ? 'done' : 'error';
  // executeToolCall measures its own wall-clock elapsed (result.durationMs) — the
  // most accurate source for the eager path. Carry it on the terminal event so the
  // renderer shows the "· 1.4s" suffix; the brain-side _toolStartMs entry is cleared
  // by dispatchToolCall when a terminal event already carries durationMs.
  if (streamStarted) {
    dispatch({ type: 'tool-stream-end', streamId, engineId: cesarEngineId, tool: toolName, input: toolInput, toolCallId: callId, terminalReason: result.result.terminalReason, status, output: out, durationMs: result.durationMs } as any);
  } else {
    // No chunks produced (permission denied, fast exit, etc.) — emit a normal tool-call block
    dispatch({ type: 'tool-call', engineId: cesarEngineId, tool: toolName, input: toolInput, toolCallId: callId, terminalReason: result.result.terminalReason, status, output: out, durationMs: result.durationMs } as any);
  }
  return result;
}
