import { validateManifest } from '@kernlang/agon-mod-api';
import manifest from '../agon.mod.json' with { type: 'json' };
import ownership from '../ownership.json' with { type: 'json' };

export const MANIFEST = validateManifest(manifest);
export const SOURCE_OCCURRENCES = Object.freeze(ownership.assignments);

export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runTribunal } from './implementation.js';
export {
  getModeConfig, buildModePrompt, buildModeSummaryPrompt,
  isTribunalMode, isTribunalProtocol, TRIBUNAL_MODES, TRIBUNAL_PROTOCOLS,
} from './modes.js';
export type { TribunalMode, TribunalModeConfig, TribunalProtocol } from './modes.js';
export { createTribunalRuntime, buildFallbackSummary, requireNonEmptyDispatchText } from './runtime.js';
export type { TribunalRuntimeOptions, TribunalRuntimeEffects, TribunalEvent, TribunalPosition, TribunalRound, TribunalResult } from './runtime.js';
export { createTribunalHostServices } from './host.js';
export type { TribunalHostEffects, TribunalHostServices, TribunalHostSession, TribunalModServices, TribunalInvocationContext } from './host.js';
export { renderTribunalResult } from './presentation.js';
export type { TribunalFailure, TribunalOutput } from './presentation.js';
export { createTribunalSessionRecord } from './session-record.js';
export type { TribunalSessionEffects } from './session-record.js';
export { runTribunalSession } from './session-workflow.js';
export type { TribunalSessionHost, TribunalSessionContext, TribunalSessionCommandResult } from './session-workflow.js';
