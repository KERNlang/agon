import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import type { EngineDefinition } from './types.js';
import { EngineNotFoundError } from './errors.js';

const AGON_ENGINES_DIR = join(homedir(), '.agon', 'engines');

export class EngineRegistry {
  private engines = new Map<string, EngineDefinition>();
  private binaryCache = new Map<string, string | null>();

  /**
   * Load engine definitions from builtin and user directories.
   * User definitions override builtin ones.
   */
  load(builtinDir: string): void {
    this.loadDir(builtinDir, 'builtin');
    if (existsSync(AGON_ENGINES_DIR)) {
      this.loadDir(AGON_ENGINES_DIR, 'user');
    }
  }

  private loadDir(dir: string, tier: 'builtin' | 'user'): void {
    let files: string[];
    try {
      files = readdirSync(dir).filter((f: string) => f.endsWith('.json'));
    } catch {
      return;
    }

    for (const file of files) {
      try {
        const def = JSON.parse(
          readFileSync(join(dir, file), 'utf-8'),
        ) as EngineDefinition;
        def.tier = tier;
        this.engines.set(def.id, def);
      } catch {
        // Skip malformed engine files
      }
    }
  }

  /**
   * Register an engine definition programmatically.
   */
  register(engine: EngineDefinition): void {
    this.engines.set(engine.id, engine);
  }

  /**
   * Get an engine by ID.
   */
  get(id: string): EngineDefinition {
    const engine = this.engines.get(id);
    if (!engine) {
      throw new EngineNotFoundError(id);
    }
    return engine;
  }

  /**
   * List all registered engines.
   */
  list(): EngineDefinition[] {
    return Array.from(this.engines.values());
  }

  /**
   * List IDs of all registered engines.
   */
  listIds(): string[] {
    return Array.from(this.engines.keys());
  }

  /**
   * Find the binary path for an engine.
   * Checks: env override → PATH lookup → searchPaths from definition.
   */
  findBinary(engine: EngineDefinition): string | null {
    if (this.binaryCache.has(engine.id)) {
      return this.binaryCache.get(engine.id) ?? null;
    }

    // 1. Environment variable override
    const envKey = `${engine.id.toUpperCase()}_PATH`;
    const envPath = process.env[envKey];
    if (envPath && existsSync(envPath)) {
      this.binaryCache.set(engine.id, envPath);
      return envPath;
    }

    // 2. Standard PATH lookup
    try {
      const result = execFileSync('which', [engine.binary], {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (result) {
        this.binaryCache.set(engine.id, result);
        return result;
      }
    } catch {
      // not in PATH
    }

    // 3. Search paths from definition
    for (const rawPath of engine.searchPaths) {
      const expanded = rawPath.replace('${HOME}', homedir());
      const fullPath = join(expanded, engine.binary);
      if (existsSync(fullPath)) {
        this.binaryCache.set(engine.id, fullPath);
        return fullPath;
      }
    }

    this.binaryCache.set(engine.id, null);
    return null;
  }

  /**
   * Check if an engine binary is available.
   */
  isAvailable(engine: EngineDefinition): boolean {
    return this.findBinary(engine) !== null;
  }

  /**
   * Check if an engine supports a given mode (exec/review).
   * v2: checks for exec/review config objects.
   * v1 compat: checks modes array.
   */
  supportsMode(engine: EngineDefinition, mode: 'exec' | 'review'): boolean {
    if (mode === 'exec' && engine.exec) return true;
    if (mode === 'review' && engine.review) return true;
    // v1 compat
    return engine.modes?.includes(mode) ?? false;
  }

  /**
   * Get the list of available (installed) engines.
   */
  availableEngines(): EngineDefinition[] {
    return this.list().filter((e) => this.isAvailable(e));
  }

  /**
   * Get available engine IDs.
   */
  availableIds(): string[] {
    return this.availableEngines().map((e) => e.id);
  }

  /**
   * Pick the starter engine based on strategy.
   */
  pickStarter(
    available: string[],
    strategy: 'fixed' | 'rotate',
    preferred?: string,
  ): string {
    if (available.length === 0) {
      throw new EngineNotFoundError('(any)', 'No engines available');
    }

    if (strategy === 'fixed') {
      if (preferred && available.includes(preferred)) {
        return preferred;
      }
      return available[0];
    }

    // Rotate: deterministic based on timestamp
    const index = Math.floor(Date.now() / 1000) % available.length;
    return available[index];
  }
}
