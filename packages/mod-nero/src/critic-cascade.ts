import type { RankedEngine } from '@kernlang/agon-mod-api';

/** Keep excluded or previously ranked critics out when a picker resets its pool. */
export function rankCriticCascade(
  engineIds: readonly string[],
  pick: (excluded: string[]) => RankedEngine,
  exclude: readonly string[] = [],
): RankedEngine[] {
  const seen = new Set(exclude);
  const ranked: RankedEngine[] = [];
  for (let index = 0; index < engineIds.length; index++) {
    const selected = pick([...seen]);
    if (!selected.engineId || seen.has(selected.engineId)) break;
    ranked.push(selected);
    seen.add(selected.engineId);
  }
  return ranked;
}
