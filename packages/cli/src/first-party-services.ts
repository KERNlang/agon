import { resolveExplicitReviewEngines } from '@kernlang/agon-support-verification';
import { cliRunRecordHost } from './run-record-host.js';
import { patchApplicationHost } from './patch-application-host.js';
import { planSessionHost } from '@kernlang/agon-mod-plan';
import { EngineRegistry, appendAttribution, appendPrAttribution, buildKernContextSpine, createRunDir, eventLogFlush, getRatings, loadConfig, pickTopRatedEngine, setSessionRoot } from '@kernlang/agon-core';
import { createCliAdapter } from '@kernlang/agon-adapter-cli';
import { createForgeHostServices } from '@kernlang/agon-core';
import { repoRoot, createSessionWorktree, findSessionWorktree, worktreePathFor, rehydrateSessionWorktree } from '@kernlang/agon-core';
import { createGoalHostServices } from '@kernlang/agon-mod-goal';
import { WriterFence } from '@kernlang/agon-kernel';
import { getAgonHome } from '@kernlang/agon-core';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createBrainstormHostServices } from '@kernlang/agon-mod-brainstorm';
import { createConquerHostServices } from '@kernlang/agon-mod-conquer';
import type { PrTextInput } from '@kernlang/agon-mod-forge';
import { rankCriticCascade } from '@kernlang/agon-mod-nero';
import { glicko } from '@kernlang/agon-mod-ratings';
import { EngineRegistry as CatalogEngineRegistry } from '@kernlang/agon-support-engine-catalog';
import { classifyTask } from '@kernlang/agon-support-dedup';
import { buildKernDraftPrompt, parseKernDraft } from '@kernlang/protocol';
import type { Json, ModManifest, ModServices } from '@kernlang/agon-mod-api';
import { resolveBuiltinEnginesDir } from './lib/engines-dir.js';
import { captureProcessSurfaceAuthority, assertProcessSurfaceAvailable } from './surface-authority-runtime.js';
import { filterDefaultOrchestrationEngines } from './handlers/engine-filter.js';
import { buildServeRuntime, recordServeReady, removeServeConnectionFile, resolveServeEngine, writeServeConnectionFile } from './bridge/serve-runtime.js';
import { runChrome } from './commands/chrome.js';
import { runDrive } from './commands/drive.js';
import { runExtInstall, runExtNativeHost } from './commands/ext.js';
import { runBrowserHostInstall, runBrowserHostStatus, runBrowserHostStop, runBrowserHostUninstall } from './commands/browser-host.js';

async function draftFirstPartyPullRequest(input: PrTextInput, dispatch: (prompt: string) => Promise<string>) {
  assertProcessSurfaceAvailable('cli', 'forge');
  const assertCurrent = captureProcessSurfaceAuthority();
  const { runPrText } = await import('@kernlang/agon-mod-forge');
  return runPrText(input, { dispatch: async prompt => {
    assertCurrent();
    assertProcessSurfaceAvailable('cli', 'forge');
    const response = await dispatch(prompt);
    assertCurrent();
    assertProcessSurfaceAvailable('cli', 'forge');
    return response;
  } });
}

export function decorateCliFirstPartyServices(manifest: ModManifest, base: ModServices): ModServices {
  const runs = cliRunRecordHost;
  const workspace = manifest.id === 'agon.worktrees' ? Object.freeze({
    setSessionRoot(path: string): void { setSessionRoot(path); },
  }) : undefined;
  const browser = manifest.id === 'agon.browser' ? Object.freeze({
    async startServe(options: { port?: number; engineId?: string; allowedOrigins: readonly string[] }, context: Parameters<NonNullable<ModServices['browser']>['startServe']>[1]) {
      const engineId = resolveServeEngine(options.engineId, context.cwd);
      const runtime = await buildServeRuntime({ engineId, cwd: context.cwd, allowedOrigins: [...options.allowedOrigins] });
      try {
        const started = await runtime.serve.start(options.port);
        const connectionFile = writeServeConnectionFile(runtime.sessionId, started.url, started.token, runtime.engineId, [...options.allowedOrigins]);
        recordServeReady(runtime.sessionId, runtime.engineId, started.url, [...options.allowedOrigins]);
        let stopped = false;
        return Object.freeze({
          ...started,
          sessionId: runtime.sessionId,
          engineId: runtime.engineId,
          allowedOrigins: Object.freeze([...options.allowedOrigins]),
          connectionFile,
          async stop(): Promise<void> {
            if (stopped) return;
            stopped = true;
            try { await runtime.serve.close(); }
            finally {
              try { await runtime.brain.close(); }
              finally {
                try { eventLogFlush(runtime.sessionId); } catch { /* best effort */ }
                removeServeConnectionFile(runtime.sessionId);
              }
            }
          },
        });
      } catch (error) {
        try { await runtime.serve.close(); } catch { /* best effort */ }
        try { await runtime.brain.close(); } catch { /* best effort */ }
        removeServeConnectionFile(runtime.sessionId);
        throw error;
      }
    },
    async runCommand(action: 'chrome' | 'drive' | 'extension-install' | 'extension-native-host' | 'host-install' | 'host-uninstall' | 'host-status' | 'host-stop', input: Json): Promise<{ exitCode: number }> {
      const args = input as Record<string, Json>;
      const previousExitCode = process.exitCode;
      process.exitCode = undefined;
      try {
        if (action === 'chrome') await runChrome({ task: String(args.task ?? ''), engine: typeof args.engine === 'string' ? args.engine : undefined, autoApprove: args['auto-approve'] === true || args.autoApprove === true });
        else if (action === 'drive') await runDrive({ prompt: String(args.prompt ?? args.task ?? ''), sessionArg: typeof args.session === 'string' ? args.session : undefined, url: typeof args.url === 'string' ? args.url : undefined, token: typeof args.token === 'string' ? args.token : undefined, engine: typeof args.engine === 'string' ? args.engine : undefined, autoApprove: args['auto-approve'] === true || args.autoApprove === true });
        else if (action === 'extension-install') runExtInstall(typeof args.id === 'string' ? args.id : undefined, typeof args.browser === 'string' ? args.browser : undefined);
        else if (action === 'extension-native-host') await runExtNativeHost();
        else if (action === 'host-install') runBrowserHostInstall(typeof args.origin === 'string' ? args.origin : undefined, typeof args.browser === 'string' ? args.browser : undefined);
        else if (action === 'host-uninstall') runBrowserHostUninstall();
        else if (action === 'host-status') runBrowserHostStatus();
        else runBrowserHostStop();
        return { exitCode: typeof process.exitCode === 'number' ? process.exitCode : 0 };
      } finally {
        process.exitCode = previousExitCode;
      }
    },
  }) : undefined;
  const usesBrainstorm = manifest.id === 'agon.brainstorm' || manifest.id === 'agon.pipeline-orchestration' || manifest.id === 'agon.conquer';
  const brainstorm = usesBrainstorm ? {
    ...createBrainstormHostServices<CatalogEngineRegistry>({
      openRegistry: () => {
        const registry = new CatalogEngineRegistry(glicko.getEngineGlickoRating);
        registry.load(resolveBuiltinEnginesDir()); return registry;
      },
      createAdapter: createCliAdapter,
      loadConfig, classifyTask,
      readRatings: glicko.getRatings, seedRegistry: glicko.seedNewEnginesFromRegistry,
      updateRanked: glicko.updateGlickoRanked,
      buildPrompt: buildKernDraftPrompt, parseDraft: parseKernDraft,
      captureAuthority: () => {
        const assertCurrent = captureProcessSurfaceAuthority();
        return () => { assertCurrent(); assertProcessSurfaceAvailable('cli', 'brainstorm'); };
      },
    }),
    ...(manifest.id === 'agon.brainstorm' ? {
      writeCliOutput(text: string): void { process.stdout.write(text); },
    } : {}),
  } : undefined;
  return Object.freeze({ ...base, runs, ...(browser ? { browser } : {}), ...(workspace ? { workspace } : {}),
    ...(brainstorm ? { brainstorm } : {}),
    ...(manifest.id === 'agon.goal' ? { goal: createGoalHostServices({
      draftPullRequest: draftFirstPartyPullRequest,
      formatPullRequestBody: (body, context) => appendPrAttribution(body, loadConfig(context.cwd)),
      acquireWriter: async id => {
        const path = join(getAgonHome(), 'goal-locks', `${createHash('sha256').update(id).digest('hex')}.lock`);
        try { return await WriterFence.acquire(path, `agon.goal:${id}`); }
        catch (error) {
          if ((error as { code?: string }).code !== 'MOD_HOST_BUSY') throw error;
          return WriterFence.recoverStale(path, `agon.goal:${id}`);
        }
      },
      worktrees: { createSessionWorktree, findSessionWorktree, worktreePathFor, rehydrateSessionWorktree },
      captureAuthority: () => {
        const assertCurrent = captureProcessSurfaceAuthority();
        return () => { assertCurrent(); assertProcessSurfaceAvailable('cli', 'goal'); };
      },
    }) } : {}),
    ...(manifest.id === 'agon.conquer' ? { conquer: createConquerHostServices({
      worktrees: { repoRoot, createSessionWorktree },
      publicationPolicy: context => {
        const config = loadConfig(context.cwd);
        return { protectedPushBranches: config.protectedPushBranches,
          commitBody: claim => appendAttribution(claim, config),
          prBody: body => appendPrAttribution(body, config) };
      },
      draftPullRequest: draftFirstPartyPullRequest,
      openRegistry: () => {
        const registry = new EngineRegistry(); registry.load(resolveBuiltinEnginesDir()); return registry;
      },
      createAdapter: createCliAdapter,
      contextSpine: context => buildKernContextSpine(context.cwd),
      rankCritics: (registry, ids) => {
        glicko.seedNewEnginesFromRegistry(registry);
        const ratings = glicko.getRatings();
        return rankCriticCascade(ids, exclude =>
          glicko.pickTopRatedEngine(ids, ratings, { modes: ['critique', 'tribunal'], exclude }));
      },
      captureAuthority: () => {
        const assertCurrent = captureProcessSurfaceAuthority();
        return () => { assertCurrent(); assertProcessSurfaceAvailable('cli', 'conquer'); };
      },
    }) } : {}),
    ...(manifest.id === 'agon.ratings' ? { ratings: {
      protectedEngineIds(context: Parameters<ModServices['engines']['dispatch']>[2]): readonly string[] {
        const registry = new EngineRegistry(); registry.load(resolveBuiltinEnginesDir());
        const config = loadConfig(context.cwd);
        const configured = Array.isArray(config.ratingsPurgeKeepEngines) ? config.ratingsPurgeKeepEngines : [];
        return [...new Set([...registry.listIds(), ...configured])];
      },
    } } : {}),
    ...(manifest.id === 'agon.forge' ? { patchApplication: patchApplicationHost } : {}),
    ...(['agon.forge', 'agon.team-forge', 'agon.pipeline-orchestration'].includes(manifest.id) ? {
      forge: createForgeHostServices(() => {
        const registry = new EngineRegistry(); registry.load(resolveBuiltinEnginesDir()); return registry;
      }, createCliAdapter, () => {
        const assertCurrent = captureProcessSurfaceAuthority();
        return () => { assertCurrent(); assertProcessSurfaceAvailable('cli', 'forge'); };
      }),
    } : {}),
    ...(manifest.id === 'agon.plan' ? { planSession: planSessionHost } : {}), engines: createCliEngineServices() });
}

export function createCliEngineServices(): ModServices['engines'] {
  return Object.freeze({
    async resolveRequested(engineIds: readonly string[], context: Parameters<ModServices['engines']['dispatch']>[2]): Promise<readonly string[]> {
      const registry = new EngineRegistry();
      registry.load(resolveBuiltinEnginesDir());
      return resolveExplicitReviewEngines(engineIds, registry, loadConfig(context.cwd) as never);
    },
    async listActive(context: Parameters<ModServices['engines']['dispatch']>[2]): Promise<readonly string[]> { const registry = new EngineRegistry(); registry.load(resolveBuiltinEnginesDir()); return filterDefaultOrchestrationEngines(registry.activeIds(loadConfig(context.cwd) as never)); },
    async rank(engineIds: readonly string[], scopes: readonly ('forge'|'brainstorm'|'tribunal'|'critique')[]): Promise<readonly {engineId:string;reason:'top-rated'|'random'|'none';scope:'forge'|'brainstorm'|'tribunal'|'critique'|'global'|null}[]> { const remaining=[...engineIds]; const ranked=[]; const ratings=getRatings(); while(remaining.length){ const picked=pickTopRatedEngine(remaining,ratings,{modes:[...scopes],rng:()=>0}); if(!picked.engineId) break; ranked.push(picked); remaining.splice(remaining.indexOf(picked.engineId),1); } return ranked; },
    async dispatch(engineId: string, prompt: string, context: Parameters<ModServices['engines']['dispatch']>[2], options?: Parameters<ModServices['engines']['dispatch']>[3]): Promise<Json> {
      const registry = new EngineRegistry(); registry.load(resolveBuiltinEnginesDir());
      const config = loadConfig(context.cwd); const active = filterDefaultOrchestrationEngines(registry.activeIds(config as never));
      const selected = engineId.trim() || active[0];
      if (!selected) throw Object.assign(new Error('No active engines. Run agon engine list or agon engine add <id>.'), { code: 'NO_ACTIVE_ENGINE' });
      const engine = registry.get(selected); const outputDir = createRunDir({ mode: 'mod-dispatch', announce: false }).path;
      const result = await createCliAdapter(registry).dispatch({ engine, prompt, cwd: context.cwd, mode: options?.mode ?? 'exec', timeout: Math.max(1, options?.timeoutSeconds ?? 120), outputDir, systemPrompt: options?.systemPrompt, textOnly: options?.textOnly, signal: context.signal });
      return { engineId: engine.id, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs, timedOut: result.timedOut, outputDir } as Json;
    },
  });
}
