import { expect, it, vi } from 'vitest';
import { planSessionHost, withPlanSession } from '../../packages/cli/src/plan-session-host.js';

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
