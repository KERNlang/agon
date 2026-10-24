import type { Awaitable, InvocationContext, ModServices } from '@kernlang/agon-mod-api';
import { guardEngineAdapter } from '@kernlang/agon-support-engine-runtime';
import type { EngineAdapter } from '@kernlang/agon-support-engine-runtime';
import type { ThinkEffects, ThinkRuntimeOptions } from './runtime.js';
import type { ThinkDisplay } from './presentation.js';

export type ThinkEngineRegistry = ThinkRuntimeOptions['registry'] & {
  resolveId(id: string): string;
};

export interface ThinkHostSession {
  readonly registry: ThinkEngineRegistry;
  readonly adapter: EngineAdapter;
  readonly activeEngineIds: readonly string[];
  readonly defaultEngineIds: readonly string[];
  readonly effects: ThinkEffects;
  assertCurrent(): void;
}

export interface ThinkHostServices {
  open(context: InvocationContext): Awaitable<ThinkHostSession>;
  readonly cliOutput?: ThinkDisplay;
}

export interface ThinkModServices extends ModServices {
  readonly think?: ThinkHostServices;
}

export interface ThinkHostEffects<Registry extends ThinkEngineRegistry> {
  openRegistry(cwd: string): Registry;
  createAdapter(registry: Registry): EngineAdapter;
  selectEngines(registry: Registry, cwd: string): {
    activeEngineIds: readonly string[];
    defaultEngineIds: readonly string[];
  };
  captureAuthority(): () => void;
  warn(message: string): void;
}

export function createThinkHostServices<Registry extends ThinkEngineRegistry>(effects: ThinkHostEffects<Registry>): ThinkHostServices {
  return {
    open(context) {
      const checkGeneration = effects.captureAuthority();
      const assertCurrent = () => { context.signal.throwIfAborted(); checkGeneration(); };
      assertCurrent();
      const registry = effects.openRegistry(context.cwd);
      const selected = effects.selectEngines(registry, context.cwd);
      const adapter = guardEngineAdapter(effects.createAdapter(registry), signal => {
        assertCurrent();
        signal?.throwIfAborted();
      });
      assertCurrent();
      return {
        registry, adapter, assertCurrent,
        activeEngineIds: Object.freeze([...selected.activeEngineIds]),
        defaultEngineIds: Object.freeze([...selected.defaultEngineIds]),
        effects: { assertCurrent, warn: effects.warn },
      };
    },
  };
}
