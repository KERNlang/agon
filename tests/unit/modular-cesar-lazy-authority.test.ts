import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { withBrainstormFixtureHost } from '../fixtures/modular-brainstorm-host.js';

it.each(['intact', 'disposed', 'replaced', 'pointer-changed'] as const)
  ('binds Cesar execution across lazy Core loading: %s', async transition => {
    vi.resetModules();
    const root = await mkdtemp(join(tmpdir(), 'agon-cesar-lazy-'));
    const hostRoot = join(root, 'host');
    const core = await import('@kernlang/agon-core');
    const authority = await import('../../packages/cli/src/surface-authority-runtime.js');
    const { currentInvocationConfiguration } = await import('@kernlang/agon-kernel');
    const observedScopes: unknown[] = [];
    const dispatch = vi.fn(async (engineId: string) => {
      observedScopes.push(currentInvocationConfiguration());
      return { engineId, exitCode: 0,
        stdout: '{"approach":"fixture","confidence":91,"steps":[],"tradeoffs":[]}', stderr: '', timedOut: false };
    });
    const initialize = () => authority.initializeProcessSurfaceAuthority(hostRoot, (_manifest, base) => withBrainstormFixtureHost({
      ...base, engines: { listActive: async () => ['fixture-engine'], dispatch },
    }));
    let release!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const loading = new Promise<void>(resolve => { entered = resolve; });
    let pending: Promise<{ error?: unknown; result?: unknown }> | undefined;
    try {
      await initialize();
      vi.doMock('@kernlang/agon-core', async () => { entered(); await paused; return core; });
      pending = authority.executeProcessCesarRoute('brainstorm', { question: 'fixture' }, {
        cwd: root, signal: new AbortController().signal,
      }).then(result => ({ result }), error => ({ error }));
      await loading;
      if (transition === 'disposed' || transition === 'replaced') await authority.disposeProcessSurfaceAuthority();
      if (transition === 'replaced') await initialize();
      if (transition === 'pointer-changed') {
        await mkdir(hostRoot, { recursive: true });
        await writeFile(join(hostRoot, 'current-generation.json'), '{"changed":true}');
      }
      release();
      const result = await pending;
      if (transition === 'intact') {
        expect(result.error).toBeUndefined();
        expect(result.result).toMatchObject({ exitCode: 0 });
        expect(dispatch).toHaveBeenCalled();
        expect(observedScopes.length).toBeGreaterThan(0);
        expect(observedScopes.every(scope => !!scope && (scope as { hostRoot: string }).hostRoot === hostRoot)).toBe(true);
        expect(currentInvocationConfiguration()).toBeUndefined();
      } else {
        expect(result.error).toMatchObject({ code: 'MOD_GENERATION_MISMATCH' });
        expect(dispatch).not.toHaveBeenCalled();
      }
    } finally {
      release();
      await pending;
      vi.doUnmock('@kernlang/agon-core');
      await authority.disposeProcessSurfaceAuthority();
      vi.resetModules();
      await rm(root, { recursive: true, force: true });
    }
  });
