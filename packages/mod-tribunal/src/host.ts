import type { Awaitable, InvocationContext, ModServices } from '@kernlang/agon-mod-api';
import { guardEngineAdapter } from '@kernlang/agon-support-engine-runtime';
import type { EngineAdapter } from '@kernlang/agon-support-engine-runtime';
import type { PanelEngineRegistry } from '@kernlang/agon-support-panel';
import type { TribunalEvent, TribunalRuntimeEffects } from './runtime.js';
import type { TribunalOutput } from './presentation.js';

export interface TribunalInvocationContext extends InvocationContext {
  readonly onWorkflowEvent?: (event: TribunalEvent) => void;
  readonly onRunStarted?: (path: string) => void;
}

export interface TribunalHostSession {
  readonly registry: PanelEngineRegistry;
  readonly adapter: EngineAdapter;
  readonly effects: TribunalRuntimeEffects<PanelEngineRegistry>;
  assertCurrent(): void;
}

export interface TribunalHostServices {
  open(context: InvocationContext): Awaitable<TribunalHostSession>;
  readonly cliOutput?: TribunalOutput;
}

export interface TribunalModServices extends ModServices {
  readonly tribunal?: TribunalHostServices;
}

export interface TribunalHostEffects<Registry extends PanelEngineRegistry>
  extends TribunalRuntimeEffects<Registry> {
  openRegistry(cwd: string): Registry;
  createAdapter(registry: Registry): EngineAdapter;
  captureAuthority(): () => void;
}

/** Open invocation-scoped effects. This factory starts no provider work. */
export function createTribunalHostServices<Registry extends PanelEngineRegistry>(
  effects: TribunalHostEffects<Registry>,
): TribunalHostServices {
  return {
    open(context) {
      const checkGeneration = effects.captureAuthority();
      const assertCurrent = () => {
        context.signal.throwIfAborted();
        checkGeneration();
      };
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
          seedRegistry: () => { assertCurrent(); effects.seedRegistry(registry); },
          loadConfig: () => { assertCurrent(); return effects.loadConfig(context.cwd); },
          classifyTask: question => effects.classifyTask(question),
          updateRanked: (ranked, taskClass, mode) => {
            assertCurrent();
            effects.updateRanked(ranked, taskClass, mode);
          },
        },
      };
    },
  };
}
