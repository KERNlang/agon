/**
 * Subflow param BINDING: what happens to a subflow's promoted input node when
 * the parent feeds that param by edge instead of by form.
 *
 * The input node disappears and every consumer — inside the subflow, and in
 * the PARENT if a flow output transits it — is re-pointed at the parent's
 * source port. Refs are resolved before the deletion happens, so the rewiring
 * is expressed as a map the caller replays over its own already-resolved refs.
 */
import type { FlatEdge, FlatRef, FlattenOutput } from './flatten.js';

export interface ParamBinding {
  subflowNodeId: string;
  childKey: string;
  source: FlatRef;
}

/**
 * `stepId` + out-port of a promoted input node that an edge binding deleted.
 * `*` stands for "every port of that step" (used when the input node itself
 * could not be found, so its source port is unknown).
 */
type RewireMap = Map<string, FlatRef>;

function rewireKey(stepId: string, port: string | undefined): string {
  return `${stepId}\u0000${port ?? '*'}`;
}

function lookupRewire(rewires: RewireMap, ref: FlatRef): FlatRef | undefined {
  return rewires.get(rewireKey(ref.stepId, ref.port)) ?? rewires.get(rewireKey(ref.stepId, undefined));
}

/**
 * A binding source may itself be a port of a step that ANOTHER binding at this
 * level deletes (subflow A fed from subflow B's output, where B's output
 * transits B's own edge-bound input node). Chase every target to its final
 * live port before anything is rewritten; a cycle is left untouched and caught
 * by the dangling-edge invariant instead of looping forever.
 */
function collapseRewireChains(rewires: RewireMap): void {
  for (const [key, target] of rewires) {
    let current = target;
    const seen = new Set<string>([key]);
    for (;;) {
      const next = lookupRewire(rewires, current);
      if (!next) break;
      const nextKey = rewireKey(current.stepId, current.port);
      if (seen.has(nextKey)) return;
      seen.add(nextKey);
      current = next;
    }
    rewires.set(key, current);
  }
}

/**
 * Rewires a subflow's inner graph for every param that the parent supplies by
 * EDGE: the promoted input node disappears and its consumers read straight
 * from the parent's source port. The param stops being a form param.
 *
 * Returns the rewire map so the CALLER can fix up its own already-resolved
 * refs — a parent edge or output that reads a subflow output which transits a
 * promoted input node captured that inner step id before it was deleted, and
 * would otherwise stay dangling in an `ok:true` DAG.
 */
export function applyBindings(bindings: ParamBinding[], children: Map<string, FlattenOutput>): RewireMap {
  const rewires: RewireMap = new Map();
  for (const binding of bindings) {
    const child = children.get(binding.subflowNodeId);
    if (!child) continue;
    const index = child.params.findIndex(
      (param) => param.key === binding.childKey && param.source === 'promoted',
    );
    if (index === -1) continue;
    const [entry] = child.params.splice(index, 1);
    if (entry.stepId === undefined) continue;
    const inputNode = child.nodes.find((node) => node.id === entry.stepId);
    const sourcePort = inputNode?.descriptor.inputSource?.port;
    child.nodes = child.nodes.filter((node) => node.id !== entry.stepId);
    rewires.set(rewireKey(entry.stepId, sourcePort), { ...binding.source });
  }
  if (rewires.size === 0) return rewires;

  collapseRewireChains(rewires);
  for (const child of children.values()) {
    rewriteRefs(child.edges, child.outputs, rewires);
  }
  return rewires;
}

/** Points every edge source and output ref at its post-binding live port. */
export function rewriteRefs(edges: FlatEdge[], outputs: Map<string, FlatRef>, rewires: RewireMap): void {
  if (rewires.size === 0) return;
  for (const edge of edges) {
    const target = lookupRewire(rewires, edge.from);
    if (target) edge.from = { ...target };
  }
  for (const [name, ref] of outputs) {
    const target = lookupRewire(rewires, ref);
    if (target) outputs.set(name, { ...target });
  }
}
