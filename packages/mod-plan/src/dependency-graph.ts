import type { CesarPlanStep } from './execution-model.js';

/** Shared graph rules for proposals and saved execution records. Iterative DFS
 * keeps deeply nested model output from exhausting the JavaScript call stack. */
export function planGraphError(steps: readonly Pick<CesarPlanStep, 'id' | 'dependsOn'>[]): string | undefined {
  const byId = new Map<string, readonly string[]>();
  for (const step of steps) {
    if (byId.has(step.id)) return `duplicate step ID: ${step.id}`;
    byId.set(step.id, step.dependsOn ?? []);
  }
  for (const [id, dependencies] of byId) {
    for (const dependency of dependencies) {
      if (!byId.has(dependency)) return `step "${id}" depends on unknown step "${dependency}"`;
    }
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  for (const id of byId.keys()) {
    if (visited.has(id)) continue;
    const stack = [{ id, next: 0 }];
    active.add(id);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const dependencies = byId.get(frame.id)!;
      if (frame.next === dependencies.length) {
        stack.pop();
        active.delete(frame.id);
        visited.add(frame.id);
        continue;
      }
      const dependency = dependencies[frame.next++];
      if (active.has(dependency)) return `circular dependency involving step "${dependency}"`;
      if (!visited.has(dependency)) {
        active.add(dependency);
        stack.push({ id: dependency, next: 0 });
      }
    }
  }
  return undefined;
}
