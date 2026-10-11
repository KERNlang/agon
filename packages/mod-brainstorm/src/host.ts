import type { Awaitable, InvocationContext, ModServices } from '@kernlang/agon-mod-api';
import type { BrainstormRuntimeServices } from './runtime.js';
import type { BrainstormWorkflowOptions } from './workflow.js';
import type { EngineAdapter, TaskClass } from '@kernlang/agon-support-engine-runtime';
import { dispatchSeatWithRetry, preflightHealthFilter } from '@kernlang/agon-support-panel';
import type { PanelEngineRegistry, PanelHealthRuntime } from '@kernlang/agon-support-panel';
import { dedupBrainstormDrafts } from '@kernlang/agon-support-dedup';
import { createSidechainLogger } from '@kernlang/agon-kernel';

export type BrainstormWorkflowEvent = Parameters<NonNullable<BrainstormWorkflowOptions['onEvent']>>[0];
export interface BrainstormInvocationContext extends InvocationContext {
  readonly onWorkflowEvent?: (event: BrainstormWorkflowEvent) => void;
}

/** Bundled host integration only; no workflow implementation is supplied here. */
export interface BrainstormHostServices {
  open(context: InvocationContext): Awaitable<BrainstormRuntimeServices<BrainstormWorkflowOptions>>;
  /** Optional terminal sink. Used only by the CLI contribution, never MCP/TUI. */
  writeCliOutput?(text: string): void;
}

export interface BrainstormModServices extends ModServices {
  readonly brainstorm?: BrainstormHostServices;
}

/** Effects supplied by the host; dispatch policy belongs to this mod. */
export interface BrainstormHostEffects<Registry extends PanelEngineRegistry>
  extends Pick<BrainstormRuntimeServices<BrainstormWorkflowOptions>, 'readRatings' | 'buildPrompt' | 'parseDraft'> {
  openRegistry(cwd: string): Registry;
  createAdapter(registry: Registry): EngineAdapter;
  seedRegistry(registry: Registry): void;
  loadConfig: PanelHealthRuntime['loadConfig'];
  classifyTask(question: string): TaskClass;
  updateRanked(ranked: Array<{ engineId: string; score: number }>, taskClass: TaskClass, mode: 'brainstorm'): void;
}

/** Open per-invocation effects lazily. Construction starts no provider work. */
export function createBrainstormHostServices<Registry extends PanelEngineRegistry>(
  effects: BrainstormHostEffects<Registry>,
): BrainstormHostServices {
  return {
    open(context) {
      const registry = effects.openRegistry(context.cwd);
      const adapter = effects.createAdapter(registry);
      return {
        readRatings: effects.readRatings,
        buildPrompt: effects.buildPrompt,
        parseDraft: effects.parseDraft,
        seed: () => { effects.seedRegistry(registry); },
        preflight: options => preflightHealthFilter({
          engineIds: options.engines, registry, adapter, signal: context.signal,
          runtime: { loadConfig: () => effects.loadConfig(context.cwd) },
        }),
        createLogger: createSidechainLogger,
        deduplicate: dedupBrainstormDrafts,
        updateRatings: (bids, question) => effects.updateRanked(
          bids.map(bid => ({ engineId: bid.engineId, score: bid.score ?? 0 })),
          effects.classifyTask(question), 'brainstorm',
        ),
        selectSeat: (options, engineId) => {
          const engine = registry.get(engineId);
          return (prompt, systemPrompt) => dispatchSeatWithRetry(adapter, {
            engineId, engine, prompt, systemPrompt, textOnly: true,
            cwd: context.cwd, mode: 'exec', timeout: options.timeout,
            outputDir: options.outputDir, signal: context.signal,
          });
        },
        selectWinner: (options, engineId) => {
          const engine = registry.get(engineId);
          return prompt => adapter.dispatch({
            engine, prompt, textOnly: true,
            systemPrompt: 'You are expanding on a winning brainstorm approach. Respond directly with your detailed analysis as plain text. Do NOT use tools, read files, or run commands.',
            cwd: context.cwd, mode: 'exec', timeout: options.timeout,
            outputDir: options.outputDir, signal: context.signal,
          });
        },
      };
    },
  };
}
