import { describe, expect, it } from 'vitest';

import { orderPhysicalSurfacePackages } from '../../packages/mod-kernel/src/package-activation-order.js';

function candidate(id: string, dependencies: readonly string[] = []): any {
  return {
    manifest: { id, dependencies: { required: dependencies.map((dependency) => ({ id: dependency })) } },
    mod: {},
    services: {},
  };
}

describe('physical mod activation ordering', () => {
  it('orders parents before children with deterministic ties', () => {
    const parent = candidate('agon.parent');
    const child = candidate('agon.child', ['agon.parent']);
    const peer = candidate('agon.alpha');
    expect(orderPhysicalSurfacePackages([child, parent, peer]).map(({ manifest }) => manifest.id))
      .toEqual(['agon.alpha', 'agon.parent', 'agon.child']);
  });

  it('rejects duplicate packages and dependency cycles', () => {
    const duplicate = candidate('agon.same');
    expect(() => orderPhysicalSurfacePackages([duplicate, duplicate])).toThrow(/duplicate/);
    expect(() => orderPhysicalSurfacePackages([
      candidate('agon.a', ['agon.b']), candidate('agon.b', ['agon.a']),
    ])).toThrow(/cycle/);
  });
});
