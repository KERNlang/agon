import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { createManagedLifecyclePlan } from '../../packages/mod-kernel/src/managed-lifecycle.js';
import { artifact, request } from '../helpers/modular-lifecycle.js';

describe('managed lifecycle source redaction boundary', () => {
  it.each([
    'https://user:password@registry.example/package.tgz',
    'https://registry.example/package.tgz?token=secret',
    'https://registry.example/package.tgz?api_key=secret',
  ])('rejects credential-bearing source locators before they can enter plans or receipts: %s', async (sourceLocator) => {
    const root = await mkdtemp(join(tmpdir(), 'agon-lifecycle-secret-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const original = artifact('@test/app');
    const tainted = { ...original, sourceLocator };
    await expect(createManagedLifecyclePlan(host, request([original], {
      artifacts: [tainted],
      lock: { ...request([original]).lock, packages: [{ ...request([original]).lock.packages[0]!, sourceLocator }] },
    }))).rejects.toThrow('must not contain credential');
  });
});
