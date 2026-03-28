import { readdirSync, readFileSync, existsSync } from 'node:fs';

import { join, basename } from 'node:path';

import { homedir } from 'node:os';

import { execFileSync } from 'node:child_process';

import type { EngineDefinition, EngineMode } from './types.js';

import { EngineNotFoundError } from './errors.js';

export const AGON_ENGINES_DIR: string = join(homedir(), '.agon', 'engines');

export class EngineRegistry {
  private engines: Map<string, EngineDefinition> = new Map();
  private binaryCache: Map<string, string | null> = new Map();

  private loadDir(dir: string, tier: 'builtin'|'user'): void {
    if (!existsSync(dir)) {
      console.warn(`[agon] engine directory does not exist: ${dir}`);
      return;
    }
    let files: string[];
    try { files = readdirSync(dir).filter((f: string) => f.endsWith('.json')); }
    catch (err) {
      console.warn(`[agon] failed to read engine directory ${dir}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    for (const file of files) {
      try {
        const def = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as EngineDefinition;
        def.tier = tier;
        this.engines.set(def.id, def);
      } catch (err) {
        console.warn(`[agon] failed to load engine definition ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  load(builtinDir: string): void {
    this.loadDir(builtinDir, 'builtin');
    if (existsSync(AGON_ENGINES_DIR)) this.loadDir(AGON_ENGINES_DIR, 'user');
  }

  register(engine: EngineDefinition): void {
    this.engines.set(engine.id, engine);
  }

  get(id: string): EngineDefinition {
    const engine = this.engines.get(id);
    if (!engine) throw new EngineNotFoundError(id);
    return engine;
  }

  list(): EngineDefinition[] {
    return Array.from(this.engines.values());
  }

  listIds(): string[] {
    return Array.from(this.engines.keys());
  }

  findBinary(engine: EngineDefinition): string|null {
    if (this.binaryCache.has(engine.id)) return this.binaryCache.get(engine.id) ?? null;
    const envKey = `${engine.id.toUpperCase()}_PATH`;
    const envPath = process.env[envKey];
    if (envPath && existsSync(envPath)) { this.binaryCache.set(engine.id, envPath); return envPath; }
    try {
      const result = execFileSync('which', [engine.binary], { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      if (result) { this.binaryCache.set(engine.id, result); return result; }
    } catch {
      // 'which' not finding a binary is expected — no warning needed
    }
    for (const rawPath of engine.searchPaths) {
      const expanded = rawPath.replace('${HOME}', homedir());
      const fullPath = join(expanded, engine.binary);
      if (existsSync(fullPath)) { this.binaryCache.set(engine.id, fullPath); return fullPath; }
    }
    this.binaryCache.set(engine.id, null);
    return null;
  }

  isAvailable(engine: EngineDefinition): boolean {
    if (engine.api) return !!process.env[engine.api.apiKeyEnv];
    return this.findBinary(engine) !== null;
  }

  supportsMode(engine: EngineDefinition, mode: EngineMode): boolean {
    if (mode === 'exec' && engine.exec) return true;
    if (mode === 'review' && engine.review) return true;
    if (mode === 'agent' && engine.agent) return true;
    return engine.modes?.includes(mode) ?? false;
  }

  agentCapableIds(): string[] {
    return this.availableEngines()
      .filter((e: EngineDefinition) => !!e.agent)
      .map((e: EngineDefinition) => e.id);
  }

  availableEngines(): EngineDefinition[] {
    return this.list().filter((e: EngineDefinition) => this.isAvailable(e));
  }

  availableIds(): string[] {
    return this.availableEngines().map((e: EngineDefinition) => e.id);
  }

  pickStarter(available: string[], strategy: 'fixed'|'rotate', preferred?: string): string {
    if (available.length === 0) throw new EngineNotFoundError('(any)', 'No engines available');
    if (strategy === 'fixed') {
      if (preferred && available.includes(preferred)) return preferred;
      return available[0];
    }
    return available[Math.floor(Date.now() / 1000) % available.length];
  }
}

