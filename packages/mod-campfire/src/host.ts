import type { Awaitable, InvocationContext, ModServices } from '@kernlang/agon-mod-api';
import { guardEngineAdapter } from '@kernlang/agon-support-engine-runtime';
import type { EngineAdapter } from '@kernlang/agon-support-engine-runtime';
import type { PanelEngineRegistry, PanelHealthRuntime } from '@kernlang/agon-support-panel';
import type { CampfireEffects } from './runtime.js';

export interface CampfireHostSession {
  readonly registry: PanelEngineRegistry;
  readonly adapter: EngineAdapter;
  readonly effects: CampfireEffects;
  assertCurrent(): void;
}

export interface CampfireHostServices {
  open(context: InvocationContext): Awaitable<CampfireHostSession>;
}

export interface CampfireModServices extends ModServices {
  readonly campfire?: CampfireHostServices;
}

export interface CampfireHostEffects<Registry extends PanelEngineRegistry> extends PanelHealthRuntime {
  openRegistry(cwd: string): Registry;
  createAdapter(registry: Registry): EngineAdapter;
  captureAuthority(): () => void;
  warn(message: string): void;
}

export function createCampfireHostServices<Registry extends PanelEngineRegistry>(effects: CampfireHostEffects<Registry>): CampfireHostServices {
  return {
    open(context) {
      const checkGeneration = effects.captureAuthority();
      const assertCurrent = () => { context.signal.throwIfAborted(); checkGeneration(); };
      assertCurrent();
      const registry = effects.openRegistry(context.cwd);
      const adapter = guardEngineAdapter(effects.createAdapter(registry), signal => {
        assertCurrent();
        signal?.throwIfAborted();
      });
      return {
        registry, adapter, assertCurrent,
        effects: {
          assertCurrent,
          loadConfig: () => { assertCurrent(); return effects.loadConfig(context.cwd); },
          warn: effects.warn,
        },
      };
    },
  };
}
