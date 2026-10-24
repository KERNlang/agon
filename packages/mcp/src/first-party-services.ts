import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { resolveEngineDefinitionsDir, resolveCurrentIdentities } from '@kernlang/agon-support-engine-runtime';
import { resolveExplicitReviewEngines } from '@kernlang/agon-support-verification';

import { createCliAdapter } from '@kernlang/agon-adapter-cli';
import { createForgeHostServices } from '@kernlang/agon-core';
import { createBrainstormHostServices } from '@kernlang/agon-mod-brainstorm';
import { createTribunalHostServices } from '@kernlang/agon-mod-tribunal';
import { createCampfireHostServices } from '@kernlang/agon-mod-campfire';
import { createCouncilHostServices } from '@kernlang/agon-mod-council';
import { glicko, ratingJudgingMode, chairRankInstruction, scrubRankLines, stripRankLines, judgeCouncil, judgeTribunalForRating } from '@kernlang/agon-mod-ratings';
import { EngineRegistry as CatalogEngineRegistry, tracker } from '@kernlang/agon-support-engine-catalog';
import { classifyTask } from '@kernlang/agon-support-dedup';
import { buildKernDraftPrompt, parseKernDraft } from '@kernlang/protocol';
import { EngineRegistry, createRunDir, getRatings, loadConfig, pickTopRatedEngine, writeRunStatus } from '@kernlang/agon-core';
import type { Json, ModManifest, ModServices } from '@kernlang/agon-mod-api';
import { handleJobToolCall } from './job-tools.js';
import { captureMcpSurfaceAuthority } from './surface-authority.js';
import { currentInvocationOwnerAvailable } from '@kernlang/agon-kernel';

const excludedExact = new Set(['kimi', 'minimax', 'mistral']);
const excludedPrefixes = ['qwen', 'ollama', 'opencode', 'open-code'];

function orchestrationEngines(ids: readonly string[]): string[] {
  return [...new Set(ids)].filter((raw) => {
    const id = raw.trim().toLowerCase();
    return id && !excludedExact.has(id) && !excludedPrefixes.some((prefix) => id === prefix || id.startsWith(`${prefix}-`));
  });
}

export function decorateMcpFirstPartyServices(manifest: ModManifest, base: ModServices): ModServices {
  return Object.freeze({
    ...base,
    ...(['agon.council', 'agon.conquer'].includes(manifest.id) ? { council: createCouncilHostServices<CatalogEngineRegistry>({
      openRegistry: () => {
        const registry = new CatalogEngineRegistry();
        registry.load(resolveEngineDefinitionsDir()); return registry;
      },
      createAdapter: createCliAdapter, loadConfig, warn: message => console.warn(message),
      selectEngines: (registry, cwd) => {
        const config = loadConfig(cwd);
        const activeEngineIds = registry.activeIds(config);
        return { activeEngineIds, defaultEngineIds: orchestrationEngines(activeEngineIds),
          removedEngineIds: registry.partitionRoster(registry.listIds(), config).removed };
      },
      readJudging: () => currentInvocationOwnerAvailable('agon.ratings') === false ? undefined : {
          mode: ratingJudgingMode, instruction: chairRankInstruction, scrub: scrubRankLines, strip: stripRankLines, score: judgeCouncil,
        },
        readSeating: (registry, rank) => {
        const enabled = currentInvocationOwnerAvailable('agon.ratings') !== false;
        if (enabled) glicko.seedNewEnginesFromRegistry(registry);
        const ratings = enabled ? glicko.getRatings() : {
          global: {}, byMode: { forge: {}, brainstorm: {}, tribunal: {}, critique: {} },
          byTaskClass: {}, engineMeta: {}, lastUpdated: '',
        };
        return {
          pick: (ids, modes) => glicko.pickTopRatedEngine(ids, ratings, {
            modes: modes.filter((mode): mode is 'tribunal' | 'critique' => mode === 'tribunal' || mode === 'critique'), ...rank,
          }),
          rank: ids => glicko.rankEnginesByRating(ids, ratings, undefined, rank),
        };
      },
      recordRatings: (question, ranked, identities) => {
        if (currentInvocationOwnerAvailable('agon.ratings') === false) return;
        const taskClass = classifyTask(question);
        glicko.updateGlickoRanked(ranked, taskClass, 'tribunal', identities);
        glicko.updateGlickoRanked(ranked, taskClass, 'critique');
      },
      captureAuthority: () => captureMcpSurfaceAuthority('council', 'cli'),
    }) } : {}),
    ...(manifest.id === 'agon.campfire' ? { campfire: createCampfireHostServices({
      openRegistry: () => {
        const registry = new CatalogEngineRegistry();
        registry.load(resolveEngineDefinitionsDir()); return registry;
      },
      createAdapter: createCliAdapter, loadConfig, warn: message => console.warn(message),
      captureAuthority: () => captureMcpSurfaceAuthority('Campfire'),
    }) } : {}),
    ...(['agon.forge', 'agon.team-forge', 'agon.pipeline-orchestration', 'agon.goal'].includes(manifest.id) ? { forge: createForgeHostServices(() => {
      const registry = new EngineRegistry(); registry.load(resolveEngineDefinitionsDir()); return registry;
    }, createCliAdapter, () => captureMcpSurfaceAuthority('Forge')) } : {}),
    ...(manifest.id === 'agon.ratings' ? { ratings: {
      protectedEngineIds(context: Parameters<ModServices['engines']['dispatch']>[2]): readonly string[] {
        const registry = new EngineRegistry(); registry.load(resolveEngineDefinitionsDir());
        const config = loadConfig(context.cwd);
        const configured = Array.isArray(config.ratingsPurgeKeepEngines) ? config.ratingsPurgeKeepEngines : [];
        return [...new Set([...registry.listIds(), ...configured])];
      },
    } } : {}),
    ...(manifest.id === 'agon.jobs' ? { jobs: Object.freeze({
      async runTool(name: Parameters<NonNullable<ModServices['jobs']>['runTool']>[0], input: Readonly<Record<string, Json>>, context: Parameters<NonNullable<ModServices['jobs']>['runTool']>[2]) {
        context.signal.throwIfAborted();
        return handleJobToolCall(name, input, context);
      },
    }) } : {}),
    ...(manifest.id === 'agon.brainstorm' || manifest.id === 'agon.pipeline-orchestration' ? { brainstorm: createBrainstormHostServices<CatalogEngineRegistry>({
      openRegistry: () => {
        const registry = new CatalogEngineRegistry((engineId, taskClass) =>
          currentInvocationOwnerAvailable('agon.ratings') === false
            ? undefined : glicko.getEngineGlickoRating(engineId, taskClass));
        registry.load(resolveEngineDefinitionsDir()); return registry;
      },
      createAdapter: createCliAdapter,
      loadConfig, classifyTask,
      readRatings: glicko.getRatings, seedRegistry: glicko.seedNewEnginesFromRegistry,
      updateRanked: glicko.updateGlickoRanked,
      buildPrompt: buildKernDraftPrompt, parseDraft: parseKernDraft,
      captureAuthority: () => captureMcpSurfaceAuthority('Brainstorm'),
    }) } : {}),
    ...(['agon.tribunal', 'agon.conquer', 'agon.pipeline-orchestration'].includes(manifest.id) ? {
      tribunal: createTribunalHostServices<CatalogEngineRegistry>({
        openRegistry: () => {
          const registry = new CatalogEngineRegistry((engineId, taskClass) =>
            currentInvocationOwnerAvailable('agon.ratings') === false
              ? undefined : glicko.getEngineGlickoRating(engineId, taskClass));
          registry.load(resolveEngineDefinitionsDir()); return registry;
        },
        createAdapter: createCliAdapter,
        loadConfig, classifyTask,
        seedRegistry: glicko.seedNewEnginesFromRegistry, updateRanked: glicko.updateGlickoRanked,
        judgeForRating: options => currentInvocationOwnerAvailable('agon.ratings') === false
          ? Promise.resolve([]) : judgeTribunalForRating({ ...options, config: loadConfig(options.cwd) }),
        captureAuthority: () => captureMcpSurfaceAuthority('Tribunal'),
      }),
    } : {}),
    runs: Object.freeze({
      start(mode: string, label: string | undefined) { const startedAt = new Date().toISOString(); const created = createRunDir({ mode, label, announce: false }); return Object.freeze({ id: created.id, path: created.path, mode, startedAt }); },
      finish(handle: { path: string }, status: Json): void {
        if (!writeRunStatus(handle.path, status as never)) {
          throw new Error(`Run status could not be persisted at ${handle.path}. Completed work is retained; inspect staging before retrying.`);
        }
      },
      writeArtifact(handle: { path: string }, relativePath: string, content: string): void {
        const root = resolve(handle.path); const target = resolve(root, relativePath);
        if (target === root || !target.startsWith(root + sep)) throw new Error(`Run artifact escapes its run directory: ${relativePath}`);
        mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content, 'utf8');
      },
    }),
    engines: createMcpEngineServices(),
  });
}

export function createMcpEngineServices(): ModServices['engines'] {
  const registryFor = (cwd: string) => {
    const registry = new EngineRegistry();
    registry.load(resolveEngineDefinitionsDir());
    return { registry, config: loadConfig(cwd) };
  };
  return Object.freeze({
      async resolveRequested(engineIds: readonly string[], context: Parameters<ModServices['engines']['dispatch']>[2]): Promise<readonly string[]> {
        const { registry, config } = registryFor(context.cwd);
        return resolveExplicitReviewEngines(engineIds, registry, config as never);
      },
      async listActive(context: Parameters<ModServices['engines']['dispatch']>[2]): Promise<readonly string[]> {
        const { registry, config } = registryFor(context.cwd);
        return orchestrationEngines(registry.activeIds(config as never));
      },
      async rank(engineIds: readonly string[], scopes: readonly ('forge'|'brainstorm'|'tribunal'|'critique')[], context: Parameters<ModServices['engines']['dispatch']>[2]): Promise<readonly {engineId:string;reason:'top-rated'|'random'|'none';scope:'forge'|'brainstorm'|'tribunal'|'critique'|'global'|null}[]> {
        if (currentInvocationOwnerAvailable('agon.ratings') === false) {
          return engineIds.map(engineId => ({ engineId, reason: 'random' as const, scope: null }));
        }
        context.signal.throwIfAborted();
        const { registry, config } = registryFor(context.cwd);
        const identities = await resolveCurrentIdentities(createCliAdapter(registry), registry, [...engineIds], context.cwd);
        context.signal.throwIfAborted();
        const remaining = [...engineIds]; const ranked = []; const ratings = getRatings();
        while (remaining.length) { const picked = pickTopRatedEngine(remaining, ratings, { modes: [...scopes], rng: () => 0, identities, staleHorizonDays: config.ratingStaleHorizonDays }); if (!picked.engineId) break; ranked.push(picked); remaining.splice(remaining.indexOf(picked.engineId), 1); }
        return ranked;
      },
      async dispatch(engineId: string, prompt: string, context: Parameters<ModServices['engines']['dispatch']>[2], options?: Parameters<ModServices['engines']['dispatch']>[3]): Promise<Json> {
        const { registry, config } = registryFor(context.cwd);
        const selected = engineId.trim() || orchestrationEngines(registry.activeIds(config as never))[0];
        if (!selected) throw Object.assign(new Error('No active engines. Run agon engine list or agon engine add <id>.'), { code: 'NO_ACTIVE_ENGINE' });
        const engine = registry.get(selected);
        const outputDir = createRunDir({ mode: 'mod-mcp-dispatch', announce: false }).path;
        const result = await createCliAdapter(registry).dispatch({
          engine,
          prompt,
          cwd: context.cwd,
          mode: options?.mode ?? 'exec',
          timeout: Math.max(1, options?.timeoutSeconds ?? 120),
          outputDir,
          systemPrompt: options?.systemPrompt,
          textOnly: options?.textOnly,
          signal: context.signal,
        });
        const accounting = result.usage ? tracker.record(engine.id, { usage: result.usage }) : undefined;
        return { engineId: engine.id, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs, timedOut: result.timedOut, outputDir,
          ...(accounting ? { costUsd: accounting.costUsd, costSource: accounting.source } : {}),
          ...(result.usage ? { usage: result.usage } : {}) } as Json;
      },
  });
}
