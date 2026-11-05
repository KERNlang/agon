import { resolve } from 'node:path';

import type { EngineDefinition } from './types.js';

/**
 * The valid isolation modes — used to validate untrusted input (env var / config / flag) before it reaches the planner. ('bare' — strip project context too — is intentionally not shipped: it needs a worktree overlay to physically remove the repo CLAUDE.md, and is only useful for benchmarks.)
 */
export const ISOLATION_MODES: readonly string[] = ['workspace-pure', 'inherit'] as const;

/**
 * The decided isolation for ONE engine dispatch — consumed by the adapter to shape the spawn (env overrides + extra CLI args) and by provenance.
 */
export interface EngineIsolationPlan {
  isolate: boolean;
  mode: 'workspace-pure'|'inherit';
  engineId: string;
  setEnv: Record<string,string>;
  argsExtra: string[];
  configDir?: string;
  strippedPersonal: boolean;
  setupHint?: string;
}

/**
 * Type-guard for untrusted isolation values (env var, config, CLI flag). Anything not a known mode is rejected so a typo falls through to the next source rather than corrupting dispatch.
 */
export function isValidIsolationMode(v: unknown): boolean {
  return typeof v === 'string' && (ISOLATION_MODES as readonly string[]).includes(v);
}

/**
 * Resolve the effective isolation mode by precedence: explicit per-dispatch option > AGON_ENGINE_ISOLATION env > config.engineIsolation > default 'workspace-pure'. Each source is validated; an invalid value is skipped (not honored, not fatal) so a typo can never silently disable isolation in an unexpected way.
 */
export function resolveIsolationMode(opts: {option?:string, env?:string, config?:string}): 'workspace-pure'|'inherit' {
  const pick = (v: string | undefined): 'workspace-pure' | 'inherit' | null =>
    isValidIsolationMode(v) ? (v as 'workspace-pure' | 'inherit') : null;
  return pick(opts.option) ?? pick(opts.env) ?? pick(opts.config) ?? 'workspace-pure';
}

/**
 * Flags and env that stop an engine CLI executing or trusting the config files of the repository it runs in. Independent of the isolation mode: an inherit dispatch runs in the same hostile repository, so every launch applies this. Declare it with any variadic flag before a single-value flag, so the positional prompt can never be swallowed.
 */
export function planRepoConfigGuard(engine: Pick<EngineDefinition, 'isolationHints'>, cwd?: string): { args: string[]; env: Record<string, string> } {
  const guard = engine.isolationHints?.repoConfigGuard;
  if (!guard) return { args: [], env: {} };
  const dir = resolve(cwd?.trim() ? cwd : process.cwd());
  return { args: guard.args.map((arg) => (arg === '{cwd}' ? dir : arg)), env: { ...guard.env } };
}

/**
 * Decide what to strip for one engine dispatch. PURE: the caller materialises opts.cleanConfigDir and, for a config-dir engine, sets opts.authenticated = whether that clean dir is actually logged in (the adapter checks the engine's authMarker on disk; defaults true so a caller that omits it keeps the legacy 'assume authed' behavior). 'inherit' isolates nothing. An engine with no isolationHints (API-only: kimi/minimax/zai) is already pure. A configEnv engine that is NOT authenticated in its clean dir CANNOT be isolated without breaking auth — fall back to inherit (never break a dispatch) carrying the engine's setupHint. (claude's login is keychain-based and keyed to the DEFAULT config dir, so a redirected CLAUDE_CONFIG_DIR can't borrow it — the clean dir needs its own one-time `claude /login`; codex is file-based so its seeded auth.json doubles as the marker.) Otherwise apply the engine's configEnv (clean config dir) + strictMcpArgs.
 */
export function planEngineIsolation(engine: EngineDefinition, mode: 'workspace-pure'|'inherit', opts: {cleanConfigDir:string, authenticated?:boolean}): EngineIsolationPlan {
  const base = { engineId: engine.id, mode };
  const hints = engine.isolationHints;
  if (mode === 'inherit' || !hints) {
    return { ...base, isolate: false, setEnv: {}, argsExtra: [], strippedPersonal: false };
  }
  // A config-dir engine that isn't authenticated in its clean dir can't be
  // isolated without logging it out — inherit instead, and tell the user how
  // to enable clean dispatch. (authenticated defaults true: callers that
  // pre-seed a file credential or skip the check keep isolating.)
  const authenticated = opts.authenticated ?? true;
  if (hints.configEnv && !authenticated) {
    return { ...base, isolate: false, setEnv: {}, argsExtra: [], strippedPersonal: false, setupHint: hints.setupHint };
  }
  const setEnv: Record<string, string> = hints.configEnv ? { [hints.configEnv]: opts.cleanConfigDir } : {};
  const argsExtra: string[] = hints.strictMcpArgs ? [...hints.strictMcpArgs] : [];
  return {
    ...base,
    isolate: true,
    setEnv,
    argsExtra,
    configDir: hints.configEnv ? opts.cleanConfigDir : undefined,
    strippedPersonal: true,
  };
}
