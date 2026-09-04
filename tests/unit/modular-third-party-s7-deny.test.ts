import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { createManagedLifecyclePlan } from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { artifact, request } from '../helpers/modular-lifecycle.js';

describe('S7 third-party fail-closed boundary', () => {
  it('refuses third-party activation even when its bytes and provenance look plausible', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s7-third-party-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const entry = artifact('@evil/plausible', [], { trustTier: 'third-party' });
    await expect(createManagedLifecyclePlan(host, request([entry])))
      .rejects.toThrow(/source and publisher provenance binding|lacks exact S8 trust authority/);
    expect(await host.readCurrentPointer()).toBeNull();
  });
});
