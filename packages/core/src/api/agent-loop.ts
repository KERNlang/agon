/** @deprecated S4 compatibility adapter. Import from @kernlang/agon-support-agent-runtime. */
import {
  runApiAgentLoop as runModularApiAgentLoop,
  type AgentLoopRuntime,
  type ApiAgentOptions,
  type ApiAgentResult,
} from "@kernlang/agon-support-agent-runtime";

import { apiStreamDispatchWithHistory } from "./dispatch.js";
import { safeAgentVisibleText } from "./agent-visible.js";
import { getProjectFileStateCache } from "../blocks/file-state-cache.js";
import { executeToolCall, ToolRegistry } from "../signals/tool-registry.js";
import { buildToolSystemPrompt } from "../tools/tool-loop.js";
import { parseToolCalls } from "../tools/tool-parser.js";
import { toolsToOpenAIFormat } from "../tools/tool-prompt.js";
import { createBashTool } from "../tools/tool-bash.js";
import { createEditTool } from "../tools/tool-edit.js";
import { createGlobTool } from "../tools/tool-glob.js";
import { createGrepTool } from "../tools/tool-grep.js";
import { createMultiEditTool } from "../tools/tool-multi-edit.js";
import { createReadTool } from "../tools/tool-read.js";
import { createRetrieveResultTool } from "../tools/tool-retrieve.js";
import { createTodoWriteTool } from "../tools/tool-todo-write.js";
import { createWebFetchTool } from "../tools/tool-web-fetch.js";
import { createWebSearchTool } from "../tools/tool-web-search.js";
import { createWriteTool } from "../tools/tool-write.js";

const compatibilityRuntime: AgentLoopRuntime = Object.freeze<AgentLoopRuntime>({
  apiStreamDispatchWithHistory,
  buildToolSystemPrompt,
  createBashTool,
  createEditTool,
  createGlobTool,
  createGrepTool,
  createMultiEditTool,
  createReadTool,
  createRetrieveResultTool,
  createTodoWriteTool,
  createToolRegistry: () => new ToolRegistry(),
  createWebFetchTool,
  createWebSearchTool,
  createWriteTool,
  executeToolCall,
  getProjectFileStateCache,
  parseToolCalls,
  safeAgentVisibleText,
  toolsToOpenAIFormat,
});

export function runApiAgentLoop(opts: ApiAgentOptions): Promise<ApiAgentResult> {
  return runModularApiAgentLoop(opts, compatibilityRuntime);
}

export * from "@kernlang/agon-support-agent-runtime";
