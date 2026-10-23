import type { Awaitable, InvocationContext } from '@kernlang/agon-mod-api';
import { guardEngineAdapter } from '@kernlang/agon-support-engine-runtime';
import type { EngineAdapter, EngineDefinition } from '@kernlang/agon-support-engine-runtime';
import type { FalsifierEffects } from './falsifier.js';
import { createConquerIsolation } from './isolation.js';
import type { ConquerIsolation, ConquerIsolationEffects } from './isolation.js';
import type { ConquerPrDraft } from './pull-request.js';

export interface ConquerInvocationContext extends InvocationContext {
  readonly onWorkflowEvent?: (event: {
    type: string;
    data?: Record<string, unknown>;
  }) => void;
}

export interface ConquerPublicationPolicy {
  readonly protectedPushBranches: readonly string[];
  commitBody(claim: string): string;
  prBody?(body: string): string;
}

export interface ConquerHostServices {
  contextSpine(context: InvocationContext): Promise<string>;
  open(context: InvocationContext): Awaitable<FalsifierEffects & {
    assertCurrent(): void;
    createIsolation(task: string, runId: string, base: string): ConquerIsolation;
    readonly publication?: ConquerPublicationPolicy;
    draftPullRequest?(input: ConquerPrDraft, dispatch: (prompt: string) => Promise<string>): Promise<{ ok: boolean; title: string; body: string }>;
  }>;
}

/** Bind catalog and provider access to the current invocation authority. */
export function createConquerHostServices<Registry extends { get(id: string): EngineDefinition }>(options: {
  openRegistry(cwd: string): Registry;
  createAdapter(registry: Registry): EngineAdapter;
  rankCritics(registry: Registry, engineIds: string[]): ReturnType<FalsifierEffects['rankCritics']>;
  contextSpine(context: InvocationContext): Promise<string>;
  captureAuthority(): () => void;
  worktrees: ConquerIsolationEffects;
  publicationPolicy?(context: InvocationContext): ConquerPublicationPolicy;
  draftPullRequest?(input: ConquerPrDraft, dispatch: (prompt: string) => Promise<string>): Promise<{ ok: boolean; title: string; body: string }>;
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
      const publication = options.publicationPolicy?.(context);
      return {
        assertCurrent,
        ...(publication ? { publication: {
          protectedPushBranches: Object.freeze([...publication.protectedPushBranches]),
          commitBody: (claim: string) => { check(); return publication.commitBody(claim); },
          ...(publication.prBody ? { prBody: (body: string) => { check(); return publication.prBody!(body); } } : {}),
        } } : {}),
        ...(options.draftPullRequest ? { draftPullRequest: async (input: ConquerPrDraft, dispatch: (prompt: string) => Promise<string>) => {
          check();
          const result = await options.draftPullRequest!(input, async prompt => {
            check();
            const response = await dispatch(prompt);
            check();
            return response;
          });
          check();
          return result;
        } } : {}),
        createIsolation: (task, runId, base) => {
          check();
          return createConquerIsolation(task, context.cwd, options.worktrees, runId, base);
        },
        adapter: guardEngineAdapter(options.createAdapter(registry), check),
        getEngine: id => { check(); return registry.get(id); },
        rankCritics: ids => { check(); return options.rankCritics(registry, ids); },
      };
    },
  };
}
