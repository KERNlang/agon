import { validateManifest } from '@kernlang/agon-mod-api';
import manifest from '../agon.mod.json' with { type: 'json' };
import ownership from '../ownership.json' with { type: 'json' };

export const MANIFEST = validateManifest(manifest);
export const SOURCE_OCCURRENCES = Object.freeze(ownership.assignments);

export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { createTeamBrainstormRuntime } from './runtime.js';
export { createTeamBrainstormHostServices } from './host.js';
export type { TeamBrainstormHostServices, TeamBrainstormHostEffects, TeamBrainstormModServices, TeamBrainstormInvocationOptions } from './host.js';
export type { TeamBrainstormEffects, TeamBrainstormOptions, TeamBrainstormRegistry, TeamBrainstormConfig, TeamBrainstormEvent } from './runtime.js';
export { presentTeamBrainstormEvent, presentTeamBrainstormResult } from './presentation.js';
export type { TeamBrainstormDisplayEvent } from './presentation.js';
export { runTeamBrainstormSession } from './session-workflow.js';
export type { TeamBrainstormSessionHost, TeamBrainstormSessionExecutionContext } from './session-workflow.js';
