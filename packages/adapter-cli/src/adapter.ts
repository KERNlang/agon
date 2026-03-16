// ── CliAdapter — thin class wrapper around KERN-generated helpers ────
// Pure logic lives in: src/kern/adapter-helpers.kern
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  EngineAdapter,
  EngineDefinition,
  DispatchOptions,
  DispatchResult,
} from '@agon/core';
import { EngineRegistry, spawnWithTimeout, spawnStream, EngineNotFoundError } from '@agon/core';
import { buildCommand, checkEnvVars } from './generated/adapter-helpers.js';

export class CliAdapter implements EngineAdapter {
  private readonly registry: EngineRegistry;

  constructor(registry: EngineRegistry) {
    this.registry = registry;
  }

  async dispatch(options: DispatchOptions): Promise<DispatchResult> {
    const binaryPath = this.registry.findBinary(options.engine);
    if (!binaryPath) {
      throw new EngineNotFoundError(options.engine.id, options.engine.installHint);
    }

    const envError = checkEnvVars(options.engine);
    if (envError) {
      throw new EngineNotFoundError(options.engine.id, envError);
    }

    const { command, args } = buildCommand(
      options.engine, options.mode, options.prompt,
      options.cwd, options.timeout, binaryPath,
    );

    const result = await spawnWithTimeout({
      command, args,
      cwd: options.cwd,
      timeout: options.timeout * 1000,
      signal: options.signal,
    });

    const outputPath = join(options.outputDir, `${options.engine.id}-output.txt`);
    writeFileSync(outputPath, result.stdout);

    return result;
  }

  async *dispatchStream(options: DispatchOptions): AsyncGenerator<string, DispatchResult, void> {
    const binaryPath = this.registry.findBinary(options.engine);
    if (!binaryPath) {
      throw new EngineNotFoundError(options.engine.id, options.engine.installHint);
    }

    const { command, args } = buildCommand(
      options.engine, options.mode, options.prompt,
      options.cwd, options.timeout, binaryPath,
    );

    const gen = spawnStream({
      command, args,
      cwd: options.cwd,
      timeout: options.timeout * 1000,
      signal: options.signal,
    });

    let result: DispatchResult;
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        result = value;
        break;
      }
      yield value;
    }

    const outputPath = join(options.outputDir, `${options.engine.id}-output.txt`);
    writeFileSync(outputPath, result.stdout);

    return result;
  }

  async isAvailable(engine: EngineDefinition): Promise<boolean> {
    return this.registry.isAvailable(engine);
  }

  async getVersion(engine: EngineDefinition): Promise<string | null> {
    const binaryPath = this.registry.findBinary(engine);
    if (!binaryPath) return null;

    try {
      const result = await spawnWithTimeout({
        command: binaryPath,
        args: engine.versionCmd,
        cwd: process.cwd(),
        timeout: 5000,
      });
      return result.stdout.trim() || null;
    } catch {
      return null;
    }
  }
}
