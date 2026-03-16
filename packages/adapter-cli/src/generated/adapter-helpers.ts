import type { EngineDefinition, EngineMode } from '@agon/core';

import { EngineNotFoundError } from '@agon/core';

export function resolveArgs(template: string[], vars: Record<string, string>): string[] {
  return template.map((arg) =>
    arg.replace(/\{(\w+)\}/g, (_: string, key: string) => vars[key] ?? ''),
  );
  
}

export function resolveModel(engine: EngineDefinition): string|null {
  const modelConfig = engine.model;
  if (!modelConfig) return null;
  
  if (modelConfig.configKey) {
    const envVal = process.env[modelConfig.configKey.toUpperCase()];
    if (envVal) return envVal;
  }
  
  return modelConfig.default ?? null;
  
}

export function buildCommand(engine: EngineDefinition, mode: EngineMode, prompt: string, cwd: string, timeout: number, binaryPath: string): {command:string, args:string[]} {
  const modeConfig = mode === 'exec' ? engine.exec : engine.review;
  
  if (!modeConfig) {
    throw new EngineNotFoundError(
      engine.id,
      `Engine "${engine.id}" does not support mode "${mode}"`,
    );
  }
  
  const model = resolveModel(engine);
  
  const vars: Record<string, string> = {
    prompt,
    cwd,
    timeout: String(timeout),
    model: model ?? '',
  };
  
  const args = resolveArgs(modeConfig.args, vars);
  
  if (model && engine.model?.flag) {
    const promptIdx = args.indexOf(prompt);
    if (promptIdx > 0) {
      args.splice(promptIdx, 0, engine.model.flag, model);
    } else {
      args.unshift(engine.model.flag, model);
    }
  }
  
  return { command: binaryPath, args };
  
}

export function checkEnvVars(engine: EngineDefinition): string|null {
  if (!engine.env) return null;
  for (const [envVar, config] of Object.entries(engine.env)) {
    if (config.required && !process.env[envVar]) {
      return `Missing required environment variable: ${envVar}`;
    }
  }
  return null;
  
}

