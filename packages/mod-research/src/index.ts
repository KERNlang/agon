import { validateManifest } from '@kernlang/agon-mod-api';
import manifest from '../agon.mod.json' with { type: 'json' };
import ownership from '../ownership.json' with { type: 'json' };

export const MANIFEST = validateManifest(manifest);
export const SOURCE_OCCURRENCES = Object.freeze(ownership.assignments);

export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runResearch, validateUrl, formatResearchResult } from './implementation.js';
export { runResearchSession, ResearchGroundingError, ResearchInputError } from './session-workflow.js';
export type { ResearchSessionContext, ResearchSessionHost } from './session-workflow.js';
export { classifyQuery } from './query-policy.js';
export type { ResearchIntent } from './query-policy.js';
export { buildResearchPrompt, buildPrompt } from './prompt-policy.js';
export { parseAuthoritativeResults } from './response-policy.js';
export type { ResearchSearchResult } from './response-policy.js';
export { cleanQuery, buildAuthoritativeRequest } from './discovery-policy.js';
export type { ResearchRequest } from './discovery-policy.js';
export { extractCitations, judgeProbe, formatCitationReport } from './citation-policy.js';
export type { CitationStatus, CitationProbe, CitationVerdict, CitationReport } from './citation-policy.js';
