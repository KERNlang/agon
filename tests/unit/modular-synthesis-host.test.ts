import { describe, expect, it, vi } from 'vitest';
import type { InvocationContext } from '@kernlang/agon-mod-api';
import type { EngineAdapter } from '@kernlang/agon-support-engine-runtime';
import type { PanelEngineRegistry } from '@kernlang/agon-support-panel';
import { createSynthesisHostServices } from '../../packages/mod-synthesis/src/host.js';
import type { SynthesisHostEffects } from '../../packages/mod-synthesis/src/host.js';

function fixture(routingAdvice?: SynthesisHostEffects<PanelEngineRegistry>['routingAdvice']) {
  const controller = new AbortController();
  const context: InvocationContext = {
    cwd: '/fixture/project', invocationId: 'synthesis-host', platform: 'darwin-arm64',
    signal: controller.signal, config: {},
  };
  let revoked = false;
  const dispatch = vi.fn(async () => ({ stdout: 'draft', stderr: '', exitCode: 0, timedOut: false }));
  const registry = { get: (id: string) => ({ id }), findBinary: () => null } as unknown as PanelEngineRegistry;
  const openRegistry = vi.fn(() => registry);
  const loadConfig = vi.fn(() => ({}));
  const captureAuthority = vi.fn(() => () => { if (revoked) throw new Error('generation revoked'); });
  const host = createSynthesisHostServices({
    openRegistry, loadConfig, captureAuthority, warn: vi.fn(), routingAdvice,
    createAdapter: () => ({ dispatch } as unknown as EngineAdapter),
  });
  return { host, context, controller, dispatch, openRegistry, loadConfig, captureAuthority,
    revoke: () => { revoked = true; } };
}

describe('Synthesis bundled host boundary', () => {
  it.each(['before', 'classify', 'show'].flatMap(phase =>
    ['cancelled', 'revoked'].map(kind => ({ phase, kind }))))(
    'stops advice effects when $kind at $phase', async ({ phase, kind }) => {
      let interrupt = () => {};
      const classifyTask = vi.fn(() => {
        if (phase === 'classify') interrupt();
        return 'bugfix';
      });
      const show = vi.fn(() => { if (phase === 'show') interrupt(); });
      const f = fixture({ classifyTask, isQuiet: () => false, show });
      interrupt = kind === 'revoked' ? f.revoke : () => f.controller.abort(new Error('cancelled'));
      const session = await f.host.open(f.context);
      if (phase === 'before') interrupt();
      expect(() => session.showRoutingAdvice!('fix the login crash')).toThrow(kind);
      expect(classifyTask).toHaveBeenCalledTimes(phase === 'before' ? 0 : 1);
      expect(show).toHaveBeenCalledTimes(phase === 'show' ? 1 : 0);
      expect(f.dispatch).not.toHaveBeenCalled();
    },
  );

  it('opens lazily and binds registry, configuration and cwd to the invocation', async () => {
    const f = fixture();
    expect(f.openRegistry).not.toHaveBeenCalled();
    expect(f.captureAuthority).not.toHaveBeenCalled();
    const session = await f.host.open(f.context);
    expect(f.openRegistry).toHaveBeenCalledWith(f.context.cwd);
    expect(session.effects.resolveWorkingDir()).toBe(f.context.cwd);
    session.effects.health.loadConfig('/unrelated');
    expect(f.loadConfig).toHaveBeenCalledWith(f.context.cwd);
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it('blocks dispatch and publication checks after generation revocation', async () => {
    const f = fixture();
    const session = await f.host.open(f.context);
    f.revoke();
    await expect(session.adapter.dispatch({
      engine: session.registry.get('alpha'), prompt: 'draft', cwd: f.context.cwd,
      mode: 'exec', timeout: 1, outputDir: '/fixture/output', signal: f.context.signal,
    })).rejects.toThrow('generation revoked');
    expect(() => session.assertCurrent()).toThrow('generation revoked');
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it('does not open effects for an already cancelled invocation', () => {
    const f = fixture();
    f.controller.abort(new Error('cancelled'));
    expect(() => f.host.open(f.context)).toThrow('cancelled');
    expect(f.captureAuthority).not.toHaveBeenCalled();
    expect(f.openRegistry).not.toHaveBeenCalled();
  });
});
