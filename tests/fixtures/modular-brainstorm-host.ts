import { buildKernDraftPrompt, parseKernDraft } from '@kernlang/protocol';
import { dispatchSeatWithRetry } from '@kernlang/agon-support-panel';
import type { BrainstormModServices } from '../../packages/mod-brainstorm/src/host.js';
import type { DispatchResult } from '@kernlang/agon-support-engine-runtime';

/** In-memory host effects; the real parser, retry and workflow remain in use. */
export function withBrainstormFixtureHost(services: BrainstormModServices): BrainstormModServices {
  return {
    ...services,
    runs: {
      start: async () => ({ id: 'fixture', path: '/fixture', mode: 'brainstorm', startedAt: 'fixture' }),
      finish: async () => {}, writeArtifact: async () => {},
    },
    brainstorm: { open: context => {
      const dispatch = async (engineId: string, prompt: string) =>
        await services.engines.dispatch(engineId, prompt, context) as unknown as DispatchResult;
      return {
        readRatings: () => ({ byMode: { brainstorm: {} }, global: {} }),
        seed: () => {}, preflight: async options => ({ healthy: options.engines, skipped: [] }),
        createLogger: () => ({ log: () => {} }),
        buildPrompt: buildKernDraftPrompt, parseDraft: parseKernDraft,
        deduplicate: async () => ({ groups: null, status: { status: 'unavailable', detail: 'fixture' } }),
        updateRatings: () => {},
        selectSeat: (options, engineId) => (prompt, systemPrompt) => dispatchSeatWithRetry(
          { dispatch: () => dispatch(engineId, prompt) } as never,
          { engineId, engine: { id: engineId }, prompt, systemPrompt, timeout: options.timeout } as never,
        ),
        selectWinner: (_options, engineId) => prompt => dispatch(engineId, prompt),
      };
    } },
  };
}
