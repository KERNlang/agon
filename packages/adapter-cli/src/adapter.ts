import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  EngineAdapter,
  EngineDefinition,
  EngineMode,
  DispatchOptions,
  DispatchResult,
} from '@agon/core';
import { EngineRegistry, spawnWithTimeout, EngineNotFoundError } from '@agon/core';

/**
 * Resolve template variables in an args array.
 * Supported: {prompt}, {model}, {cwd}, {timeout}
 */
function resolveArgs(
  template: string[],
  vars: Record<string, string>,
): string[] {
  return template.map((arg) =>
    arg.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? ''),
  );
}

/**
 * Resolve the model for an engine from config or defaults.
 */
function resolveModel(engine: EngineDefinition): string | null {
  const modelConfig = engine.model;
  if (!modelConfig) return null;

  // Check env/config override via configKey
  if (modelConfig.configKey) {
    const envVal = process.env[modelConfig.configKey.toUpperCase()];
    if (envVal) return envVal;
  }

  return modelConfig.default ?? null;
}

/**
 * Build the final command + args from an engine's declarative config.
 */
function buildCommand(
  engine: EngineDefinition,
  mode: EngineMode,
  prompt: string,
  cwd: string,
  timeout: number,
  binaryPath: string,
): { command: string; args: string[] } {
  const modeConfig = mode === 'exec' ? engine.exec : engine.review;

  if (!modeConfig) {
    throw new EngineNotFoundError(
      engine.id,
      `Engine "${engine.id}" does not support mode "${mode}"`,
    );
  }

  const model = resolveModel(engine);

  // Resolve template variables
  const vars: Record<string, string> = {
    prompt,
    cwd,
    timeout: String(timeout),
    model: model ?? '',
  };

  const args = resolveArgs(modeConfig.args, vars);

  // If model has a separate --flag, inject it
  if (model && engine.model?.flag) {
    // Insert model flag before the first arg that contains the resolved prompt
    const promptIdx = args.indexOf(prompt);
    if (promptIdx > 0) {
      args.splice(promptIdx, 0, engine.model.flag, model);
    } else {
      // Prepend after any subcommands (first arg)
      args.unshift(engine.model.flag, model);
    }
  }

  return { command: binaryPath, args };
}

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

    // Check required env vars
    if (options.engine.env) {
      for (const [envVar, config] of Object.entries(options.engine.env)) {
        if (config.required && !process.env[envVar]) {
          throw new EngineNotFoundError(
            options.engine.id,
            `Missing required environment variable: ${envVar}`,
          );
        }
      }
    }

    const { command, args } = buildCommand(
      options.engine,
      options.mode,
      options.prompt,
      options.cwd,
      options.timeout,
      binaryPath,
    );

    const modeConfig = options.mode === 'exec' ? options.engine.exec : options.engine.review;

    const result = await spawnWithTimeout({
      command,
      args,
      cwd: options.cwd,
      timeout: options.timeout * 1000,
    });

    // Write output to file
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
