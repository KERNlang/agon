import { mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandContribution, ModServices } from '@kernlang/agon-mod-api';
import * as askPackage from '@kernlang/agon-mod-ask';
import { loadModManagementView } from '../../packages/cli/src/commands/mod.js';

import {
  DurableModHost,
  createFirstPartyModCatalog,
  createFullCompatDesiredState,
  createFirstPartyActivationService,
  planDesiredStateChange,
  bootstrapFirstPartySurfaceGeneration,
  createReleaseSetupSelection,
} from '../../packages/mod-kernel/src/index.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';
import {
  assertProcessSurfaceAvailable,
  disposeProcessSurfaceAuthority,
  initializeProcessSurfaceAuthority,
  processSurfaceClient,
  processSurfaceCatalog,
  processSurfacePublicIds,
} from '../../packages/cli/src/surface-authority-runtime.js';
import { createCesarToolRegistry } from '../../packages/cli/src/cesar/tools.js';
import { detectIntent } from '../../packages/cli/src/signals/intent.js';

const NOW = '2026-08-23T20:00:00.000Z';
afterEach(async () => {
  await disposeProcessSurfaceAuthority();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('production physical surface bootstrap', () => {
  it('awaits selected host services before exposing a physical command', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-async-host-'));
    const { desiredState } = createReleaseSetupSelection({ profile: 'minimal', now: NOW });
    const lock = await surfaceLockFor(desiredState);
    const dispatch = vi.fn(async () => ({ engineId: 'fixture', exitCode: 0, stdout: 'decorated answer' }));
    const unexpected = () => { throw new Error('unexpected compatibility execution'); };
    let decorated = false;
    const createMod = askPackage.createMod;
    const factory = vi.spyOn(askPackage, 'createMod').mockImplementation(services => {
      expect(decorated).toBe(true);
      return createMod(services);
    });
    const boot = await bootstrapFirstPartySurfaceGeneration({ hostRoot: root,
      candidateSelection: { desiredState, lock, configurationFiles: {} },
      runtime: { command: unexpected, tool: unexpected, parseIntent: unexpected, renderDocs: unexpected },
      decorateFirstPartyServices: async (_manifest, base: ModServices) => {
        await new Promise<void>(resolve => setImmediate(resolve));
        decorated = true;
        return { ...base, engines: { dispatch } };
      },
    });
    try {
      const command = boot.activated.generation.assertAvailable('cli', 'ask').payload as CommandContribution;
      await expect(command.run({ engine: 'fixture', prompt: 'question' }, {
        invocationId: 'async-host', cwd: root, platform: 'darwin-arm64', signal: new AbortController().signal, config: {},
      })).resolves.toMatchObject({ exitCode: 0, stdout: 'decorated answer\n' });
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledTimes(1);
    } finally { await boot.activated.dispose(); }
  });

  it('rejects a failed asynchronous host setup before calling its mod factory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-async-host-rejected-'));
    const { desiredState } = createReleaseSetupSelection({ profile: 'minimal', now: NOW });
    const lock = await surfaceLockFor(desiredState);
    const unexpected = () => { throw new Error('unexpected compatibility execution'); };
    const factory = vi.spyOn(askPackage, 'createMod');
    await expect(bootstrapFirstPartySurfaceGeneration({ hostRoot: root,
      candidateSelection: { desiredState, lock, configurationFiles: {} },
      runtime: { command: unexpected, tool: unexpected, parseIntent: unexpected, renderDocs: unexpected },
      decorateFirstPartyServices: async () => {
        await new Promise<void>(resolve => setImmediate(resolve));
        throw new Error('fixture host import failed');
      },
    })).rejects.toThrow('fixture host import failed');
    expect(factory).not.toHaveBeenCalled();
    expect(await new DurableModHost(root, { kernelVersion: '1.0.0' }).readCurrentPointer()).toBeNull();
  });

  it('boots kernel safe mode without importing feature host services', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-safe-host-import-'));
    vi.stubEnv('AGON_MOD_SAFE_MODE', '0');
    vi.doMock('../../packages/cli/src/first-party-services.js', () => {
      throw new Error('fixture feature services unavailable');
    });
    try {
      await expect(initializeProcessSurfaceAuthority(root)).rejects.toMatchObject({
        cause: { message: 'fixture feature services unavailable' },
      });
      vi.stubEnv('AGON_MOD_SAFE_MODE', '1');
      const decorate = vi.fn(() => { throw new Error('safe mode must not decorate feature services'); });
      await initializeProcessSurfaceAuthority(root, decorate);
      expect(decorate).not.toHaveBeenCalled();
      expect(processSurfaceClient('cli').generation).toBe('kernel-safe-mode');
      expect(processSurfacePublicIds('cli')).toContain('mod');
      expect(processSurfacePublicIds('cli')).not.toContain('forge');
    } finally {
      vi.doUnmock('../../packages/cli/src/first-party-services.js');
    }
  });

  it('qualifies a staged selection without activating the full compatibility profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-candidate-selection-'));
    const { desiredState } = createReleaseSetupSelection({ profile: 'minimal', with: ['think'], now: NOW });
    const lock = await surfaceLockFor(desiredState);
    const unexpectedExecution = () => { throw new Error('candidate qualification must not execute a workflow'); };
    const boot = await bootstrapFirstPartySurfaceGeneration({ hostRoot: root,
      candidateSelection: { desiredState, lock, configurationFiles: {} },
      runtime: { command: unexpectedExecution, tool: unexpectedExecution, parseIntent: unexpectedExecution, renderDocs: unexpectedExecution } });
    try {
      expect(boot.activePackageIds).toEqual(['@kernlang/agon-mod-ask', '@kernlang/agon-mod-think']);
      expect(boot.desiredState).toEqual(desiredState);
      for (const surface of ['cli', 'tui', 'mcp', 'cesar', 'docs'] as const) {
        const projection = boot.activated.generation.project(surface);
        // Think declares CLI and TUI contributions, not MCP/Cesar/docs entries.
        expect(projection.entries.some(entry => entry.owner.id === 'agon.think'), surface).toBe(surface === 'cli' || surface === 'tui');
        expect(projection.entries.some(entry => entry.owner.id === 'agon.brainstorm')).toBe(false);
      }
      expect(await new DurableModHost(root, { kernelVersion: '1.0.0' }).readCurrentPointer()).toBeNull();
    } finally { await boot.activated.dispose(); }
  });

  it.each(['safe-mode', 'bad-lock', 'missing-config', 'partial-config'] as const)
    ('rejects invalid staged qualification input: %s', async fault => {
      const root = await mkdtemp(join(tmpdir(), 'agon-candidate-invalid-'));
      const { desiredState } = createReleaseSetupSelection({ profile: 'minimal', now: NOW });
      const lock = await surfaceLockFor(desiredState);
      const unexpectedExecution = () => { throw new Error('unexpected workflow execution'); };
      const operation = bootstrapFirstPartySurfaceGeneration({ hostRoot: root, safeMode: fault === 'safe-mode',
        candidateSelection: { desiredState,
          lock: fault === 'bad-lock' ? { ...lock, graphHash: `sha256:${'0'.repeat(64)}` } : lock,
          configSource: fault === 'missing-config' ? { path: join(root, 'config.json'), contentHash: null } : undefined,
          configurationFiles: fault === 'partial-config' ? { 'config/index.json': new TextEncoder().encode('{}') } : {} },
        runtime: { command: unexpectedExecution, tool: unexpectedExecution, parseIntent: unexpectedExecution, renderDocs: unexpectedExecution } });
      await expect(operation).rejects.toThrow(fault === 'safe-mode' ? /safe mode/ : fault === 'bad-lock' ? /hash/ : /configuration/);
      expect(await new DurableModHost(root, { kernelVersion: '1.0.0' }).readCurrentPointer()).toBeNull();
    });

  it.each(['{}', '{broken'])('refuses orphan management state without a pointer: %s', async bytes => {
    const root = await mkdtemp(join(tmpdir(), 'agon-management-orphan-'));
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', root);
    await writeFile(join(root, 'desired-state.json'), bytes);
    await expect(loadModManagementView()).rejects.toThrow('without a canonical generation pointer');
  });

  it('activates all physical first-party packages when no durable state exists and detects a new pointer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s6-production-default-'));
    await initializeProcessSurfaceAuthority(join(root, 'absent-host'));
    expect(processSurfaceClient('cli').generation).toBe('generated:first-party-full-compat');
    expect(processSurfacePublicIds('cli')).toContain('brainstorm');
    assertProcessSurfaceAvailable('mcp', 'Brainstorm');

    const cesar = createCesarToolRegistry();
    expect(cesar.get('Brainstorm')?.definition.description).toBe('Run brainstorm');
    expect(cesar.names()).not.toContain('cesarTools:0002');

    const pointerPath = join(root, 'absent-host', 'current-generation.json');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(join(root, 'absent-host'), { recursive: true }));
    await writeFile(pointerPath, '{}\n');
    expect(() => processSurfacePublicIds('cli')).toThrow(/changed/);
  });

  it.each(['current', 'stale', 'missing', 'malformed'])('uses selected state with a %s mirror and blocks disabled owners on all five surfaces', async mirror => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s6-production-disabled-'));
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', root);
    const catalog = createFirstPartyModCatalog();
    const full = createFullCompatDesiredState(catalog, NOW);
    const desired = planDesiredStateChange(catalog, full, { kind: 'disable', id: 'agon.brainstorm' }, '2026-08-23T20:00:01.000Z').nextState;
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 's6-production-test' });
    await host.commitGeneration({ operation: 'disable', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
    if (mirror === 'stale') await writeFile(host.paths.desiredState, JSON.stringify(full));
    if (mirror === 'missing') await unlink(host.paths.desiredState);
    if (mirror === 'malformed') await writeFile(host.paths.desiredState, '{broken');
    expect(await createFirstPartyActivationService(host).readDesiredState()).toEqual(desired);
    const management = await loadModManagementView();
    expect(management.groups.flatMap(group => group.entries).find(entry => entry.id === 'brainstorm'))
      .toMatchObject({ status: 'disabled', callable: false });

    await initializeProcessSurfaceAuthority(root);
    expect(processSurfaceClient('cli').generation).toContain('generated:1:');
    for (const [surface, publicId] of [
      ['cli', 'brainstorm'], ['tui', '/brainstorm'], ['mcp', 'Brainstorm'], ['cesar', 'brainstorm'],
    ] as const) {
      expect(() => assertProcessSurfaceAvailable(surface, publicId)).toThrow(/unavailable/);
    }
    expect(detectIntent('/brainstorm ideas')).toMatchObject({ type: 'unknown' });
    expect(processSurfaceClient('docs').project().entries.some(({ owner }) => owner.id === 'agon.brainstorm')).toBe(false);
  });

  it('gives every enabled first-party TUI command a synchronous physical parser', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s6-production-parsers-'));
    await initializeProcessSurfaceAuthority(join(root, 'absent-host'));
    const projected = processSurfaceClient('tui').project().entries;
    const missing = processSurfaceCatalog('tui')
      .filter((entry) => entry.kind === 'tui-action' && entry.category === 'tuiSlashCommands' && entry.ownerClass === 'user-toggleable-mod-package')
      .filter((entry) => {
        const names = [entry.publicId, ...entry.aliases].map((name) => name.replace(/^\//, '').toLowerCase().split(/\s+/)[0]);
        return !processSurfaceCatalog('tui').some((candidate) => candidate.kind === 'intent'
          && candidate.owner.id === entry.owner.id
          && [candidate.publicId, ...candidate.aliases].some((name) => names.includes(name.replace(/^\//, '').toLowerCase().split(/\s+/)[0]))
          && typeof (projected.find((record) => record.kind === candidate.kind && record.id === candidate.registryId)?.payload as { parse?: unknown } | undefined)?.parse === 'function')
          && typeof (projected.find((record) => record.kind === entry.kind && record.id === entry.registryId)?.payload as { parse?: unknown } | undefined)?.parse !== 'function';
      })
      .map((entry) => `${entry.owner.id}:${entry.registryId}:${entry.publicId}`);
    expect(missing).toEqual([]);
  });
});
