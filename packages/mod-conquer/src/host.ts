import type { Awaitable, InvocationContext } from '@kernlang/agon-mod-api';
import { guardEngineAdapter } from '@kernlang/agon-support-engine-runtime';
import type { EngineAdapter, EngineDefinition } from '@kernlang/agon-support-engine-runtime';
import type { FalsifierEffects } from './falsifier.js';

export interface ConquerHostServices {
  contextSpine(context: InvocationContext): Promise<string>;
  open(context: InvocationContext): Awaitable<FalsifierEffects & { assertCurrent(): void }>;
}

/** Bind catalog and provider access to the current invocation authority. */
export function createConquerHostServices<Registry extends { get(id: string): EngineDefinition }>(options: {
  openRegistry(cwd: string): Registry;
  createAdapter(registry: Registry): EngineAdapter;
  rankCritics(registry: Registry, engineIds: string[]): ReturnType<FalsifierEffects['rankCritics']>;
  contextSpine(context: InvocationContext): Promise<string>;
  captureAuthority(): () => void;
}): ConquerHostServices {
  return {
    contextSpine: options.contextSpine,
    open(context) {
      context.signal.throwIfAborted();
      const assertCurrent = options.captureAuthority();
      const check = (signal?: AbortSignal) => {
        context.signal.throwIfAborted();
        signal?.throwIfAborted();
        assertCurrent();
      };
      check();
      const registry = options.openRegistry(context.cwd);
      return {
        assertCurrent,
        adapter: guardEngineAdapter(options.createAdapter(registry), check),
        getEngine: id => { check(); return registry.get(id); },
        rankCritics: ids => { check(); return options.rankCritics(registry, ids); },
      };
    },
  };
}
