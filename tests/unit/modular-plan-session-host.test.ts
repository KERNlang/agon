import { expect, it, vi } from 'vitest';
import { planSessionHost, withPlanSession } from '@kernlang/agon-mod-plan';
import type { PlanSessionActions } from '@kernlang/agon-mod-plan';

const context = (invocationId: string) => ({ invocationId, cwd: '/fixture', platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} });

it('dispatches typed host actions inside the Plan scope and reports completion afterward', async () => {
  const calls: string[] = [];
  const onDispatched = vi.fn(() => { calls.push('completed'); });
  const actions = {
    approvePending: async () => { calls.push('pending'); return false; },
    approveLegacy: async () => { calls.push('legacy'); },
  } as unknown as PlanSessionActions;
  const request = { type: 'approve' as const };
  await withPlanSession('a', { actions, onDispatched }, async () => {
    expect(await planSessionHost.run(request, context('a'))).toEqual({ exitCode: 0 });
  });
  expect(calls).toEqual(['pending', 'legacy', 'completed']);
  expect(onDispatched).toHaveBeenCalledExactlyOnceWith(request, { handled: true, ranAsJob: false });
});

it('preserves typed Auto results and does not notify completion on failure', async () => {
  const failure = new Error('Auto failed');
  const auto = vi.fn().mockResolvedValueOnce({ handled: true, ranAsJob: true }).mockResolvedValueOnce(null).mockRejectedValueOnce(failure);
  const onDispatched = vi.fn();
  const request = { type: 'auto' as const, input: 'task', autoMode: true as const };
  await withPlanSession('a', { actions: { auto } as unknown as PlanSessionActions, onDispatched }, async () => {
    expect(await planSessionHost.run(request, context('a'))).toEqual({ exitCode: 0 });
    expect(await planSessionHost.run(request, context('a'))).toEqual({ exitCode: 2, stderr: 'Unsupported Plan session action.\n' });
    await expect(planSessionHost.run(request, context('a'))).rejects.toBe(failure);
  });
  expect(onDispatched.mock.calls).toEqual([[request, { handled: true, ranAsJob: true }], [request, null]]);
});

it('blocks typed actions on cancellation, identity mismatch and inherited expiry', async () => {
  const approvePending = vi.fn(async () => true);
  const onDispatched = vi.fn();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let late!: Promise<unknown>;
  await withPlanSession('a', { actions: { approvePending } as unknown as PlanSessionActions, onDispatched }, async () => {
    expect(await planSessionHost.run({ type: 'approve' }, context('b'))).toMatchObject({ exitCode: 2 });
    await expect(planSessionHost.run({ type: 'approve' }, { ...context('a'), signal: AbortSignal.abort() })).rejects.toThrow();
    late = gate.then(() => planSessionHost.run({ type: 'approve' }, context('a')));
  });
  release();
  expect(await late).toMatchObject({ exitCode: 2 });
  expect(approvePending).not.toHaveBeenCalled();
  expect(onDispatched).not.toHaveBeenCalled();
});

it('awaits typed completion effects and propagates their failure', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const failure = new Error('completion failed');
  const onDispatched = vi.fn(async () => { await gate; throw failure; });
  await withPlanSession('a', { actions: { approvePending: async () => true } as unknown as PlanSessionActions, onDispatched }, async () => {
    let settled = false;
    const result = Promise.resolve(planSessionHost.run({ type: 'approve' }, context('a')));
    const observed = result.then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(onDispatched).toHaveBeenCalledOnce();
    const early = settled;
    release();
    expect(await observed).toBe(failure);
    expect(early).toBe(false);
  });
});

it('keeps typed actions isolated across concurrent scopes', async () => {
  const calls: string[] = [];
  await Promise.all(['a', 'b'].map(id => withPlanSession(id, {
    actions: { approvePending: async () => { calls.push(id); return true; } } as unknown as PlanSessionActions,
  }, async () => {
    await Promise.resolve();
    expect(await planSessionHost.run({ type: 'approve' }, context(id))).toEqual({ exitCode: 0 });
  })));
  expect(calls.sort()).toEqual(['a', 'b']);
});
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
