import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState, planDesiredStateChange } from '../../packages/mod-kernel/src/index.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';

import { dynamicMcpToolOwnsExecution, listMcpTools } from '../../packages/mcp/src/agon-orchestration.js';
let {
  disposeMcpSurfaceAuthority,
  activeMcpSurfaceTools,
  initializeMcpSurfaceAuthority,
  invokeActiveMcpSurfaceTool,
  mcpSurfacePublicIds,
  captureMcpSurfaceAuthority,
} = await import('../../packages/mcp/src/surface-authority.js');

// Module-reset tests must not leave later cases on an obsolete authority instance.
beforeEach(async () => {
  ({ disposeMcpSurfaceAuthority, activeMcpSurfaceTools, initializeMcpSurfaceAuthority,
    invokeActiveMcpSurfaceTool, mcpSurfacePublicIds, captureMcpSurfaceAuthority }
    = await import('../../packages/mcp/src/surface-authority.js'));
});

afterEach(async () => {
  await disposeMcpSurfaceAuthority();
  delete process.env.AGON_MODULAR_HOST_ROOT;
  delete process.env.AGON_HOME;
});

describe('production MCP surface authority', () => {
  it('rejects the nested Council host when Council alone is disabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-mcp-council-selection-'));
    const hostRoot = join(root, 'host');
    vi.stubEnv('AGON_HOME', join(root, 'home'));
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', hostRoot);
    try {
      const catalog = createFirstPartyModCatalog();
      const now = '2026-10-24T00:00:00.000Z';
      const desired = planDesiredStateChange(catalog, createFullCompatDesiredState(catalog, now),
        { kind: 'disable', id: 'agon.council' }, now).nextState;
      const host = new DurableModHost(hostRoot, { kernelVersion: '1.0.0', processIdentity: 'council-test' });
      await host.commitGeneration({ operation: 'disable', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
      await initializeMcpSurfaceAuthority();
      expect(mcpSurfacePublicIds().has('RoomList')).toBe(true);
      const { decorateMcpFirstPartyServices } = await import('../../packages/mcp/src/first-party-services.js');
      const services = decorateMcpFirstPartyServices({ id: 'agon.conquer' } as never, {} as never) as
        import('@kernlang/agon-mod-council').CouncilModServices;
      await expect(async () => services.council!.open({ invocationId: 'disabled-council', cwd: root,
        platform: 'darwin-arm64', signal: new AbortController().signal, config: {} })).rejects.toThrow(/unavailable/);
    } finally {
      await disposeMcpSurfaceAuthority(); vi.unstubAllEnvs();
    }
  });
  it.each(['pointer', 'dispose', 'replace', 'complete'] as const)('pins nested Council authority without inventing an MCP tool: %s', async action => {
    const root = await mkdtemp(join(tmpdir(), 'agon-mcp-council-authority-'));
    vi.stubEnv('AGON_HOME', join(root, 'home'));
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', join(root, 'host'));
    try {
      await initializeMcpSurfaceAuthority();
      expect(mcpSurfacePublicIds().has('Council')).toBe(false);
      const check = captureMcpSurfaceAuthority('council', 'cli');
      expect(check).not.toThrow();
      const { decorateMcpFirstPartyServices } = await import('../../packages/mcp/src/first-party-services.js');
      const services = decorateMcpFirstPartyServices({ id: 'agon.conquer' } as never, {} as never) as
        import('@kernlang/agon-mod-council').CouncilModServices;
      const session = await services.council!.open({ invocationId: 'nested-council', cwd: root,
        platform: 'darwin-arm64', signal: new AbortController().signal, config: {} });
      expect(() => session.assertCurrent()).not.toThrow();
      if (action === 'dispose' || action === 'replace') await disposeMcpSurfaceAuthority();
      if (action === 'replace') await initializeMcpSurfaceAuthority();
      if (action === 'pointer') {
        await mkdir(join(root, 'host'), { recursive: true });
        await writeFile(join(root, 'host', 'current-generation.json'), '{}');
      }
      if (action === 'complete') {
        expect(check).not.toThrow(); expect(() => session.assertCurrent()).not.toThrow();
      } else {
        const reason = action === 'pointer' ? /canonical modular generation changed/ : /disposed or replaced/;
        expect(check).toThrow(reason);
        expect(() => session.assertCurrent()).toThrow(reason);
        expect(() => session.effects.loadConfig(root)).toThrow(reason);
      }
    } finally {
      await disposeMcpSurfaceAuthority(); vi.unstubAllEnvs();
    }
  });

  it('rejects nested Council when only the kernel is enabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-mcp-council-disabled-'));
    vi.stubEnv('AGON_HOME', join(root, 'home'));
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', join(root, 'host'));
    vi.stubEnv('AGON_MOD_SAFE_MODE', '1');
    try {
      await initializeMcpSurfaceAuthority();
      expect(() => captureMcpSurfaceAuthority('council', 'cli')()).toThrow();
    } finally {
      await disposeMcpSurfaceAuthority(); vi.unstubAllEnvs();
    }
  });
  it.each(['pointer', 'dispose', 'replace', 'complete'] as const)('pins the Tribunal host to real MCP authority: %s', async action => {
    const root = await mkdtemp(join(tmpdir(), 'agon-mcp-tribunal-authority-'));
    vi.stubEnv('AGON_HOME', join(root, 'home'));
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', join(root, 'host'));
    try {
      await initializeMcpSurfaceAuthority();
      const { decorateMcpFirstPartyServices } = await import('../../packages/mcp/src/first-party-services.js');
      const services = decorateMcpFirstPartyServices({ id: 'agon.tribunal' } as never, {} as never) as
        import('@kernlang/agon-mod-tribunal').TribunalModServices;
      const session = await services.tribunal!.open({ invocationId: 'real-authority', cwd: root,
        platform: 'darwin-arm64', signal: new AbortController().signal, config: {} });
      expect(() => session.assertCurrent()).not.toThrow();
      if (action === 'dispose' || action === 'replace') await disposeMcpSurfaceAuthority();
      if (action === 'replace') await initializeMcpSurfaceAuthority();
      if (action === 'pointer') {
        await mkdir(join(root, 'host'), { recursive: true });
        await writeFile(join(root, 'host', 'current-generation.json'), '{}');
      }
      if (action === 'complete') expect(() => session.assertCurrent()).not.toThrow();
      else {
        const reason = action === 'pointer' ? /canonical modular generation changed/ : /disposed or replaced/;
        expect(() => session.assertCurrent()).toThrow(reason);
        expect(() => session.effects.loadConfig(root)).toThrow(reason);
      }
    } finally {
      await disposeMcpSurfaceAuthority();
      vi.unstubAllEnvs();
    }
  });

  it('boots safe-mode authority without importing feature host services', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-mcp-safe-import-'));
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', join(root, 'host'));
    vi.stubEnv('AGON_MOD_SAFE_MODE', '0');
    vi.doMock('../../packages/mcp/src/first-party-services.js', () => {
      throw new Error('fixture MCP feature services unavailable');
    });
    vi.doMock('@kernlang/agon-core', () => {
      throw new Error('safe-mode authority must not import Core');
    });
    vi.resetModules();
    let authority: typeof import('../../packages/mcp/src/surface-authority.js') | undefined;
    try {
      authority = await import('../../packages/mcp/src/surface-authority.js');
      await expect(authority.initializeMcpSurfaceAuthority()).rejects.toMatchObject({
        cause: { message: 'fixture MCP feature services unavailable' },
      });
      vi.stubEnv('AGON_MOD_SAFE_MODE', '1');
      await authority.initializeMcpSurfaceAuthority();
      expect(authority.mcpSurfacePublicIds().size).toBe(0);
      expect(authority.activeMcpSurfaceTools()).toEqual([]);
    } finally {
      await authority?.disposeMcpSurfaceAuthority();
      vi.doUnmock('../../packages/mcp/src/first-party-services.js');
      vi.doUnmock('@kernlang/agon-core');
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it.each(['cancel', 'dispose', 'replace', 'pointer', 'complete', 'import-error'] as const)('preserves authority on %s while loading invocation configuration', async action => {
    const root = await mkdtemp(join(tmpdir(), 'agon-mcp-config-authority-'));
    process.env.AGON_HOME = join(root, 'home');
    process.env.AGON_MODULAR_HOST_ROOT = join(root, 'host');
    await initializeMcpSurfaceAuthority();
    let started!: () => void;
    let release!: () => void;
    const loading = new Promise<void>(resolve => { started = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const loadConfig = vi.fn(() => ({}));
    vi.doMock('@kernlang/agon-core', async () => {
      started();
      await pending;
      if (action === 'import-error') throw new Error('fixture Core import failed');
      return { loadConfig };
    });
    try {
      const controller = new AbortController();
      const invocation = invokeActiveMcpSurfaceTool('RoomList', {}, controller.signal);
      const checked = action === 'complete'
        ? expect(invocation).resolves.toEqual([])
        : action === 'import-error'
          ? expect(invocation).rejects.toMatchObject({ cause: { message: 'fixture Core import failed' } })
          : expect(invocation).rejects.toThrow(action === 'cancel' ? /aborted/i : action === 'pointer' ? /canonical modular generation changed/ : /disposed or replaced/);
      await loading;
      if (action === 'cancel') controller.abort();
      if (action === 'dispose' || action === 'replace') await disposeMcpSurfaceAuthority();
      if (action === 'replace') {
        vi.stubEnv('AGON_MOD_SAFE_MODE', '1');
        await initializeMcpSurfaceAuthority();
      }
      if (action === 'pointer') {
        await mkdir(join(root, 'host'), { recursive: true });
        await writeFile(join(root, 'host', 'current-generation.json'), '{}');
      }
      release();
      await checked;
      expect(loadConfig).toHaveBeenCalledTimes(action === 'complete' ? 1 : 0);
    } finally {
      release();
      vi.doUnmock('@kernlang/agon-core');
      vi.unstubAllEnvs();
    }
  });

  it('boots physical packages before listing tools and retains executor-quality descriptions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s6-mcp-production-'));
    process.env.AGON_MODULAR_HOST_ROOT = join(root, 'absent-host');
    await initializeMcpSurfaceAuthority();
    const available = mcpSurfacePublicIds();
    const active = activeMcpSurfaceTools();
    const brainstormRuntime = active.find(({ name }) => name === 'Brainstorm');
    const brainstorm = listMcpTools(available, active).find(({ name }) => name === 'Brainstorm');
    expect(brainstorm?.description).toMatch(/multi-AI brainstorm/i);
    expect(brainstormRuntime?.ownerId).toBe('agon.brainstorm');
    expect(dynamicMcpToolOwnsExecution(brainstormRuntime)).toBe(true);
    expect(dynamicMcpToolOwnsExecution({ name: 'DeliverAnswer', description: '', inputSchema: {}, ownerId: 'agon.kernel' })).toBe(false);
    expect(available.size).toBe(listMcpTools(available, active).length);
  });

  it('invokes the physical owner through the generated MCP registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s6-mcp-invoke-'));
    process.env.AGON_HOME = join(root, 'home');
    process.env.AGON_MODULAR_HOST_ROOT = join(root, 'host');
    await initializeMcpSurfaceAuthority();
    await expect(invokeActiveMcpSurfaceTool('RoomList', {})).resolves.toEqual([]);
  });

  it('retains the project-memory input contract on the generated SaveMemory tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-mcp-memory-contract-'));
    process.env.AGON_HOME = join(root, 'home');
    process.env.AGON_MODULAR_HOST_ROOT = join(root, 'host');
    await initializeMcpSurfaceAuthority();
    const tool = activeMcpSurfaceTools().find(({ name }) => name === 'SaveMemory');
    expect(tool?.ownerId).toBe('agon.memory');
    expect(tool?.inputSchema).toMatchObject({
      required: expect.arrayContaining(['memory', 'section']),
      properties: { memory: { type: 'string' }, section: { type: 'string' } },
    });
  });

  it.each(['allow', 'deny', 'truthy', 'cancel', 'replace', 'pointer'] as const)('preserves project-memory approval on %s', async action => {
    const root = await mkdtemp(join(tmpdir(), 'agon-mcp-memory-approval-'));
    const signals = join(root, 'signals');
    await mkdir(signals);
    vi.stubEnv('AGON_HOME', join(root, 'home'));
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', join(root, 'host'));
    vi.stubEnv('AGON_CWD', root);
    vi.stubEnv('AGON_SIGNAL_DIR', signals);
    vi.stubEnv('AGON_SESSION_ID', 'memory-fixture');
    const controller = new AbortController();
    try {
      await initializeMcpSurfaceAuthority();
      const input = { memory: 'Use session tokens', section: 'Decisions' };
      const settled = invokeActiveMcpSurfaceTool('SaveMemory', input, controller.signal)
        .then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
      let request = '';
      await vi.waitFor(async () => {
        request = (await readdir(signals)).find(name => name.includes('-perm-') && !name.includes('-response')) ?? '';
        expect(request).not.toBe('');
      });
      expect(JSON.parse(await readFile(join(signals, request), 'utf8'))).toMatchObject({ tool: 'SaveMemory', args: input });
      await expect(readFile(join(root, '.agon', 'project.md'))).rejects.toMatchObject({ code: 'ENOENT' });
      if (action === 'cancel') controller.abort();
      if (action === 'replace') {
        await disposeMcpSurfaceAuthority();
        vi.stubEnv('AGON_MOD_SAFE_MODE', '1');
        await initializeMcpSurfaceAuthority();
      }
      if (action === 'pointer') {
        await mkdir(join(root, 'host'), { recursive: true });
        await writeFile(join(root, 'host', 'current-generation.json'), '{}');
      }
      if (action !== 'cancel') {
        await writeFile(join(signals, request.replace(/\.json$/, '-response.json')), JSON.stringify({
          approved: action === 'truthy' ? 'yes' : action !== 'deny',
        }));
      }
      const outcome = await settled;
      if (action === 'allow') {
        expect(outcome.error).toBeUndefined();
        expect(outcome.value).toContain('Saved to project memory [Decisions]');
        expect(await readFile(join(root, '.agon', 'project.md'), 'utf8')).toMatch(/## Decisions\n- \d{4}-\d{2}-\d{2} Use session tokens/);
      } else {
        expect(outcome.error).toBeInstanceOf(Error);
        await expect(readFile(join(root, '.agon', 'project.md'))).rejects.toMatchObject({ code: 'ENOENT' });
      }
      expect(await readdir(signals)).toEqual([]);
    } finally {
      controller.abort();
      await disposeMcpSurfaceAuthority();
      vi.unstubAllEnvs();
    }
  });
});
