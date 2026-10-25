import { validateManifest } from '@kernlang/agon-mod-api';
import manifest from '../agon.mod.json' with { type: 'json' };
import ownership from '../ownership.json' with { type: 'json' };

export const MANIFEST = validateManifest(manifest);
export const SOURCE_OCCURRENCES = Object.freeze(ownership.assignments);

export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runAgentTask } from './implementation.js';
export { makeAssistantChunk, makeToolCall, makeTurnComplete, makeError, normalizeSessionChunk, buildApiTurnEvents, unavailableUsage, estimatedUsage } from './events.js';
export type { AgentEvent, AgentUsage, RawSessionChunk } from './events.js';
