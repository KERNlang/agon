import type { ApiConfig, DispatchOptions, EngineDefinition, EngineRegistry } from '@kernlang/agon-core';

import { spawnWithTimeout } from '@kernlang/agon-core';

import { hasEnvVar, resolveModel } from './adapter-helpers.js';

import { planEngineExecution } from './execution-plan.js';

import type { ExecutionBackend } from './execution-plan.js';

const VERSION_TIMEOUT_MS = 5000;

const cliVersions = new Map<string, Promise<string | null>>();

function cliVersion(binaryPath: string, args: string[], timeoutMs: number): Promise<string | null> {
  const key = [binaryPath, ...args].join('\0');
  let version = cliVersions.get(key);
  if (!version) {
    version = spawnWithTimeout({ command: binaryPath, args, cwd: process.cwd(), timeout: timeoutMs })
      .then((result) => (result.exitCode === 0 && !result.timedOut ? result.stdout.trim() || null : null))
      .catch(() => null);
    cliVersions.set(key, version);
  }
  return version;
}

/**
 * The model identity an engine runs under on the backend a dispatch uses: the resolveModel result for a CLI engine with a model block, `cli:<version>` for one without (versionCmd output, fetched once per process with a 5 s timeout), `api:<model>` for the API backend, null when it cannot be resolved. Never rejects.
 */
export async function resolveEngineIdentity(def: EngineDefinition, cwd: string | undefined, execution: { backend: ExecutionBackend; binaryPath: string | null; apiConfig?: ApiConfig }, opts?: { versionTimeoutMs?: number }): Promise<string | null> {
  try {
    if (execution.backend === 'api') return execution.apiConfig?.model ? `api:${execution.apiConfig.model}` : null;
    if (execution.backend !== 'cli') return null;
    if (def.model) return resolveModel(def, cwd);
    if (!execution.binaryPath || !def.versionCmd?.length) return null;
    const version = await cliVersion(execution.binaryPath, def.versionCmd, opts?.versionTimeoutMs ?? VERSION_TIMEOUT_MS);
    return version ? `cli:${version}` : null;
  } catch {
    return null;
  }
}

/**
 * Identity for the backend CliAdapter would dispatch this engine on right now — the same planEngineExecution inputs its dispatch methods use.
 */
export function identifyEngine(registry: EngineRegistry, engine: EngineDefinition, cwd?: string): Promise<string | null> {
  try {
    const binaryPath = engine.binary ? registry.findBinary(engine) : null;
    const apiKeyAvailable = !!(engine.api && hasEnvVar(engine.api.apiKeyEnv));
    const apiModel = !binaryPath && apiKeyAvailable ? resolveModel(engine, cwd) : null;
    const execution = planEngineExecution({ engine, cwd: cwd ?? process.cwd(), prompt: '', mode: 'exec', timeout: 0, outputDir: '' }, binaryPath, apiKeyAvailable, apiModel);
    return resolveEngineIdentity(engine, cwd, execution);
  } catch {
    return Promise.resolve(null);
  }
}

/**
 * Wrap a dispatch method so its result carries the model identity of the backend it ran on. Identity resolution starts alongside the dispatch, so it adds no latency to a dispatch that takes longer than the version probe.
 */
export function withDispatchIdentity<T>(dispatch: (options: DispatchOptions) => Promise<T>, identify: (engine: EngineDefinition, cwd?: string) => Promise<string | null>): (options: DispatchOptions) => Promise<T & { identity: string | null }> {
  return async (options) => {
    const identity = identify(options.engine, options.cwd);
    const result = await dispatch(options);
    return { ...result, identity: await identity };
  };
}
