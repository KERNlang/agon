/**
 * DAG utilities over the flattened graph: incoming-edge grouping, cycle
 * detection (with a readable cycle path for the error message) and a stable
 * topological order.
 */
import type { FlatEdge, FlatNode } from './flatten.js';

export type IncomingIndex = Map<string, Map<string, FlatEdge[]>>;

export function indexIncoming(edges: FlatEdge[]): IncomingIndex {
  const index: IncomingIndex = new Map();
  for (const edge of edges) {
    let byPort = index.get(edge.to.stepId);
    if (!byPort) {
      byPort = new Map();
      index.set(edge.to.stepId, byPort);
    }
    const list = byPort.get(edge.to.port);
    if (list) list.push(edge);
    else byPort.set(edge.to.port, [edge]);
  }
  return index;
}

export interface DanglingEdge {
  edge: FlatEdge;
  end: 'from' | 'to';
  stepId: string;
}

/**
 * Structural invariant: every edge endpoint names a step that is actually in
 * the graph. `topoSort` silently ignores unknown endpoints, so without this
 * check a rewiring bug would ship as an `ok:true` DAG whose step inputs point
 * at nothing (and whose types quietly default to `json`).
 */
export function findDanglingEdges(nodes: FlatNode[], edges: FlatEdge[]): DanglingEdge[] {
  const known = new Set(nodes.map((node) => node.id));
  const dangling: DanglingEdge[] = [];
  for (const edge of edges) {
    if (!known.has(edge.from.stepId)) dangling.push({ edge, end: 'from', stepId: edge.from.stepId });
    if (!known.has(edge.to.stepId)) dangling.push({ edge, end: 'to', stepId: edge.to.stepId });
  }
  return dangling;
}

export interface TopoResult {
  /** Topologically sorted step ids; empty tail when a cycle exists. */
  order: string[];
  /** One representative cycle per strongly-connected knot, as step-id paths. */
  cycles: string[][];
}

export function topoSort(nodes: FlatNode[], edges: FlatEdge[]): TopoResult {
  const ids = nodes.map((node) => node.id);
  const known = new Set(ids);
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of ids) {
    outgoing.set(id, []);
    indegree.set(id, 0);
  }
  for (const edge of edges) {
    if (!known.has(edge.from.stepId) || !known.has(edge.to.stepId)) continue;
    outgoing.get(edge.from.stepId)!.push(edge.to.stepId);
    indegree.set(edge.to.stepId, (indegree.get(edge.to.stepId) ?? 0) + 1);
  }

  // Stable: ready nodes are taken in declaration order.
  const ready = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }

  if (order.length === ids.length) return { order, cycles: [] };

  const stuck = new Set(ids.filter((id) => !order.includes(id)));
  return { order, cycles: findCycles(stuck, outgoing) };
}

function findCycles(stuck: Set<string>, outgoing: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  const walk = (id: string): void => {
    if (onStack.has(id)) {
      const start = stack.indexOf(id);
      if (start !== -1) cycles.push([...stack.slice(start), id]);
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    stack.push(id);
    onStack.add(id);
    for (const next of outgoing.get(id) ?? []) {
      if (stuck.has(next)) walk(next);
    }
    stack.pop();
    onStack.delete(id);
  };

  for (const id of stuck) {
    if (!visited.has(id)) walk(id);
  }
  return cycles;
}
