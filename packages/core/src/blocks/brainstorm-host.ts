import type { BrainstormHostServices } from '@kernlang/agon-mod-brainstorm';
import type { EngineAdapter } from '@kernlang/agon-support-engine-runtime';
import { dedupBrainstormDrafts } from '@kernlang/agon-support-dedup';
import { dispatchSeatWithRetry, preflightHealthFilter } from '@kernlang/agon-support-panel';
import { buildKernDraftPrompt, parseKernDraft } from '@kernlang/protocol';
import type { EngineRegistry } from '../signals/engine-registry.js';
import { getRatings, seedNewEnginesFromRegistry, updateGlickoRanked } from '../signals/glicko.js';
import { loadConfig } from '../signals/config.js';
import { classifyTask } from './task-classifier.js';
import { createSidechainLogger } from './sidechain-logger.js';

/** A06-HOST-CAPABILITIES (KL-011): shared CLI/MCP compatibility wiring.
 * Remove when registry, ratings, protocol and log effects have final host owners.
 * No scoring, collection or workflow decisions belong in this adapter.
 */
export function createBrainstormHostServices(
  openRegistry: (cwd: string) => EngineRegistry,
  createAdapter: (registry: EngineRegistry) => EngineAdapter,
): BrainstormHostServices {
  return {
    open(context) {
      const registry = openRegistry(context.cwd);
      const adapter = createAdapter(registry);
      return {
        readRatings: getRatings,
        buildPrompt: buildKernDraftPrompt,
        parseDraft: parseKernDraft,
        seed: () => { seedNewEnginesFromRegistry(registry); },
        preflight: options => preflightHealthFilter({
          engineIds: options.engines, registry, adapter, signal: context.signal,
          runtime: { loadConfig: () => loadConfig(context.cwd) },
        }),
        createLogger: createSidechainLogger,
        deduplicate: dedupBrainstormDrafts,
        updateRatings: (bids, question) => updateGlickoRanked(
          bids.map(bid => ({ engineId: bid.engineId, score: bid.score ?? 0 })),
          classifyTask(question), 'brainstorm',
        ),
        selectSeat: (options, engineId) => {
          const engine = registry.get(engineId);
          return (prompt, systemPrompt) => dispatchSeatWithRetry(adapter, {
            engineId, engine, prompt, systemPrompt, textOnly: true,
            cwd: context.cwd, mode: 'exec', timeout: options.timeout,
            outputDir: options.outputDir, signal: context.signal,
          });
        },
        selectWinner: (options, engineId) => {
          const engine = registry.get(engineId);
          return prompt => adapter.dispatch({
            engine, prompt, textOnly: true,
            systemPrompt: 'You are expanding on a winning brainstorm approach. Respond directly with your detailed analysis as plain text. Do NOT use tools, read files, or run commands.',
            cwd: context.cwd, mode: 'exec', timeout: options.timeout,
            outputDir: options.outputDir, signal: context.signal,
          });
        },
      };
    },
  };
}
