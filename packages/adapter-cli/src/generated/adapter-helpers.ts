import type { EngineDefinition, EngineMode, EngineModeConfig, ImageAttachment } from '@agon/core';

import { EngineNotFoundError } from '@agon/core';

import { statSync } from 'node:fs';

export function resolveArgs(template: string[], vars: Record<string,string>): string[] {
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function buildCommand(engine: EngineDefinition, mode: EngineMode, prompt: string, cwd: string, timeout: number, binaryPath: string, images?: ImageAttachment[]): {command:string, args:string[]} {
  const modeConfig = mode === 'agent' ? engine.agent
    : mode === 'exec' ? engine.exec
    : engine.review;
  
  if (!modeConfig) {
    throw new EngineNotFoundError(
      engine.id,
      `Engine "${engine.id}" does not support mode "${mode}"`,
    );
  }
  
  const model = resolveModel(engine);
  
  let effectivePrompt = prompt;
  const hasImages = images && images.length > 0;
  const hasVision = hasImages && engine.capabilities?.includes('vision') && engine.imageFlag;
  
  // Non-vision engines: prepend image info as text
  if (hasImages && !hasVision) {
    const labels = images.map((img) => {
      try {
        const size = statSync(img.path).size;
        return `[Image: ${img.path} (${formatFileSize(size)})]`;
      } catch {
        return `[Image: ${img.path}]`;
      }
    });
    effectivePrompt = labels.join('\n') + '\n\nPlease read and analyze the image(s) above.\n\n' + prompt;
  }
  
  const vars: Record<string, string> = {
    prompt: effectivePrompt,
    cwd,
    timeout: String(timeout),
    model: model ?? '',
  };
  
  const args = resolveArgs(modeConfig.args, vars);
  
  if (model && engine.model?.flag) {
    const promptIdx = args.indexOf(effectivePrompt);
    if (promptIdx >= 0) {
      args.splice(promptIdx, 0, engine.model.flag, model);
    } else {
      args.unshift(engine.model.flag, model);
    }
  }
  
  // Vision engines: inject image flags before prompt
  if (hasVision) {
    const promptIdx = args.indexOf(effectivePrompt);
    const insertAt = promptIdx >= 0 ? promptIdx : args.length;
    const imageArgs: string[] = [];
    for (const img of images) {
      imageArgs.push(engine.imageFlag!, img.path);
    }
    args.splice(insertAt, 0, ...imageArgs);
  }
  
  return { command: binaryPath, args };
}

export function supportsAgentMode(engine: EngineDefinition): boolean {
  return !!engine.agent;
}

export function resolveAgentArgs(engine: EngineDefinition, permissionLevel: 'full'|'plan'|'read-only'): EngineModeConfig|null {
  if (permissionLevel === 'read-only') return null;
  if (!engine.agent) return null;
  if (permissionLevel === 'full') return engine.agent;
  // plan mode: swap vendor-specific flags
  const planArgs = engine.agent.args.map((arg: string) => {
    if (arg === '--dangerously-skip-permissions') return '--permission-mode=plan';
    if (arg === 'yolo') return 'plan';
    if (arg === '--full-auto') return '--full-auto';
    return arg;
  });
  return { args: planArgs };
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

