import { createBrainstormRuntime, createBrainstormEngineServices } from '@kernlang/agon-mod-brainstorm';
// A06-BRAINSTORM-POLICY (KL-011): retain the legacy exports, not duplicate algorithms.
export { structuralScore, scoutScore, assignStances, fallbackParse } from '@kernlang/agon-mod-brainstorm';

import type { EngineRegistry } from '@kernlang/agon-core';
import type { BrainstormEngineOptions } from '@kernlang/agon-mod-brainstorm';
import { getRatings, loadConfig, updateGlickoRanked, classifyTask, seedNewEnginesFromRegistry } from '@kernlang/agon-core';

import { buildKernDraftPrompt, parseKernDraft } from '@kernlang/protocol';

// Public compatibility facade. The mod owns dispatch and workflow policy.
const runtime = createBrainstormRuntime(createBrainstormEngineServices<EngineRegistry>({
  readRatings: getRatings,
  buildPrompt: buildKernDraftPrompt,
  parseDraft: parseKernDraft,
  seedRegistry: seedNewEnginesFromRegistry,
  loadConfig, classifyTask, updateRanked: updateGlickoRanked,
}));

// Keep declarations on the public mod boundary instead of inferred source paths.
type Runtime = ReturnType<typeof createBrainstormRuntime<BrainstormEngineOptions<EngineRegistry>>>;
export const calibrateConfidence: Runtime['calibrateConfidence'] = runtime.calibrateConfidence;
export const qualityScore: Runtime['qualityScore'] = runtime.qualityScore;
export const rankDrafts: Runtime['rankDrafts'] = runtime.rankDrafts;
export const collectRankedDrafts: Runtime['collectRankedDrafts'] = runtime.collectRankedDrafts;
export const runScout: Runtime['runScout'] = runtime.runScout;
export const runBrainstorm: Runtime['runBrainstorm'] = runtime.runBrainstorm;
