import { DEFAULT_AGON_CONFIG } from './agon-config-settings.js';

type ConfigValueKind = 'boolean' | 'number' | 'array' | 'string';

/**
 * Keys `config set` accepts without a DEFAULT_AGON_CONFIG entry. reviewTimeout must stay unset by default or it would shadow its agentTimeout fallback; reviewMaxWallSeconds defaults where it is resolved (resolveReviewMaxWallSeconds).
 */
export const OPTIONAL_CONFIG_KEYS = Object.freeze({
  reviewTimeout: 'number',
  reviewMaxWallSeconds: 'number',
  undoMaxTurns: 'number',
  undoMaxFileBytes: 'number',
  undoMaxTotalBytes: 'number',
  undoMaxAgeHours: 'number',
} as const satisfies Record<string, ConfigValueKind>);

export type OptionalConfigKey = keyof typeof OPTIONAL_CONFIG_KEYS;

export function configValueKind(key: string): ConfigValueKind | undefined {
  if (Object.hasOwn(OPTIONAL_CONFIG_KEYS, key)) return OPTIONAL_CONFIG_KEYS[key as OptionalConfigKey];
  if (!Object.hasOwn(DEFAULT_AGON_CONFIG, key)) return undefined;
  const fallback = (DEFAULT_AGON_CONFIG as Record<string, unknown>)[key];
  if (typeof fallback === 'boolean') return 'boolean';
  if (typeof fallback === 'number') return 'number';
  if (Array.isArray(fallback)) return 'array';
  return 'string';
}

export type ParsedConfigValue = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string };

export function parseConfigSetValue(key: string, raw: string): ParsedConfigValue {
  const kind = configValueKind(key);
  if (kind === undefined) return { ok: false, error: `Unknown key: ${key}` };
  if (kind === 'boolean') {
    const flag = raw.trim().toLowerCase();
    return flag === 'true' || flag === 'false' ? { ok: true, value: flag === 'true' } : { ok: false, error: `Invalid boolean: ${raw} (use true or false)` };
  }
  if (kind === 'array') return { ok: true, value: raw.split(',').map((s) => s.trim()) };
  if (kind === 'string') return { ok: true, value: raw };
  // Number(), not parseInt: float keys (neroExplorationRate 0.2) must not truncate to 0.
  const value = Number(raw);
  return !raw.trim() || !Number.isFinite(value) ? { ok: false, error: `Invalid number: ${raw}` } : { ok: true, value };
}
