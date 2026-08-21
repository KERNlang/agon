/**
 * Unit tests for the flattened-graph helpers (`elaborate/graph.ts`).
 *
 * These pin the two half-dangling-edge cases — only the source missing, only
 * the target missing — that a symmetric guard (`&&` instead of `||`) would let
 * through: `findDanglingEdges` must report each one, and `topoSort` must skip
 * such edges instead of crashing or emitting a phantom step in its order.
 */
import { describe, expect, it } from 'vitest';

import { CHAT_INPUT } from '../../packages/flow-core/src/index.js';
import type { FlatEdge, FlatNode } from '../../packages/flow-core/src/elaborate/flatten.js';
import { findDanglingEdges, topoSort } from '../../packages/flow-core/src/elaborate/graph.js';

const FILE = '/flows/main.agon-flow.json';

function flatNode(id: string): FlatNode {
  return {
    id, nodeId: id, path: [], type: CHAT_INPUT.type,
    params: {}, descriptor: CHAT_INPUT, file: FILE,
  };
}

function flatEdge(from: string, to: string): FlatEdge {
  return { from: { stepId: from, port: 'out' }, to: { stepId: to, port: 'in' }, file: FILE };
}

describe('findDanglingEdges', () => {
  const nodes = [flatNode('a'), flatNode('b')];

  it('accepts a graph whose every edge endpoint is a known step', () => {
    expect(findDanglingEdges(nodes, [flatEdge('a', 'b')])).toEqual([]);
  });

  it('reports an edge whose source exists but whose target does not', () => {
    const dangling = findDanglingEdges(nodes, [flatEdge('a', 'b'), flatEdge('b', 'ghost')]);
    expect(dangling).toHaveLength(1);
    expect(dangling[0].end).toBe('to');
    expect(dangling[0].stepId).toBe('ghost');
  });

  it('reports an edge whose target exists but whose source does not', () => {
    const dangling = findDanglingEdges(nodes, [flatEdge('a', 'b'), flatEdge('ghost', 'b')]);
    expect(dangling).toHaveLength(1);
    expect(dangling[0].end).toBe('from');
    expect(dangling[0].stepId).toBe('ghost');
  });

  it('reports both ends when neither endpoint is in the graph', () => {
    const dangling = findDanglingEdges(nodes, [flatEdge('ghost-a', 'ghost-b')]);
    expect(dangling.map((miss) => [miss.end, miss.stepId])).toEqual([
      ['from', 'ghost-a'], ['to', 'ghost-b'],
    ]);
  });
});

describe('topoSort — half-dangling edges', () => {
  const nodes = [flatNode('a'), flatNode('b')];

  it('sorts a clean two-step chain', () => {
    expect(topoSort(nodes, [flatEdge('a', 'b')])).toEqual({ order: ['a', 'b'], cycles: [] });
  });

  it('skips an edge whose target step is unknown (no phantom step in the order)', () => {
    const result = topoSort(nodes, [flatEdge('a', 'b'), flatEdge('b', 'ghost')]);
    expect(result.order).toEqual(['a', 'b']);
    expect(result.cycles).toEqual([]);
  });

  it('skips an edge whose source step is unknown (no crash on the missing adjacency)', () => {
    const result = topoSort(nodes, [flatEdge('a', 'b'), flatEdge('ghost', 'b')]);
    expect(result.order).toEqual(['a', 'b']);
    expect(result.cycles).toEqual([]);
  });
});
