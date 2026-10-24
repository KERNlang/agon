import type { EngineAdapter, EngineDefinition } from './types.js';

export interface EngineDiscoveryRegistry {
  list(): EngineDefinition[];
  isAvailable(engine: EngineDefinition): boolean;
}

export interface DiscoveryResult {
  id: string;
  displayName: string;
  found: boolean;
  version: string|null;
  envOk: boolean;
  missingEnv: string[];
}

export async function discoverEngines(registry: EngineDiscoveryRegistry, adapter: EngineAdapter): Promise<DiscoveryResult[]> {
  const engines = registry.list();

  return Promise.all(
    engines.map(async (engine: EngineDefinition) => {
      const found = registry.isAvailable(engine);
      let version: string | null = null;
      if (found) {
        try {
          version = await adapter.getVersion(engine);
        } catch (err) {
          console.warn(`[agon] failed to get version for ${engine.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const missingEnv: string[] = [];
      if (engine.env) {
        for (const [envVar, config] of Object.entries(engine.env)) {
          if (config.required && !process.env[envVar]) {
            missingEnv.push(envVar);
          }
        }
      }

      return {
        id: engine.id,
        displayName: engine.displayName,
        found,
        version,
        envOk: missingEnv.length === 0,
        missingEnv,
      };
    }),
  );
}
