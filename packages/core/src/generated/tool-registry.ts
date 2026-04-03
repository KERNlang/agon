import type { ToolDefinition, ToolCall, ToolCallResult, ToolResult, ToolContext, PermissionDecision, ToolHandler } from './tool-types.js';

export class ToolRegistry {
  tools: Map<string, ToolHandler>;

  constructor() {
    this.tools = new Map();
  }

  register(handler: ToolHandler): void {
    this.tools.set(handler.definition.name, handler);
  }

  get(name: string): ToolHandler|undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(h => h.definition);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  names(): string[] {
    return Array.from(this.tools.keys());
  }
}

export async function executeToolCall(call: ToolCall, ctx: ToolContext, registry: ToolRegistry, onPermissionAsk?: (tool:string,message:string)=>Promise<boolean>): Promise<ToolCallResult> {
  const start = Date.now();
  const handler = registry.get(call.name);
  
  if (!handler) {
    return {
      toolCallId: call.id,
      toolName: call.name,
      result: { ok: false, content: '', error: `Unknown tool: ${call.name}` },
      durationMs: Date.now() - start,
    };
  }
  
  // Phase 1: Validate input
  const validationError = handler.validate(call.input, ctx);
  if (validationError) {
    return {
      toolCallId: call.id,
      toolName: call.name,
      result: { ok: false, content: '', error: validationError },
      durationMs: Date.now() - start,
    };
  }
  
  // Phase 2: Permission check
  const permission = handler.checkPermission(call.input, ctx);
  if (permission.behavior === 'deny') {
    return {
      toolCallId: call.id,
      toolName: call.name,
      result: { ok: false, content: '', error: permission.message ?? 'Permission denied' },
      durationMs: Date.now() - start,
    };
  }
  if (permission.behavior === 'ask') {
    if (onPermissionAsk) {
      const allowed = await onPermissionAsk(call.name, permission.message ?? `Allow ${call.name}?`);
      if (!allowed) {
        return {
          toolCallId: call.id,
          toolName: call.name,
          result: { ok: false, content: '', error: 'User denied permission' },
          durationMs: Date.now() - start,
        };
      }
    } else {
      // No ask handler — deny by default
      return {
        toolCallId: call.id,
        toolName: call.name,
        result: { ok: false, content: '', error: 'Permission required but no handler available' },
        durationMs: Date.now() - start,
      };
    }
  }
  
  // Phase 3: Execute
  try {
    const result = await handler.execute(call.input, ctx);
  
    // Truncate if over maxResultSizeChars
    if (result.content.length > handler.definition.maxResultSizeChars) {
      result.content = result.content.slice(0, handler.definition.maxResultSizeChars) + `\n\n[Truncated: ${result.content.length - handler.definition.maxResultSizeChars} chars omitted]`;
    }
  
    return {
      toolCallId: call.id,
      toolName: call.name,
      result,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      toolCallId: call.id,
      toolName: call.name,
      result: { ok: false, content: '', error: err instanceof Error ? err.message : String(err) },
      durationMs: Date.now() - start,
    };
  }
}

export async function executeToolCalls(calls: ToolCall[], ctx: ToolContext, registry: ToolRegistry, onPermissionAsk?: (tool:string,message:string)=>Promise<boolean>, onProgress?: (result:ToolCallResult)=>void): Promise<ToolCallResult[]> {
  const results: ToolCallResult[] = [];
  
  // Partition into batches: consecutive concurrency-safe tools run in parallel
  const batches: ToolCall[][] = [];
  let currentBatch: ToolCall[] = [];
  let currentBatchConcurrent = false;
  
  for (const call of calls) {
    const handler = registry.get(call.name);
    const isSafe = handler?.definition.isConcurrencySafe ?? false;
  
    if (currentBatch.length === 0) {
      currentBatch.push(call);
      currentBatchConcurrent = isSafe;
    } else if (isSafe && currentBatchConcurrent) {
      currentBatch.push(call);
    } else {
      batches.push(currentBatch);
      currentBatch = [call];
      currentBatchConcurrent = isSafe;
    }
  }
  if (currentBatch.length > 0) batches.push(currentBatch);
  
  // Execute batches
  for (const batch of batches) {
    if (batch.length === 1 || !currentBatchConcurrent) {
      // Serial
      for (const call of batch) {
        if (ctx.abortSignal?.aborted) break;
        const result = await executeToolCall(call, ctx, registry, onPermissionAsk);
        results.push(result);
        if (onProgress) onProgress(result);
      }
    } else {
      // Parallel (capped at 10)
      const MAX_CONCURRENT = 10;
      for (let i = 0; i < batch.length; i += MAX_CONCURRENT) {
        if (ctx.abortSignal?.aborted) break;
        const chunk = batch.slice(i, i + MAX_CONCURRENT);
        const chunkResults = await Promise.all(
          chunk.map(call => executeToolCall(call, ctx, registry, onPermissionAsk))
        );
        results.push(...chunkResults);
        for (const r of chunkResults) {
          if (onProgress) onProgress(r);
        }
      }
    }
  }
  
  return results;
}

