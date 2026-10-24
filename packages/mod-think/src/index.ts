import { validateManifest } from '@kernlang/agon-mod-api';
import manifest from '../agon.mod.json' with { type: 'json' };
import ownership from '../ownership.json' with { type: 'json' };

export const MANIFEST = validateManifest(manifest);
export const SOURCE_OCCURRENCES = Object.freeze(ownership.assignments);

export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export * from './thinking.js';
export { runThinkRuntime, runThinkCritique } from './runtime.js';
export type { ThinkRuntimeOptions, ThinkCritiqueOptions, ThinkEffects } from './runtime.js';
export { createThinkHostServices } from './host.js';
export type { ThinkEngineRegistry, ThinkHostSession, ThinkHostServices, ThinkModServices, ThinkHostEffects } from './host.js';
