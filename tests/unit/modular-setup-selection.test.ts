import { chmod, mkdir, mkdtemp, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DurableModHost as SetupHost } from '@kernlang/agon-kernel';
import { DurableModHost, ManagedLifecycleService, createManagedLifecyclePlan,
  createReleaseSetupSelection } from '../../packages/mod-kernel/src/index.js';
import { runManagedSetup } from '../../packages/cli/src/commands/setup.js';
import { artifact, installer, request, verifier } from '../helpers/modular-lifecycle.js';

// Source tests use the same release input copied beside the bundled CLI.
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: (path: Parameters<typeof actual.readFile>[0], options?: Parameters<typeof actual.readFile>[1]) => {
    const selected = path instanceof URL && path.pathname.endsWith('/cli/src/release-channel.json')
      ? new URL('../../packages/cli/release-channel.json', import.meta.url) : path;
    return actual.readFile(selected, options);
  } };
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('setup preserves selected desired state', () => {
  it.each([false, true])('does not write a launcher when previewing an already installed selection (launcher exists=%s)', async exists => {
    const home = await mkdtemp(join(tmpdir(), 'agon-setup-preview-'));
    const root = join(home, 'modular-host');
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', root);
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const selection = createReleaseSetupSelection({ profile: 'minimal', now: '2026-10-11T00:00:00.000Z' });
    const entries = selection.effectivePackageIds.map(id => artifact(id));
    await new ManagedLifecycleService(host).apply(await createManagedLifecyclePlan(host, request(entries, {
      requestedPackageIds: entries.map(({ id }) => id), desiredState: selection.desiredState,
    })), installer, verifier);
    const installed = await new ManagedLifecycleService(host).readSelectedInstallation();
    expect(installed?.kernelVersion).toBe('1.0.0');
    expect(installed?.packages.map(({ id, version }) => [id, version]).sort()).toEqual(entries.map(({ id, version }) => [id, version]).sort());
    const launcher = join(home, 'bin', 'agon');
    if (exists) {
      await mkdir(join(home, 'bin'));
      await writeFile(launcher, 'operator launcher\n', { mode: 0o700 });
    }
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runManagedSetup({ profile: 'minimal', plan: true });
    expect(JSON.parse(String(output.mock.calls.at(-1)?.[0])).status).toBe('planned');
    if (exists) {
      expect(await readFile(launcher, 'utf8')).toBe('operator launcher\n');
      expect((await stat(launcher)).mode & 0o777).toBe(0o700);
    } else await expect(stat(launcher)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('still previews a fresh installation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-setup-fresh-'));
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', root);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runManagedSetup({ profile: 'minimal', plan: true });
    const result = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
    expect(result).toMatchObject({ status: 'planned', lifecycle: { operation: 'install', basePointerHash: null } });
    await expect(stat(join(root, 'current-generation.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([3, 4])('rejects selection changes at pointer read %s', async readNumber => {
    const root = await mkdtemp(join(tmpdir(), 'agon-setup-race-'));
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', root);
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const selection = createReleaseSetupSelection({ profile: 'minimal', now: '2026-10-11T00:00:00.000Z' });
    await new ManagedLifecycleService(host).apply(await createManagedLifecyclePlan(host, request([artifact('@test/app')], {
      desiredState: selection.desiredState,
    })), installer, verifier);
    const original = SetupHost.prototype.readCurrentPointer;
    let reads = 0;
    vi.spyOn(SetupHost.prototype, 'readCurrentPointer').mockImplementation(async function (this: InstanceType<typeof SetupHost>) {
      if (++reads === readNumber) {
        const pointer = JSON.parse(await readFile(host.paths.current, 'utf8'));
        await writeFile(host.paths.current, JSON.stringify({ ...pointer, selectedAt: '2026-10-12T00:00:00.000Z' }));
      }
      return original.call(this);
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(runManagedSetup({ plan: true }, { preserveExistingState: true })).rejects.toThrow('modular selection changed');
    expect(reads).toBe(readNumber);
    expect(output).not.toHaveBeenCalled();
  });

  it('refuses corrupted selected state instead of treating it as a new installation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-setup-corrupt-'));
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', root);
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const selection = createReleaseSetupSelection({ profile: 'minimal', now: '2026-10-11T00:00:00.000Z' });
    await new ManagedLifecycleService(host).apply(await createManagedLifecyclePlan(host, request([artifact('@test/app')], {
      desiredState: selection.desiredState,
    })), installer, verifier);
    const pointerBefore = await readFile(host.paths.current);
    const selectedPath = join(host.generationPath(1), 'desired-state.json');
    await chmod(selectedPath, 0o600);
    await writeFile(selectedPath, '{}');
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(runManagedSetup({ plan: true }, { preserveExistingState: true })).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
    expect(output).not.toHaveBeenCalled();
    expect(await readFile(host.paths.current)).toEqual(pointerBefore);
  });

  it('checks the exact desired bytes consumed after generation validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-setup-artifact-race-'));
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', root);
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const selection = createReleaseSetupSelection({ profile: 'minimal', now: '2026-10-11T00:00:00.000Z' });
    await new ManagedLifecycleService(host).apply(await createManagedLifecyclePlan(host, request([artifact('@test/app')], {
      desiredState: selection.desiredState,
    })), installer, verifier);
    const pointerBefore = await readFile(host.paths.current);
    const original = SetupHost.prototype.validateGeneration;
    let validations = 0;
    vi.spyOn(SetupHost.prototype, 'validateGeneration').mockImplementation(async function (this: InstanceType<typeof SetupHost>, generation) {
      const manifest = await original.call(this, generation);
      if (++validations === 2) {
        const selectedPath = join(host.generationPath(generation), 'desired-state.json');
        await chmod(selectedPath, 0o600);
        await writeFile(selectedPath, '{}');
      }
      return manifest;
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(runManagedSetup({ plan: true }, { preserveExistingState: true })).rejects.toThrow('selected desired state changed after verification');
    expect(validations).toBe(2);
    expect(output).not.toHaveBeenCalled();
    expect(await readFile(host.paths.current)).toEqual(pointerBefore);
  });

  it.each(['stale', 'missing'])('ignores a %s mutable desired-state mirror during update preview', async state => {
    const root = await mkdtemp(join(tmpdir(), 'agon-setup-selection-'));
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', root);
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const selection = createReleaseSetupSelection({ profile: 'full-compat', without: ['forge'], now: '2026-10-11T00:00:00.000Z' });
    const service = new ManagedLifecycleService(host);
    await service.apply(await createManagedLifecyclePlan(host, request([artifact('@test/app')], {
      desiredState: selection.desiredState,
    })), installer, verifier);
    const pointerBefore = await readFile(host.paths.current);
    if (state === 'missing') await unlink(host.paths.desiredState);
    else await writeFile(host.paths.desiredState, JSON.stringify(createReleaseSetupSelection({ profile: 'full-compat', now: '2026-10-11T00:00:00.000Z' }).desiredState));
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runManagedSetup({ plan: true }, { preserveExistingState: true });
    const result = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
    expect(result.status).toBe('planned');
    expect(result.selection.desiredState).toEqual(selection.desiredState);
    expect(result.selection.effectiveModIds).not.toContain('agon.forge');
    expect(await readFile(host.paths.current)).toEqual(pointerBefore);
  });
});
