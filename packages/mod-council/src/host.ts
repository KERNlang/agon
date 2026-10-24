import type { Awaitable, InvocationContext, ModServices } from '@kernlang/agon-mod-api';
import { guardEngineAdapter } from '@kernlang/agon-support-engine-runtime';
import type { EngineAdapter } from '@kernlang/agon-support-engine-runtime';
import type { PanelEngineRegistry } from '@kernlang/agon-support-panel';
import type { CouncilRuntimeEffects } from './runtime.js';
import type { CouncilDisplay } from './presentation.js';

export interface CouncilEngineRegistry extends PanelEngineRegistry {
  listIds(): string[];
  resolveId(id: string): string;
}

export interface CouncilHostSession {
  readonly registry: CouncilEngineRegistry;
  readonly adapter: EngineAdapter;
  readonly activeEngineIds: readonly string[];
  readonly defaultEngineIds: readonly string[];
  readonly removedEngineIds: readonly string[];
  readonly effects: CouncilRuntimeEffects<CouncilEngineRegistry>;
  assertCurrent(): void;
}

export interface CouncilHostServices {
  open(context: InvocationContext): Awaitable<CouncilHostSession>;
  readonly cliOutput?: CouncilDisplay;
}

export interface CouncilModServices extends ModServices {
  readonly council?: CouncilHostServices;
}

export interface CouncilHostEffects<Registry extends CouncilEngineRegistry>
  extends CouncilRuntimeEffects<Registry> {
  openRegistry(cwd: string): Registry;
  createAdapter(registry: Registry): EngineAdapter;
  selectEngines(registry: Registry, cwd: string): {
    activeEngineIds: readonly string[];
    defaultEngineIds: readonly string[];
    removedEngineIds: readonly string[];
  };
  captureAuthority(): () => void;
}

/** Bind Council effects to one invocation and registry generation. */
export function createCouncilHostServices<Registry extends CouncilEngineRegistry>(
  effects: CouncilHostEffects<Registry>,
): CouncilHostServices {
  return {
    open(context) {
      const checkGeneration = effects.captureAuthority();
      const assertCurrent = () => {
        context.signal.throwIfAborted();
        context.assertCurrent?.();
        checkGeneration();
      };
      assertCurrent();
      const registry = effects.openRegistry(context.cwd);
      assertCurrent();
      const selected = effects.selectEngines(registry, context.cwd);
      assertCurrent();
      const adapter = guardEngineAdapter(effects.createAdapter(registry), signal => {
        assertCurrent(); signal?.throwIfAborted();
      });
      assertCurrent();
      return {
        registry, adapter, assertCurrent,
        activeEngineIds: Object.freeze([...selected.activeEngineIds]),
        defaultEngineIds: Object.freeze([...selected.defaultEngineIds]),
        removedEngineIds: Object.freeze([...selected.removedEngineIds]),
        effects: {
          assertCurrent,
          loadConfig: () => {
            assertCurrent();
            const config = effects.loadConfig(context.cwd);
            assertCurrent();
            return config;
          },
          readSeating: (_registry, rank) => {
            assertCurrent();
            const seating = effects.readSeating(registry, rank);
            assertCurrent();
            return {
              pick: (ids, modes) => {
                assertCurrent();
                const picked = seating.pick(ids, modes);
                assertCurrent();
                return picked;
              },
              rank: ids => {
                assertCurrent();
                const ranked = seating.rank(ids);
                assertCurrent();
                return ranked;
              },
            };
          },
          readJudging: () => {
            assertCurrent();
            const judging = effects.readJudging?.();
            assertCurrent();
            if (!judging) return undefined;
            return {
              ...judging,
              score: options => { assertCurrent(); const scores = judging.score(options); assertCurrent(); return scores; },
            };
          },
          recordRatings: (question, ranked, identities) => { assertCurrent(); effects.recordRatings(question, ranked, identities); assertCurrent(); },
          warn: message => { assertCurrent(); effects.warn(message); assertCurrent(); },
        },
      };
    },
  };
}
