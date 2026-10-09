import { describe, expect, it, vi } from 'vitest';
import { createPatchApplicationUi, patchApplicationHost, withPatchApplication } from '../../packages/cli/src/patch-application-host.js';
import type { PatchApplicationInteraction } from '@kernlang/agon-mod-api';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';

const context = (invocationId: string) => ({ invocationId, cwd: '/fixture', platform: 'darwin-arm64' as const,
  signal: new AbortController().signal, config: {} });
const ui = () => ({ artifacts: [], notify: vi.fn(), preview: vi.fn(), confirm: vi.fn(async () => 'yes') });

describe('invocation-scoped patch approval host', () => {
  it('observes cancellation of a caller-abandoned confirmation promise', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const invocation = context('abandoned');
      await withPatchApplication(invocation.invocationId, createPatchApplicationUi(vi.fn(), {} as HandlerContext), async () => {
        const interaction = (await patchApplicationHost.open(invocation))!;
        void interaction.confirm('/fixture');
      });
      await new Promise(resolve => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally { process.off('unhandledRejection', unhandled); }
  });
  it('dismisses an unawaited owned question when its host scope exits', async () => {
    const dispatch = vi.fn();
    let pending!: Promise<unknown>;
    const invocation = context('unawaited');
    await withPatchApplication(invocation.invocationId, createPatchApplicationUi(dispatch, {} as HandlerContext), async () => {
      const interaction = (await patchApplicationHost.open(invocation))!;
      pending = Promise.resolve(interaction.confirm('/fixture')).catch(error => error);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve('still pending'), 30); })]);
      expect(result).toMatchObject({ message: 'Patch approval session expired.' });
    } finally { clearTimeout(timer); }
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'question-cancel' }));
  });
  it('refuses competing Apply sessions on one terminal and releases after failure', async () => {
    const dispatch = vi.fn();
    const makeUi = () => createPatchApplicationUi(dispatch, {} as HandlerContext);
    await expect(withPatchApplication('one', makeUi(), async () => {
      // React can replace dispatch on mode/session changes while approval waits.
      const replacement = createPatchApplicationUi(vi.fn(), {} as HandlerContext);
      await expect(withPatchApplication('two', replacement, async () => 'overwrote preview')).rejects.toThrow('Another Apply');
      throw new Error('first session failed');
    })).rejects.toThrow('first session failed');
    await expect(withPatchApplication('three', makeUi(), async () => 'next session')).resolves.toBe('next session');
  });
  it('rejects a borrowed capability inside another active invocation', async () => {
    const original = ui();
    await withPatchApplication('one', original, async () => {
      const interaction = (await patchApplicationHost.open(context('one')))!;
      await withPatchApplication('two', ui(), async () => {
        expect(() => interaction.preview({ engineId: 'borrowed', content: 'patch' })).toThrow('expired');
        await expect(interaction.confirm('/fixture')).rejects.toThrow('expired');
      });
      interaction.notify('info', 'original still valid');
    });
    expect(original.preview).not.toHaveBeenCalled();
    expect(original.confirm).not.toHaveBeenCalled();
    expect(original.notify).toHaveBeenCalledOnce();
  });
  it('settles an aborted prompt and cancels only its own question', async () => {
    const controller = new AbortController();
    const invocation = { ...context('prompt-abort'), signal: controller.signal };
    const dispatch = vi.fn();
    const host = createPatchApplicationUi(dispatch, {
      askQuestion: () => new Promise<string>(() => {}),
    } as unknown as HandlerContext);
    await withPatchApplication(invocation.invocationId, host, async () => {
      const interaction = (await patchApplicationHost.open(invocation))!;
      const answer = Promise.resolve(interaction.confirm('/fixture')).catch(error => error);
      controller.abort();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const settled = await Promise.race([answer, new Promise(resolve => { timer = setTimeout(() => resolve('still pending'), 30); })]);
        expect(settled).toMatchObject({ name: 'AbortError' });
      } finally { clearTimeout(timer); }
    });
    const question = dispatch.mock.calls.find(([event]) => event.type === 'question')?.[0];
    expect(question).toBeDefined();
    expect(dispatch).toHaveBeenCalledWith({ type: 'question-cancel', resolve: question.resolve });
  });
  it('refuses headless and mismatched invocations', async () => {
    expect(await patchApplicationHost.open(context('none'))).toBeUndefined();
    const host = ui();
    await withPatchApplication('one', host, async () => {
      expect(await patchApplicationHost.open(context('two'))).toBeUndefined();
    });
    expect(host.confirm).not.toHaveBeenCalled();
  });
  it('keeps overlapping invocations isolated and revokes escaped async work', async () => {
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let escaped!: Promise<unknown>;
    let retained!: PatchApplicationInteraction;
    await Promise.all(['one', 'two'].map(id => withPatchApplication(id,
      { ...ui(), notify: () => { seen.push(id); } }, async () => {
      await Promise.resolve();
      const interaction = (await patchApplicationHost.open(context(id)))!;
      interaction.notify('info', id);
      if (id === 'one') {
        retained = interaction;
        escaped = gate.then(() => patchApplicationHost.open(context(id)));
      }
    })));
    release();
    await expect(escaped).resolves.toBeUndefined();
    expect(() => retained.notify('info', 'escaped')).toThrow('expired');
    await expect(retained.confirm('/fixture')).rejects.toThrow('expired');
    expect(seen.sort()).toEqual(['one', 'two']);
  });
  it('refuses already-aborted and mid-approval aborted invocations', async () => {
    const controller = new AbortController();
    const invocation = { ...context('abort'), signal: controller.signal };
    const host = ui();
    host.confirm.mockImplementation(async () => { controller.abort(); return 'yes'; });
    await withPatchApplication('abort', host, async () => {
      const interaction = (await patchApplicationHost.open(invocation))!;
      await expect(interaction.confirm('/fixture')).rejects.toThrow();
      expect(() => interaction.preview({ engineId: 'fixture', content: 'no' })).toThrow();
      expect(() => patchApplicationHost.open(invocation)).toThrow();
    });
    expect(host.preview).not.toHaveBeenCalled();
  });
});
