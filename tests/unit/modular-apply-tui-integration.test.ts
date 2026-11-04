import { describe, expect, it, vi } from 'vitest';
import type { IntentContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';

const backend = vi.hoisted(() => ({ apply: vi.fn(() => ({ ok: true })) }));
vi.mock('@kernlang/agon-core', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  resolveWorkingDir: () => '/fixture',
}));
vi.mock('@kernlang/agon-support-worktree', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  preflightApply: () => ({ ok: true, dirtyTree: false, patch: {
    path: '/fixture.patch', engineId: 'fixture', content: 'fixture patch', lineCount: 1,
  } }),
  applyPatchToTree: backend.apply,
  inspectWorkingTree: () => ({ ok: true, dirtyTree: false }),
}));
import { createMod } from '../../packages/mod-forge/src/implementation.js';
import { patchApplicationHost } from '../../packages/cli/src/patch-application-host.js';
import { runPhysicalTuiContribution } from '../../packages/cli/src/signals/dispatch/intent-session.js';

describe('Apply parser → physical TUI → approval host', () => {
  it('escapes terminal controls in a physical contribution error receipt', async () => {
    const dispatch = vi.fn();
    await runPhysicalTuiContribution({ owner: { id: 'agon.forge' }, payload: {
      inputSchema: { type: 'object' }, run: async () => ({ exitCode: 1, stderr: 'Git: \u001b[2J' }),
    } }, {}, 'apply', { dispatch, ctx: { config: {} } } as unknown as DispatchCallbacks, new AbortController().signal);
    expect(dispatch).toHaveBeenCalledWith({ type: 'warning', message: 'Git: \\x1b[2J' });
  });
  it.each([['agon.think', 'apply'], ['agon.forge', 'forge']])('does not lend Apply UI to %s /%s', async (id, command) => {
    const run = vi.fn(async (_input, invocation) => {
      expect(await patchApplicationHost.open(invocation)).toBeUndefined();
      return { exitCode: 0 };
    });
    const dispatch = vi.fn();
    await runPhysicalTuiContribution({ payload: { run, inputSchema: { type: 'object' } }, owner: { id } }, {}, command, {
      dispatch, ctx: { config: {} },
    } as unknown as DispatchCallbacks, new AbortController().signal);
    expect(run).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'question' }));
  });
  it('previews before asking, then applies only the confirmed patch', async () => {
    backend.apply.mockClear();
    let contribution!: IntentContribution;
    const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
      if (method === 'intent' && (args[0] as IntentContribution).id === 'intentVariants:0002') contribution = args[0] as IntentContribution;
      return () => {};
    } }) as Registrar;
    const engine = vi.fn();
    await (await createMod({ engines: { dispatch: engine }, patchApplication: patchApplicationHost } as unknown as ModServices)).activate(registrar);
    const events: unknown[] = [];
    const askQuestion = vi.fn(async () => {
      expect(JSON.stringify(events)).toContain('fixture patch');
      expect(backend.apply).not.toHaveBeenCalled();
      return 'y';
    });
    await runPhysicalTuiContribution({ payload: contribution, owner: { id: 'agon.forge' } }, contribution.parse('/apply /fixture.patch')!, 'apply', {
      dispatch: (event: { type: string; resolve?: (answer: string) => void }) => {
        events.push(event);
        if (event.type === 'question') void askQuestion().then(event.resolve!);
      }, ctx: { config: {}, askQuestion },
    } as unknown as DispatchCallbacks, new AbortController().signal);
    expect(askQuestion).toHaveBeenCalledOnce();
    expect(backend.apply).toHaveBeenCalledWith('/fixture', 'fixture patch');
    expect(engine).not.toHaveBeenCalled();
  });
});
