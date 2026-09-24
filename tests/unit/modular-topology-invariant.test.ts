import { describe, expect, it } from 'vitest';
import { resolveCandidates } from '../../packages/mod-kernel/src/index.js';
import { candidate } from '../helpers/modular-agon.js';

const runtime = { platform: 'darwin-arm64' as const, kernelVersion: '1.0.0', apiVersion: '1.0.0', nodeVersion: '22.22.0' };

describe('resolver topology invariants', () => {
  it('emits every node exactly once for a diamond dependency graph', () => {
    const dependency = (id: string) => ({ id, range: '^1.0.0' });
    const graph = resolveCandidates([
      candidate('example.base'),
      candidate('example.left', '1.0.0', 'registry', { manifest: { dependencies: { required: [dependency('example.base')], optional: [], conflicts: [] } } }),
      candidate('example.right', '1.0.0', 'registry', { manifest: { dependencies: { required: [dependency('example.base')], optional: [], conflicts: [] } } }),
      candidate('example.top', '1.0.0', 'registry', { manifest: { dependencies: { required: [dependency('example.left'), dependency('example.right')], optional: [], conflicts: [] } } }),
    ], ['example.top', 'example.right', 'example.left', 'example.base'], runtime);

    expect(graph.order).toEqual(['example.base', 'example.left', 'example.right', 'example.top']);
    expect(new Set(graph.order).size).toBe(4);
    expect(graph.selected).toHaveLength(4);
  });
});
