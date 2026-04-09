// @kern-source: tool-retrieve:7
import type { ToolResult, ToolContext, ToolHandler, ToolDefinition, PermissionDecision } from '../models/tool-types.js';

// @kern-source: tool-retrieve:8
import { loadToolResultFromDisk } from '../signals/session-store.js';

// @kern-source: tool-retrieve:10
/**
 * Factory for the RetrieveResult tool — retrieves cached tool outputs from disk.
 */
export function createRetrieveResultTool(engineId?: string): ToolHandler {
  const definition: ToolDefinition = {
    name: 'RetrieveResult',
    description: 'Retrieve the full content of a previously cached tool result. When you see "[cached — {id}]" in a tool output, use this tool with that id to get the full content without re-running the original tool.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The cache ID from the [cached — {id}] marker in a previous tool result' },
      },
      required: ['id'],
    },
    maxResultSizeChars: 100000,
    isReadOnly: true,
    isConcurrencySafe: true,
  };
  
  const validate = (input: Record<string, unknown>, _ctx: ToolContext): string | null => {
    if (!input.id || typeof input.id !== 'string') {
      return 'Missing required parameter: id (the cache ID from [cached — {id}] marker)';
    }
    return null;
  };
  
  const execute = async (input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
    const id = input.id as string;
    const eid = engineId ?? 'api-agent';
    const content = loadToolResultFromDisk(eid, id);
  
    if (content === null) {
      return {
        ok: false,
        content: '',
        error: `No cached result found for id "${id}". The cache entry may have expired or been pruned. Try re-running the original tool.`,
      };
    }
  
    return {
      ok: true,
      content,
    };
  };
  
  const checkPermission = (_input: Record<string, unknown>, _ctx: ToolContext): PermissionDecision => {
    // RetrieveResult is always allowed — it only reads from the local cache, no filesystem access
    return { behavior: 'allow' as const };
  };
  
  return { definition, validate, checkPermission, execute };
}

