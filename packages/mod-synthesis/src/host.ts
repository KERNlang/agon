import type { Awaitable, InvocationContext, ModServices } from '@kernlang/agon-mod-api';
import { guardEngineAdapter } from '@kernlang/agon-support-engine-runtime';
import type { EngineAdapter } from '@kernlang/agon-support-engine-runtime';
import type { PanelEngineRegistry, PanelHealthRuntime } from '@kernlang/agon-support-panel';
import type { SynthesisRuntimeEffects } from './runtime.js';
import { synthesisRoutingAdviceForTaskClass } from './routing-policy.js';
import type { SynthesisDisplay, synthesisRunStatus } from './presentation.js';

export interface SynthesisHostSession {
  readonly registry: PanelEngineRegistry;
  readonly adapter: EngineAdapter;
  readonly effects: SynthesisRuntimeEffects;
  assertCurrent(): void;
  showRoutingAdvice?(prompt: string): void;
}

/** Bundled host effects only. The Synthesis mod owns the workflow. */
export interface SynthesisHostServices {
  open(context: InvocationContext): Awaitable<SynthesisHostSession>;
  readonly cliOutput?: SynthesisDisplay & {
    isQuiet(): boolean;
    summary(status: ReturnType<typeof synthesisRunStatus>): void;
  };
}

export interface SynthesisModServices extends ModServices {
  readonly synthesis?: SynthesisHostServices;
}

export interface SynthesisHostEffects<Registry extends PanelEngineRegistry> {
  openRegistry(cwd: string): Registry;
  createAdapter(registry: Registry): EngineAdapter;
  captureAuthority(): () => void;
  loadConfig: PanelHealthRuntime['loadConfig'];
  warn(message: string): void;
  readonly routingAdvice?: {
    classifyTask(prompt: string): string;
    isQuiet(): boolean;
    show(message: string): void;
  };
}

/** Capture authority per invocation, not when the host starts. */
export function createSynthesisHostServices<Registry extends PanelEngineRegistry>(
  effects: SynthesisHostEffects<Registry>,
): SynthesisHostServices {
  return {
    open(context) {
      context.signal.throwIfAborted();
      context.assertCurrent?.();
      const assertAuthority = effects.captureAuthority();
      const assertCurrent = () => {
        context.signal.throwIfAborted();
        context.assertCurrent?.();
        assertAuthority();
      };
      assertCurrent();
      const registry = effects.openRegistry(context.cwd);
      const adapter = guardEngineAdapter(effects.createAdapter(registry), signal => {
        signal?.throwIfAborted();
        assertCurrent();
      });
      assertCurrent();
      return {
        registry,
        adapter,
        assertCurrent,
        ...(effects.routingAdvice ? { showRoutingAdvice(prompt: string) {
          assertCurrent();
          const presentation = effects.routingAdvice!;
          if (presentation.isQuiet()) return;
          const advice = synthesisRoutingAdviceForTaskClass(presentation.classifyTask(prompt));
          assertCurrent();
          if (advice) presentation.show(advice);
          assertCurrent();
        } } : {}),
        effects: {
          resolveWorkingDir: () => context.cwd,
          health: { loadConfig: () => {
            assertCurrent();
            return effects.loadConfig(context.cwd);
          } },
          warn: effects.warn,
        },
      };
    },
  };
}
