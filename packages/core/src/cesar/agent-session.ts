/** @deprecated S4 compatibility adapter. Import from @kernlang/agon-support-agent-runtime. */
import { AgentSession as ModularAgentSession } from '@kernlang/agon-support-agent-runtime';
import type { AgentSessionConfig, AgentSessionRuntime } from '@kernlang/agon-support-agent-runtime';

import { makeAssistantChunk, makeToolCall } from '../models/agent-event.js';
import { runApiAgentLoop } from '../api/agent-loop.js';
import { estimateCost, estimateTokens } from '../signals/token-tracker.js';

const compatibilityRuntime: AgentSessionRuntime = Object.freeze<AgentSessionRuntime>({ estimateCost, estimateTokens, makeAssistantChunk, makeToolCall, runApiAgentLoop });

export class AgentSession extends ModularAgentSession {
  constructor(config: AgentSessionConfig) {
    super(config, compatibilityRuntime);
  }
}

export * from '@kernlang/agon-support-agent-runtime';
