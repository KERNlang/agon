import type { EngineAdapter, EngineDefinition } from './types.js';

import type { EngineRegistry } from '../engine-registry.js';

export interface DiscoveryResult {
  id: string;
  displayName: string;
  found: boolean;
  version: string|null;
  envOk: boolean;
  missingEnv: string[];
}

export async function discoverEngines(registry: EngineRegistry, adapter: EngineAdapter): Promise<DiscoveryResult[]> {
  const engines = registry.list();
  
  return Promise.all(
    engines.map(async (engine: EngineDefinition) => {
      const found = registry.isAvailable(engine);
      let version: string | null = null;
      if (found) {
        version = await adapter.getVersion(engine);
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

