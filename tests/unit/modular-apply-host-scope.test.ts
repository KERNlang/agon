import { describe, expect, it, vi } from 'vitest';
import { patchApplicationHost, withPatchApplication } from '../../packages/cli/src/patch-application-host.js';

const context = (invocationId: string) => ({ invocationId, cwd: '/fixture', platform: 'darwin-arm64' as const,
  signal: new AbortController().signal, config: {} });

describe('invocation-scoped patch approval host', () => {
  it('refuses headless and mismatched invocations', async () => {
    expect(await patchApplicationHost.apply({ force: false }, context('none'))).toMatchObject({ exitCode: 2 });
    const apply = vi.fn(async () => ({ exitCode: 0 }));
    await withPatchApplication('one', apply, async () => {
      expect(await patchApplicationHost.apply({ force: false }, context('two'))).toMatchObject({ exitCode: 2 });
    });
    expect(apply).not.toHaveBeenCalled();
  });
  it('keeps overlapping invocations isolated and revokes escaped async work', async () => {
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let escaped!: Promise<unknown>;
    await Promise.all(['one', 'two'].map(id => withPatchApplication(id, async () => {
      seen.push(id); return { exitCode: 0 };
    }, async () => {
      await Promise.resolve();
      await patchApplicationHost.apply({ force: false }, context(id));
      if (id === 'one') escaped = gate.then(() => patchApplicationHost.apply({ force: false }, context(id)));
    })));
    release();
    await expect(escaped).resolves.toMatchObject({ exitCode: 2 });
    expect(seen.sort()).toEqual(['one', 'two']);
  });
});
