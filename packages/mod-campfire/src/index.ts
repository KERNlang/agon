import { validateManifest } from '@kernlang/agon-mod-api';
import manifest from '../agon.mod.json' with { type: 'json' };
import ownership from '../ownership.json' with { type: 'json' };

export const MANIFEST = validateManifest(manifest);
export const SOURCE_OCCURRENCES = Object.freeze(ownership.assignments);

export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runCampfireRuntime } from './runtime.js';
export type { CampfireOptions, CampfireEffects, CampfireResult } from './runtime.js';
export { createCampfireHostServices } from './host.js';
export type { CampfireHostEffects, CampfireHostServices, CampfireHostSession, CampfireModServices } from './host.js';
export { runCampfireSession } from './session-workflow.js';
export type { CampfireSessionContext, CampfireSessionCommandResult, CampfireSessionHost, CampfireSessionEvent } from './session-workflow.js';
