import { validateManifest } from '@kernlang/agon-mod-api';
import manifest from '../agon.mod.json' with { type: 'json' };
import ownership from '../ownership.json' with { type: 'json' };

export const MANIFEST = validateManifest(manifest);
export const SOURCE_OCCURRENCES = Object.freeze(ownership.assignments);

export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runMutate, generateMutants } from './implementation.js';
export { buildSemanticMutantPrompt, extractJsonArray, validateSemanticMutants, stripControlChars, normalizeLens, MUTATE_LENS_PRESETS, MUTATE_LENS_MAX_CHARS, SEMANTIC_MAX_FILES, SEMANTIC_MAX_LINES_PER_FILE } from './semantic-policy.js';
export type { SemanticTargetLine, SemanticTarget, DroppedSemanticEntry, SemanticMutantsResult } from './semantic-policy.js';
export { collectSemanticMutants } from './semantic-collection.js';
