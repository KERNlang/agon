import { validateManifest } from '@kernlang/agon-mod-api';
import manifest from '../agon.mod.json' with { type: 'json' };
import ownership from '../ownership.json' with { type: 'json' };

export const MANIFEST = validateManifest(manifest);
export const SOURCE_OCCURRENCES = Object.freeze(ownership.assignments);

export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runCouncil } from './implementation.js';
export { runCouncilRuntime, DEFAULT_COUNCIL_ROLES, roleGuidance, assignCouncilRoles, buildCouncilBriefPrompt, buildRolePrompt, buildCritiquePrompt, buildChairmanPrompt, parseCouncilConfidence } from './runtime.js';
export type { CouncilOptions, CouncilResult, CouncilSeat, CouncilEvent, CouncilSeating, CouncilRuntimeEffects } from './runtime.js';
export { createCouncilHostServices } from './host.js';
export type { CouncilHostEffects, CouncilHostServices, CouncilHostSession, CouncilModServices, CouncilEngineRegistry } from './host.js';
export { chairmanPickLabel, councilRunStatus, presentCouncilResult } from './presentation.js';
export type { CouncilDisplay } from './presentation.js';
export { runCouncilSession } from './session-workflow.js';
export type { CouncilSessionHost, CouncilSessionContext, CouncilSessionCommandResult } from './session-workflow.js';
