import { validateManifest } from '@kernlang/agon-mod-api';
import manifest from '../agon.mod.json' with { type: 'json' };
import ownership from '../ownership.json' with { type: 'json' };

export const MANIFEST = validateManifest(manifest);
export const SOURCE_OCCURRENCES = Object.freeze(ownership.assignments);

export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runResearch, classifyQuery, validateUrl, formatResearchResult } from './implementation.js';
export { extractCitations, judgeProbe, formatCitationReport } from './citation-policy.js';
export type { CitationStatus, CitationProbe, CitationVerdict, CitationReport } from './citation-policy.js';
