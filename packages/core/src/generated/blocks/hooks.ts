// @kern-source: hooks:1
import { execSync } from 'node:child_process';

// @kern-source: hooks:2
import { loadConfig } from '../signals/config.js';

// @kern-source: hooks:4
export type HookEvent = 'pre_dispatch' | 'post_dispatch' | 'pre_forge' | 'post_forge' | 'pre_brainstorm' | 'post_brainstorm' | 'pre_tribunal' | 'post_tribunal' | 'session_start' | 'session_end';

// @kern-source: hooks:6
export interface HookDef {
  command: string;
  engines?: string[];
  timeout?: number;
}

// @kern-source: hooks:11
export interface HookResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

// @kern-source: hooks:17
export function runHook(hook: HookDef, env: Record<string,string>): HookResult {
  const timeout = (hook.timeout ?? 10) * 1000;
  try {
    const stdout = execSync(hook.command, {
      env: { ...process.env, ...env },
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    return { ok: true, stdout: stdout ?? '', stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      ok: err.status === 0,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      exitCode: err.status ?? 1,
    };
  }
}

// @kern-source: hooks:39
export const _hooksConfigCache: {config:any, cwd:string, ts:number}|null = null as {config:any, cwd:string, ts:number}|null;

// @kern-source: hooks:42
function _cachedConfig(): any {
  const cwd = process.cwd();
  const now = Date.now();
  if (_hooksConfigCache && _hooksConfigCache.cwd === cwd && (now - _hooksConfigCache.ts) < 60_000) {
    return _hooksConfigCache.config;
  }
  const config = loadConfig(cwd);
  (_hooksConfigCache as any) = { config, cwd, ts: now };
  return config;
}

// @kern-source: hooks:54
export function runHooks(event: HookEvent, env?: Record<string,string>): HookResult[] {
  const config = _cachedConfig();
  const hooks = (config as any).hooks as Record<string, HookDef[]> | undefined;
  if (!hooks || !hooks[event]) return [];
  
  const defs = hooks[event];
  const engineId = env?.AGON_ENGINE ?? '';
  const results: HookResult[] = [];
  
  for (const hook of defs) {
    // Filter by engine if specified
    if (hook.engines && hook.engines.length > 0 && engineId) {
      if (!hook.engines.includes(engineId)) continue;
    }
  
    const hookEnv: Record<string, string> = {
      AGON_HOOK_EVENT: event,
      AGON_CWD: process.cwd(),
      ...env ?? {},
    };
  
    const result = runHook(hook, hookEnv);
    results.push(result);
  
    // If a pre-hook fails, stop processing remaining hooks
    if (!result.ok && event.startsWith('pre_')) {
      break;
    }
  }
  
  return results;
}

// @kern-source: hooks:88
export function hooksFailed(results: HookResult[]): boolean {
  return results.some((r) => !r.ok);
}

// @kern-source: hooks:93
export function hooksOutput(results: HookResult[]): string {
  return results
    .filter((r) => r.stdout.trim())
    .map((r) => r.stdout.trim())
    .join('\n');
}

