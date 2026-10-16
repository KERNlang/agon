import { createBrainstormHostServices as createModHost } from '@kernlang/agon-mod-brainstorm';
import type { BrainstormHostServices } from '@kernlang/agon-mod-brainstorm';
import type { EngineAdapter } from '@kernlang/agon-support-engine-runtime';
import { buildKernDraftPrompt, parseKernDraft } from '@kernlang/protocol';
import type { EngineRegistry } from '../signals/engine-registry.js';
import { getRatings, seedNewEnginesFromRegistry, updateGlickoRanked } from '../signals/glicko.js';
import { loadConfig } from '../signals/config.js';
import { classifyTask } from './task-classifier.js';

/** A06-HOST-CAPABILITIES: public compatibility facade for CLI/MCP effects.
 * Remove after both decorators use final effect owners, including configuration.
 * The Brainstorm mod owns runtime bindings and dispatch policy.
 */
export function createBrainstormHostServices(
  openRegistry: (cwd: string) => EngineRegistry,
  createAdapter: (registry: EngineRegistry) => EngineAdapter,
  captureAuthority: () => () => void = () => () => {},
): BrainstormHostServices {
  return createModHost<EngineRegistry>({
    openRegistry, createAdapter, captureAuthority, loadConfig, classifyTask,
    readRatings: getRatings, buildPrompt: buildKernDraftPrompt, parseDraft: parseKernDraft,
    seedRegistry: seedNewEnginesFromRegistry, updateRanked: updateGlickoRanked,
  });
}
