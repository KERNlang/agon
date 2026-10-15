import type { InvocationContext, Json, ModServices } from '../../packages/mod-api/src/index.js';
import type { ForgeModServices } from '../../packages/mod-forge/src/index.js';
import { EngineRegistry, createForgeWorkflowEffects } from '@kernlang/agon-core';
import type { DispatchOptions, DispatchResult, EngineDefinition } from '@kernlang/agon-support-engine-runtime';
import { cliRunRecordHost } from '../../packages/cli/src/run-record-host.js';

/** Use real Forge effects with the fixture's provider transport. */
export function withForgeHost(services: ModServices, healthCheckEnabled = false): ForgeModServices {
  return {
    ...services,
    runs: services.runs ?? cliRunRecordHost,
    forge: {
      async open(context: InvocationContext) {
        context.signal.throwIfAborted();
        const registry = new EngineRegistry();
        for (const id of await services.engines.listActive?.(context) ?? []) {
          registry.register({ id, schemaVersion: 3, displayName: id, binary: 'sh',
            tier: 'user', isLocal: true, timeout: 30, exec: { args: [] }, review: { args: [] },
            agent: { args: [] },
          } as EngineDefinition);
        }
        const dispatch = async (options: DispatchOptions): Promise<DispatchResult> => {
          context.signal.throwIfAborted();
          options.signal?.throwIfAborted();
          const raw = await services.engines.dispatch(options.engine.id, options.prompt,
            { ...context, cwd: options.cwd, signal: options.signal ?? context.signal },
            { mode: options.mode, timeoutSeconds: options.timeout, systemPrompt: options.systemPrompt }) as Record<string, Json>;
          return { exitCode: Number(raw.exitCode ?? 0), stdout: String(raw.stdout ?? ''), stderr: String(raw.stderr ?? ''),
            durationMs: Number(raw.durationMs ?? 0), timedOut: raw.timedOut === true };
        };
        const effects = createForgeWorkflowEffects();
        return {
          registry,
          effects: { ...effects, seedNewEnginesFromRegistry: () => {},
            loadConfig: cwd => ({ ...effects.loadConfig(cwd), ratingsEnabled: false, forgeEnableSynthesis: false,
              forgeHealthCheckEnabled: healthCheckEnabled, forgeAutoAcceptScore: 101 }),
          },
          adapter: { dispatch,
            dispatchAgent: async options => {
              const result = await dispatch({ ...options, mode: 'agent' });
              const { worktreeDiff, diffLineCount, diffFileCount } = effects.stages.fitness;
              const diff = worktreeDiff(options.cwd);
              return { ...result, diff, diffLines: diffLineCount(diff), filesChanged: diffFileCount(options.cwd) };
            },
            isAvailable: async () => true, getVersion: async () => 'fixture',
          },
        };
      },
    },
  };
}
