/** Resolve an explicit Review panel without applying default roster exclusions. */
export function resolveExplicitReviewEngines<Config, Engine>(
  requested: readonly string[],
  registry: {
    partitionRoster(ids: string[], config: Config): { active: string[]; removed: string[] };
    get(id: string): Engine;
    isAvailable(engine: Engine): boolean;
  },
  config: Config,
): string[] {
  const raw = requested.map(id => String(id ?? '').trim());
  if (!raw.length || raw.some(id => !id)) {
    throw new Error('An explicit Review engine list cannot be empty. Omit --engine/--engines to use the full active panel.');
  }
  const partition = registry.partitionRoster(raw, config);
  if (partition.removed.length) {
    throw new Error(`Review engine${partition.removed.length === 1 ? '' : 's'} removed by configuration: ${partition.removed.join(', ')}`);
  }
  const selected: string[] = [];
  for (const id of partition.active) {
    let engine: Engine;
    try { engine = registry.get(id); }
    catch { throw new Error(`Unknown Review engine: ${id}`); }
    if (!registry.isAvailable(engine)) throw new Error(`Review engine is not available: ${id}`);
    if (!selected.includes(id)) selected.push(id);
  }
  if (!selected.length) throw new Error('No usable engines remained in the explicit Review panel.');
  return selected;
}
