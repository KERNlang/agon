import type { AgonConfig, EngineDefinition } from '@kernlang/agon-core';

import { engineHealth } from '@kernlang/agon-core';

import { seatGrantsWriteAccess } from './mutate-semantic.js';

export type JudgeIneligibility = 'unknown-engine' | 'write-capable' | 'not-text-only';

export interface JudgeRegistry {
  get(id: string): EngineDefinition;
  activeEngines?: (config: Required<AgonConfig>) => EngineDefinition[];
}

const QUARANTINED = new Set(['auth-failed', 'unreachable', 'binary-missing']);

/**
 * Why an engine may not judge a ballot, or null when it may. A ballot carries untrusted participant text, so its judge must be unable to run tools or write. An engine whose exec args grant blanket write/auto-approve is out (the semantic-mutation panel's rule, seatGrantsWriteAccess). So is every engine with a CLI binary: CliAdapter runs it through the claude pty, a companion or a spawned CLI, and none of them enforces textOnly (the pty and the spawned CLI ignore it; a companion only honours textOnlyArgs and falls back to the CLI on failure). An engine without a binary is always dispatched on the API backend, and a judge dispatch sends it no tools. Pure.
 */
export function judgeIneligibility(engine: EngineDefinition | null | undefined): JudgeIneligibility | null {
  if (!engine) return 'unknown-engine';
  if (seatGrantsWriteAccess(engine, 'exec')) return 'write-capable';
  if (engine.binary || !engine.api) return 'not-text-only';
  return null;
}

/**
 * The engines of `allowed` that are active under the config (hidden, removed and not-enabled engines drop out) and not quarantined this session.
 */
export function activeAllowedEngines(registry: JudgeRegistry, config: Required<AgonConfig>, allowed: Iterable<string>): string[] {
  const permitted = new Set(allowed);
  try {
    const active = typeof registry.activeEngines === 'function' ? registry.activeEngines(config) : [];
    return active.map((e) => e.id).filter((id) => permitted.has(id) && !QUARANTINED.has(String(engineHealth.get(id)?.status ?? '')));
  } catch {
    return [];
  }
}

/**
 * A judge-eligibility check over the registry that remembers every engine it turned down and why.
 */
export function judgeEligibilityTracker(registry: JudgeRegistry): { canJudge: (engineId: string) => boolean; ineligible: Record<string, JudgeIneligibility> } {
  const ineligible: Record<string, JudgeIneligibility> = {};
  const canJudge = (engineId: string) => {
    let engine: EngineDefinition | null = null;
    try { engine = registry.get(engineId); } catch { engine = null; }
    const reason = judgeIneligibility(engine);
    if (reason) ineligible[engineId] = reason;
    return reason === null;
  };
  return { canJudge, ineligible };
}
