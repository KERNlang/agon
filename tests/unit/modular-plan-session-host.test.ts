import { expect, it, vi } from 'vitest';
import { planSessionHost, withPlanSession } from '@kernlang/agon-mod-plan';

const context = (invocationId: string) => ({ invocationId, cwd: '/fixture', platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} });
it('rejects absent and mismatched session identities', async () => {
  const run = vi.fn(async () => ({ exitCode: 0 }));
  expect(await planSessionHost.run({ type: 'approve' }, context('a'))).toMatchObject({ exitCode: 2 });
  await withPlanSession('a', run, async () => {
    expect(await planSessionHost.run({ type: 'approve' }, context('b'))).toMatchObject({ exitCode: 2 });
    expect(run).not.toHaveBeenCalled();
  });
});
it('isolates concurrent sessions and refuses cancelled calls', async () => {
  await Promise.all(['a', 'b'].map((id) => withPlanSession(id, async () => ({ exitCode: 0, stdout: id }), async () => {
    await Promise.resolve();
    expect(await planSessionHost.run({ type: 'cancel' }, context(id))).toEqual({ exitCode: 0, stdout: id });
  })));
  const controller = new AbortController(); controller.abort();
  await expect(planSessionHost.run({ type: 'approve' }, { ...context('a'), signal: controller.signal })).rejects.toThrow();
});

it('expires inherited asynchronous work after the owning invocation returns', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let late!: Promise<unknown>;
  const run = vi.fn(async () => ({ exitCode: 0 }));
  await withPlanSession('a', run, async () => {
    late = gate.then(() => planSessionHost.run({ type: 'approve' }, context('a')));
  });
  release();
  expect(await late).toMatchObject({ exitCode: 2 });
  expect(run).not.toHaveBeenCalled();
});

it('restores the outer session after a nested invocation fails', async () => {
  await withPlanSession('outer', async () => ({ exitCode: 0, stdout: 'outer' }), async () => {
    await expect(withPlanSession('inner', async () => ({ exitCode: 0, stdout: 'inner' }), async () => {
      expect(await planSessionHost.run({ type: 'approve' }, context('inner'))).toMatchObject({ stdout: 'inner' });
      throw new Error('inner failure');
    })).rejects.toThrow('inner failure');
    expect(await planSessionHost.run({ type: 'approve' }, context('outer'))).toMatchObject({ stdout: 'outer' });
    expect(await planSessionHost.run({ type: 'approve' }, context('inner'))).toMatchObject({ exitCode: 2 });
  });
});

it('expires inherited work when the owning invocation throws', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let late!: Promise<unknown>;
  const run = vi.fn(async () => ({ exitCode: 0 }));
  await expect(withPlanSession('a', run, async () => {
    late = gate.then(() => planSessionHost.run({ type: 'approve' }, context('a')));
    throw new Error('owner failed');
  })).rejects.toThrow('owner failed');
  release();
  expect(await late).toMatchObject({ exitCode: 2 });
  expect(run).not.toHaveBeenCalled();
});
