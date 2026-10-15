import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { resolveEngineDefinitionsDir } from '@kernlang/agon-support-engine-runtime';
import { resolveExplicitReviewEngines } from '@kernlang/agon-support-verification';

import { createCliAdapter } from '@kernlang/agon-adapter-cli';
import { createBrainstormHostServices, createForgeHostServices } from '@kernlang/agon-core';
import { EngineRegistry, createRunDir, getRatings, loadConfig, pickTopRatedEngine, writeRunStatus } from '@kernlang/agon-core';
import type { Json, ModManifest, ModServices } from '@kernlang/agon-mod-api';
import { handleJobToolCall } from './job-tools.js';
import { captureMcpSurfaceAuthority } from './surface-authority.js';

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
    ...(['agon.forge', 'agon.team-forge', 'agon.pipeline-orchestration'].includes(manifest.id) ? { forge: createForgeHostServices(() => {
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
    ...(manifest.id === 'agon.brainstorm' || manifest.id === 'agon.pipeline-orchestration' ? { brainstorm: createBrainstormHostServices(() => {
      const registry = new EngineRegistry(); registry.load(resolveEngineDefinitionsDir()); return registry;
    }, createCliAdapter) } : {}),
    runs: Object.freeze({
      start(mode: string, label: string | undefined) { const startedAt = new Date().toISOString(); const created = createRunDir({ mode, label, announce: false }); return Object.freeze({ id: created.id, path: created.path, mode, startedAt }); },
      finish(handle: { path: string }, status: Json): void { writeRunStatus(handle.path, status as never); },
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
      async rank(engineIds: readonly string[], scopes: readonly ('forge'|'brainstorm'|'tribunal'|'critique')[]): Promise<readonly {engineId:string;reason:'top-rated'|'random'|'none';scope:'forge'|'brainstorm'|'tribunal'|'critique'|'global'|null}[]> {
        const remaining = [...engineIds]; const ranked = []; const ratings = getRatings();
        while (remaining.length) { const picked = pickTopRatedEngine(remaining, ratings, { modes: [...scopes], rng: () => 0 }); if (!picked.engineId) break; ranked.push(picked); remaining.splice(remaining.indexOf(picked.engineId), 1); }
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
        return { engineId: engine.id, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs, timedOut: result.timedOut, outputDir } as Json;
      },
  });
}
