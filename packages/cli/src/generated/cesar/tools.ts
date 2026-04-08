// @kern-source: tools:1
import { ToolRegistry, FileStateCache, createReadTool, createEditTool, createWriteTool, createBashTool, createGrepTool, createGlobTool, createForgeTool, createBrainstormTool, createTribunalTool, createCampfireTool, createPipelineTool, createReviewTool, createDelegateTool, createReportConfidenceTool, createProposePlanTool, executeToolCall, resolveWorkingDir } from '@agon/core';

// @kern-source: tools:2
import type { ToolContext, ToolCallResult } from '@agon/core';

// @kern-source: tools:3
import type { Dispatch, HandlerContext } from '../../handlers/types.js';

// @kern-source: tools:5
export function createCesarToolRegistry(): ToolRegistry {
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(createReadTool());
  toolRegistry.register(createEditTool());
  toolRegistry.register(createWriteTool());
  toolRegistry.register(createBashTool());
  toolRegistry.register(createGrepTool());
  toolRegistry.register(createGlobTool());
  toolRegistry.register(createForgeTool());
  toolRegistry.register(createBrainstormTool());
  toolRegistry.register(createTribunalTool());
  toolRegistry.register(createCampfireTool());
  toolRegistry.register(createPipelineTool());
  toolRegistry.register(createReviewTool());
  toolRegistry.register(createDelegateTool());
  toolRegistry.register(createReportConfidenceTool());
  toolRegistry.register(createProposePlanTool());
  return toolRegistry;
}

// @kern-source: tools:27
export function createEagerToolContext(ctx: HandlerContext, config: any, signal: AbortSignal, dispatch: Dispatch): ToolContext {
  const fsc = new FileStateCache();
  const explorationMode = (ctx as any).explorationMode ?? false;
  return {
    cwd: resolveWorkingDir(),
    readFileState: (fsc as any).cache,
    abortSignal: signal,
    permissionMode: (config as any).permissionMode ?? 'ask',
    explorationMode,
    allowedCommands: (config as any).allowedCommands ?? [],
    toolPermissions: (config as any).toolPermissions ?? {},
    onProgress: (msg: string) => dispatch({ type: 'spinner-update', message: `Cesar: ${msg}` }),
  };
}

// @kern-source: tools:44
export async function executeEagerTool(toolName: string, meta: Record<string,unknown>, toolRegistry: ToolRegistry, toolCtx: ToolContext, dispatch: Dispatch, cesarEngineId: string): Promise<ToolCallResult> {
  let parsedInput: Record<string, unknown> = {};
  try {
    parsedInput = typeof meta.input === 'string' ? JSON.parse(meta.input) : (meta.input as Record<string, unknown>);
  } catch { parsedInput = { raw: meta.input }; }
  
  const callId = (meta.toolCallId as string) ?? `eager-${Date.now()}`;
  const toolInput = typeof meta.input === 'string' ? meta.input
    : meta.input ? JSON.stringify(meta.input) : '';
  
  const result = await executeToolCall(
    { id: callId, name: toolName, input: parsedInput },
    toolCtx,
    toolRegistry,
    async (tool: string, message: string) => {
      return new Promise<boolean>((resolve) => {
        let command = '';
        try {
          const parsed = typeof meta.input === 'string' ? JSON.parse(meta.input as string) : meta.input;
          command = (parsed as any).command ?? (parsed as any).file_path ?? toolInput;
        } catch { command = toolInput; }
        dispatch({ type: 'permission-ask', tool, command, reason: message, resolve } as any);
      });
    },
  );
  
  const out = result.result.ok ? result.result.content : result.result.error;
  dispatch({ type: 'tool-call', engineId: cesarEngineId, tool: toolName, input: toolInput, status: result.result.ok ? 'done' : 'error', output: out } as any);
  return result;
}

