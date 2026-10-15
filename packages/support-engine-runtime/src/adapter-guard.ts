import type { EngineAdapter } from './types.js';

/** Check invocation authority before every provider entry point. */
export function guardEngineAdapter(adapter: EngineAdapter, check: (signal?: AbortSignal) => void): EngineAdapter {
  return {
    dispatch: async options => { check(options.signal); return adapter.dispatch(options); },
    isAvailable: async engine => { check(); return adapter.isAvailable(engine); },
    getVersion: async engine => { check(); return adapter.getVersion(engine); },
    ...(adapter.dispatchAgent ? {
      dispatchAgent: async (options: Parameters<EngineAdapter['dispatch']>[0]) => {
        check(options.signal); return adapter.dispatchAgent!(options);
      },
    } : {}),
    ...(adapter.dispatchStream ? {
      dispatchStream: async function* (options: Parameters<EngineAdapter['dispatch']>[0]) {
        check(options.signal); return yield* adapter.dispatchStream!(options);
      },
    } : {}),
    ...(adapter.dispatchAgentStream ? {
      dispatchAgentStream: async function* (options: Parameters<EngineAdapter['dispatch']>[0]) {
        check(options.signal); return yield* adapter.dispatchAgentStream!(options);
      },
    } : {}),
  };
}
