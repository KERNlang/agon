import type { DispatchResult, EngineDefinition } from '../models/types.js';
import { classifyApiFailure } from '../api/failure-classify.js';

export type ModEngineFault = 'timeout' | 'length' | 'empty' | 'rate_limit' | 'auth' | 'error';

export interface ModEngineDescription {
  readonly id: string;
  readonly binary?: string;
  readonly apiBaseUrl?: string;
  readonly backend: 'cli' | 'api';
}

interface BinaryFinder {
  findBinary(engine: EngineDefinition): string | null;
}

interface BinaryResolver extends BinaryFinder {
  get(id: string): EngineDefinition;
}

/**
 * Remove reasoning-scaffolding blocks (<think>/<thinking>/<reasoning>) that reasoning models (MiniMax, DeepSeek, Qwen) emit before their real answer and sometimes leak into persisted output. Strips CLOSED blocks only — the common leak case — using a backreference so the open and close tags must match. Engine-agnostic: apply wherever raw engine output is persisted or parsed so scaffolding never reaches users or a structured-findings parser.
 */
export function stripReasoning(text: string): string {
  const withoutClosed = text.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>\s*/gi, '');
  return withoutClosed
    .replace(/<(think|thinking|reasoning)>(?:(?!<\/(?:think|thinking|reasoning)>)[\s\S])*$/gi, '')
    .trim();
}

/**
 * Strip claude TUI thinking-animation chrome that leaks into pty-captured output. The animation redraws on one line, so ANSI-stripping flattens its frames into a glyph/label/counter soup ('·✢✳✶✻✽…This one needs a moment…Working through it…95%…Review …'). Spinner glyph frames and the input-bar prompt char (❯) are NEVER legitimate content, so they're always removed. The …-terminated spinner labels (claude invents endless ones — 'Cogitating…', 'Untangling some thoughts…' — so enumerating them is hopeless) and the leading token/elapsed counter residue are removed ONLY when glyph frames were present, i.e. proof this is TUI chrome. That glyph-gate means API engines (kimi/zai — no TUI) never have real content touched.
 */
export function stripTuiChrome(text: string): string {
  const hadChrome = /[✢✳✴✵✶✷✸✹✺✻✼✽✾⎿]/.test(text);
  let s = text.replace(/❯/g, '');
  if (hadChrome) {
    s = s.replace(/[·✢✳✴✵✶✷✸✹✺✻✼✽✾⎿]/g, '');
    s = s.replace(/[A-Z][^\n…]{0,40}…/g, '');
    s = s.replace(/^[\s\d%]+/, '');
    s = s.replace(/[ \t]{2,}/g, ' ');
  }
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Resolve the per-dispatch Review output budget. Positive reviewMaxTokens is an explicit user override. Zero/missing means automatic: keep an 8192 floor for CLI engines and honor a larger native api.maxTokens for reasoning-heavy API engines.
 */
export function resolveReviewMaxTokens(config: any, engine: any): number {
  const configured = Number(config?.reviewMaxTokens);
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  const native = Number(engine?.api?.maxTokens);
  return Math.max(8192, Number.isFinite(native) && native > 0 ? Math.floor(native) : 0);
}

export function cleanEngineText(stdout: string): string {
  return stripReasoning(stripTuiChrome(String(stdout ?? '').trim()));
}

export function classifyModEngineFault(result: Pick<DispatchResult, 'exitCode' | 'timedOut' | 'stderr' | 'finishReason'>, cleanedText: string): ModEngineFault | undefined {
  if (result.timedOut || result.exitCode === 124) return 'timeout';
  if (result.finishReason === 'length') return 'length';
  if (result.exitCode === 0) return cleanedText ? undefined : 'empty';
  if (result.exitCode === 2) return 'rate_limit';
  return classifyApiFailure({ message: String(result.stderr ?? '') }).kind;
}

export function modDispatchMaxTokens(mode: string | undefined, requested: number | undefined, config: unknown, engine: EngineDefinition): number | undefined {
  if (requested !== undefined) return requested;
  return mode === 'review' ? resolveReviewMaxTokens(config, engine) : undefined;
}

export function resolveReviewTimeoutSeconds(config: any): number {
  for (const value of [config?.reviewTimeout, config?.agentTimeout]) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) return Math.floor(seconds);
  }
  return 420;
}

export function modDispatchTimeoutSeconds(mode: string | undefined, requested: number | undefined, config: unknown, maxWallSeconds?: number): number | undefined {
  const resolved = requested ?? (mode === 'review' ? resolveReviewTimeoutSeconds(config) : undefined);
  return resolved !== undefined && maxWallSeconds !== undefined ? Math.min(resolved, maxWallSeconds) : resolved;
}

export const DEFAULT_REVIEW_MAX_WALL_SECONDS = 1800;

/**
 * Total wall clock an API review seat may keep streaming past its base timeout. Override with `agon config set --key reviewMaxWallSeconds --value <seconds>`.
 */
export function resolveReviewMaxWallSeconds(config: any): number {
  const seconds = Number(config?.reviewMaxWallSeconds);
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : DEFAULT_REVIEW_MAX_WALL_SECONDS;
}

/**
 * Wall-clock ceiling an API review dispatch may extend to while it keeps streaming. Undefined when extension does not apply: other modes, CLI-spawned or unusable engines, or a ceiling that does not exceed the base timeout.
 */
export function modDispatchCeilingSeconds(mode: string | undefined, backend: 'cli' | 'api' | undefined, baseSeconds: number, config: unknown, requestedMaxSeconds?: number): number | undefined {
  if (mode !== 'review' || backend !== 'api') return undefined;
  const requested = Number(requestedMaxSeconds);
  const configured = resolveReviewMaxWallSeconds(config);
  const ceiling = Number.isFinite(requested) && requested > 0 ? Math.min(configured, Math.floor(requested)) : configured;
  return ceiling > baseSeconds ? ceiling : undefined;
}

export function modEngineBackend(registry: BinaryFinder, engine: EngineDefinition): 'cli' | 'api' | undefined {
  if (engine.binary && registry.findBinary(engine) !== null) return 'cli';
  return engine.api ? 'api' : undefined;
}

const positiveNumber = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value) && value > 0;

export function modDispatchFields(result: DispatchResult, appliedMaxTokens?: number, appliedTimeoutSeconds?: number, appliedCeilingSeconds?: number): { cleanedText: string; finishReason?: string; engineFault?: ModEngineFault; appliedMaxTokens?: number; appliedTimeoutSeconds?: number; appliedCeilingSeconds?: number; extendedSeconds?: number; timeoutKind?: DispatchResult['timeoutKind'] } {
  const cleanedText = cleanEngineText(result.stdout);
  const engineFault = classifyModEngineFault(result, cleanedText);
  return {
    cleanedText,
    ...(result.finishReason ? { finishReason: result.finishReason } : {}),
    ...(engineFault ? { engineFault } : {}),
    ...(positiveNumber(appliedMaxTokens) ? { appliedMaxTokens } : {}),
    ...(positiveNumber(appliedTimeoutSeconds) ? { appliedTimeoutSeconds } : {}),
    ...(positiveNumber(appliedCeilingSeconds) ? { appliedCeilingSeconds } : {}),
    ...(result.extendedSeconds !== undefined && Number.isFinite(result.extendedSeconds) ? { extendedSeconds: result.extendedSeconds } : {}),
    ...(result.timeoutKind ? { timeoutKind: result.timeoutKind } : {}),
  };
}

export function describeModEngines(registry: BinaryResolver, engineIds: readonly string[]): ModEngineDescription[] {
  const described: ModEngineDescription[] = [];
  for (const id of engineIds) {
    let engine: EngineDefinition;
    try { engine = registry.get(id); } catch { continue; }
    const binary = engine.binary ? String(engine.binary) : undefined;
    const apiBaseUrl = engine.api?.baseUrl ? String(engine.api.baseUrl) : undefined;
    described.push({
      id: engine.id,
      ...(binary ? { binary } : {}),
      ...(apiBaseUrl ? { apiBaseUrl } : {}),
      backend: binary && registry.findBinary(engine) !== null ? 'cli' : 'api',
    });
  }
  return described;
}
