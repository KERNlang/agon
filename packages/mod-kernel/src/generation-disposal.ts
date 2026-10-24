import { DurableHostError } from './host-errors.js';
import type { DisposableOwner } from './durable-host.js';

async function runWithTimeout(disposer: () => void | Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(disposer),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('disposal timeout')), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function disposeGenerationOwners(ownersInDependencyOrder: readonly DisposableOwner[], timeoutMs: number): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('disposal timeout must be positive');
  const positions = new Map(ownersInDependencyOrder.map(({ id }, index) => [id, index]));
  if (positions.size !== ownersInDependencyOrder.length) throw new TypeError('duplicate disposal owner');
  for (const owner of ownersInDependencyOrder) {
    for (const dependency of owner.dependencies) {
      const dependencyPosition = positions.get(dependency);
      if (dependencyPosition === undefined) throw new TypeError('unknown disposal dependency: ' + dependency);
      if (dependencyPosition >= positions.get(owner.id)!) throw new TypeError('owners must be supplied in dependency order');
    }
  }
  const failures: { ownerId: string; message: string }[] = [];
  for (const owner of [...ownersInDependencyOrder].reverse()) {
    for (const disposer of [...owner.disposers].reverse()) {
      try {
        await runWithTimeout(disposer, timeoutMs);
      } catch (error) {
        failures.push({ ownerId: owner.id, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  if (failures.length > 0) {
    throw new DurableHostError('MOD_RESTART_REQUIRED', 'generation disposal failed; process restart required', { failures });
  }
}
