import type { InvocationContext, ModServices } from '@kernlang/agon-mod-api';
import type { TeamMatchResult } from '@kernlang/agon-kernel';
import type { EngineAdapter } from '@kernlang/agon-support-engine-runtime';
import { guardEngineAdapter } from '@kernlang/agon-support-engine-runtime';
import { createTeamBrainstormRuntime } from './runtime.js';
import type { TeamBrainstormConfig, TeamBrainstormEffects, TeamBrainstormOptions, TeamBrainstormRegistry } from './runtime.js';

export type TeamBrainstormInvocationOptions = Omit<TeamBrainstormOptions, 'registry' | 'adapter' | 'signal'>;

export interface TeamBrainstormHostServices {
  open(context: InvocationContext): {
    assertCurrent(): void;
    run(options: TeamBrainstormInvocationOptions): Promise<TeamMatchResult>;
  };
}

export interface TeamBrainstormModServices extends ModServices {
  readonly teamBrainstorm?: TeamBrainstormHostServices;
}

export interface TeamBrainstormHostEffects<Registry extends TeamBrainstormRegistry, Config extends TeamBrainstormConfig>
  extends TeamBrainstormEffects<Registry, Config> {
  openRegistry(cwd: string): Registry;
  createAdapter(registry: Registry): EngineAdapter;
  captureAuthority(): () => void;
}

/** Bind host effects per invocation. Construction reads no configuration or registry. */
export function createTeamBrainstormHostServices<Registry extends TeamBrainstormRegistry, Config extends TeamBrainstormConfig>(
  effects: TeamBrainstormHostEffects<Registry, Config>,
): TeamBrainstormHostServices {
  return {
    open(context) {
      context.signal.throwIfAborted();
      const assertCurrent = effects.captureAuthority();
      const check = () => { context.signal.throwIfAborted(); assertCurrent(); };
      check();
      const registry = effects.openRegistry(context.cwd);
      const adapter = guardEngineAdapter(effects.createAdapter(registry), check);
      const guardedAdapter: EngineAdapter = {
        ...adapter,
        dispatch: async options => {
          const result = await adapter.dispatch(options);
          check();
          return result;
        },
      };
      const runtime = createTeamBrainstormRuntime({
        ...effects,
        loadConfig: () => { check(); return effects.loadConfig(context.cwd); },
        readRatings: () => { check(); return effects.readRatings(); },
        loadConfidenceFloor: taskClass => { check(); return effects.loadConfidenceFloor(taskClass); },
        updateTeamElo: (result, k) => { check(); effects.updateTeamElo(result, k); },
      });
      return {
        assertCurrent: check,
        async run(options) {
          check();
          const result = await runtime.runTeamBrainstorm({
            ...options, registry, adapter: guardedAdapter, signal: context.signal,
            onEvent: event => { check(); options.onEvent?.(event); },
          });
          check();
          return result;
        },
      };
    },
  };
}
