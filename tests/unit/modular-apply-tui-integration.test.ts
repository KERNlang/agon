import { describe, expect, it, vi } from 'vitest';
import type { IntentContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';

const backend = vi.hoisted(() => ({ apply: vi.fn(() => ({ ok: true })) }));
vi.mock('@kernlang/agon-core', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  resolveWorkingDir: () => '/fixture',
  preflightApply: () => ({ ok: true, dirtyTree: false, patch: {
    path: '/fixture.patch', engineId: 'fixture', content: 'fixture patch', lineCount: 1,
  } }),
  applyPatchToTree: backend.apply,
}));
import { createMod } from '../../packages/mod-forge/src/implementation.js';
import { patchApplicationHost } from '../../packages/cli/src/patch-application-host.js';
import { runPhysicalTuiContribution } from '../../packages/cli/src/signals/dispatch/intent-session.js';

describe('Apply parser → physical TUI → approval host', () => {
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
    await runPhysicalTuiContribution({ payload: contribution }, contribution.parse('/apply /fixture.patch')!, 'apply', {
      dispatch: (event: unknown) => events.push(event), ctx: { config: {}, askQuestion },
    } as unknown as DispatchCallbacks, new AbortController().signal);
    expect(askQuestion).toHaveBeenCalledOnce();
    expect(backend.apply).toHaveBeenCalledWith('/fixture', 'fixture patch');
    expect(engine).not.toHaveBeenCalled();
  });
});
