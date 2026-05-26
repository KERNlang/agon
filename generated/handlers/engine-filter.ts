// @kern-source: engine-filter:1
/**
 * Engine ID prefixes that are excluded from default orchestration. Matches the literal id or id starting with `${prefix}-`. Do NOT add families here that have a usable subvariant (e.g. minimax has minimax-coding-plan-* and kimi has kimi-for-coding-*) — use the exact-match list below for those.
 */
export const DEFAULT_EXCLUDED_ORCHESTRATION_ENGINE_PREFIXES: string[] = ['qwen', 'ollama', 'opencode', 'open-code'];

// @kern-source: engine-filter:4
/**
 * Engine IDs that are excluded from default orchestration ONLY when matched exactly. Vanilla 'kimi' and 'minimax' have OAuth/key issues and are superseded by 'kimi-for-coding-k2p6' and 'minimax-coding-plan-minimax-m2.7-highspeed' which must stay enabled.
 */
export const DEFAULT_EXCLUDED_ORCHESTRATION_ENGINE_EXACT: string[] = ['kimi', 'minimax', 'mistral'];

// @kern-source: engine-filter:7
export function isDefaultOrchestrationEngineAllowed(engineId: string): boolean {
  const id = String(engineId ?? '').trim().toLowerCase();
  if (!id) {
    return false;
  }
  if (DEFAULT_EXCLUDED_ORCHESTRATION_ENGINE_EXACT.includes(id)) {
    return false;
  }
  return !DEFAULT_EXCLUDED_ORCHESTRATION_ENGINE_PREFIXES.some((prefix) => id === prefix || id.startsWith(`${prefix}-`));
}

// @kern-source: engine-filter:16
export function filterDefaultOrchestrationEngines(engineIds: string[]): string[] {
  const filtered: string[] = [];
  for (const id of engineIds ?? []) {
    if (isDefaultOrchestrationEngineAllowed(id) && !filtered.includes(id)) {
      filtered.push(id);
    }
  }
  return filtered;
}

