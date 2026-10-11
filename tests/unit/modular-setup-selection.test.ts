import { chmod, cp, mkdir, mkdtemp, readFile, readdir, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DurableModHost as SetupHost, ManagedLifecycleService as SetupLifecycleService } from '@kernlang/agon-kernel';
import { DurableModHost, ManagedLifecycleService, createManagedLifecyclePlan,
  createReleaseSetupSelection, sha256Canonical } from '../../packages/mod-kernel/src/index.js';
import { runManagedSetup, ReleaseSetVerifier } from '../../packages/cli/src/commands/setup.js';
import { artifact, installer, request, verifier } from '../helpers/modular-lifecycle.js';
import { manifest } from '../helpers/modular-agon.js';

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
  it.each(['current', 'legacy', 'changed-package'] as const)('qualifies the idempotence shortcut against %s state', async scenario => {
    const home = await mkdtemp(join(tmpdir(), 'agon-setup-qualified-'));
    vi.stubEnv('AGON_HOME', home);
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', join(home, 'modular-host'));
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runManagedSetup({ profile: 'custom', plan: true });
    const preview = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
    const { planHash: _originalHash, ...unsigned } = preview.lifecycle;
    if (scenario === 'legacy') delete unsigned.configSource;
    if (scenario === 'changed-package') {
      unsigned.packages[0].contentHash = `sha256:${'9'.repeat(64)}`;
      unsigned.lock.packages[0].contentHash = unsigned.packages[0].contentHash;
      const { graphHash: _graph, ...lockSubject } = unsigned.lock;
      unsigned.lock.graphHash = sha256Canonical(lockSubject);
    }
    const plan = { ...unsigned, planHash: sha256Canonical(unsigned) };
    const host = new DurableModHost(join(home, 'modular-host'), { kernelVersion: '1.0.0' });
    const workspacePaths: string[] = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).workspaces;
    const metadata = await Promise.all(workspacePaths.map(async path => {
      const bytes = await readFile(new URL(`../../${path}/package.json`, import.meta.url));
      return { name: JSON.parse(bytes.toString('utf8')).name as string, bytes };
    }));
    await new ManagedLifecycleService(host).apply(plan, { async install(entry, prefix, context) {
      await installer.install(entry, prefix, context);
      const owner = metadata.find(owner => owner.name === entry.id);
      expect(owner).toBeDefined();
      await writeFile(join(prefix, 'node_modules', entry.id, 'package.json'), owner!.bytes);
    } }, verifier);
    const before = await readFile(host.paths.current);
    output.mockClear();
    const apply = vi.spyOn(SetupLifecycleService.prototype, 'apply').mockRejectedValue(new Error('fixture-requalification-required'));
    if (scenario === 'current') {
      await runManagedSetup({ profile: 'custom' });
      expect(JSON.parse(String(output.mock.calls.at(-1)?.[0])).status).toBe('already-qualified');
      expect(apply).not.toHaveBeenCalled();
      expect((await stat(join(home, 'bin/agon'))).isFile()).toBe(true);
    } else {
      await expect(runManagedSetup({ profile: 'custom' })).rejects.toThrow('fixture-requalification-required');
      expect(apply).toHaveBeenCalledOnce();
      expect(output).not.toHaveBeenCalled();
      await expect(stat(join(home, 'bin/agon'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect(await readFile(host.paths.current)).toEqual(before);
  });

  it.each(['none', 'schema', 'manifest', 'name', 'missing-manifest', 'support', 'escape', 'launcher-name', 'launcher-escape'] as const)
    ('checks staged static identity before executing the launcher: %s', async fault => {
      const root = await mkdtemp(join(tmpdir(), 'agon-setup-static-'));
      const prefix = join(root, 'candidate');
      const app = join(prefix, 'node_modules', '@test', 'app');
      const support = join(prefix, 'node_modules', '@test', 'support');
      const launcher = join(prefix, 'node_modules', '@kernlang', 'agon');
      for (const path of [join(app, 'dist'), join(app, 'schemas'), support, join(launcher, 'dist')]) await mkdir(path, { recursive: true });
      const hash = (bytes: string): `sha256:${string}` => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      const schema = '{"type":"object","additionalProperties":true}';
      const definition = manifest('example.app', '1.0.0', { assets: [{ path: 'schemas/config.json', kind: 'schema', mediaType: 'application/schema+json',
        bytes: Buffer.byteLength(schema), contentHash: hash(schema), executable: false, platforms: ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'] }],
        pack: { include: ['dist/index.js', 'dist/index.d.ts', 'agon.mod.json', 'package.json', 'schemas/config.json'], executable: [] } });
      const metadata = JSON.stringify({ name: '@test/support', version: '1.0.0' });
      await writeFile(join(app, 'package.json'), JSON.stringify({ name: '@test/app', version: '1.0.0' }));
      await writeFile(join(app, 'agon.mod.json'), JSON.stringify(definition));
      await writeFile(join(app, 'schemas/config.json'), schema);
      await writeFile(join(app, 'dist/index.js'), 'export {};');
      await writeFile(join(app, 'dist/index.d.ts'), 'export {};');
      await writeFile(join(support, 'package.json'), metadata);
      await writeFile(join(launcher, 'package.json'), JSON.stringify({ name: '@kernlang/agon', version: '1.0.0' }));
      const marker = join(root, 'executed');
      await writeFile(join(launcher, 'dist/index.js'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes'); console.log('1.0.0');`);
      const entries = [artifact('@test/app', [], { manifestHash: sha256Canonical(definition) }), artifact('@test/support', [], { manifestHash: hash(metadata) })];
      const host = new DurableModHost(join(root, 'host'), { kernelVersion: '1.0.0' });
      const plan = await createManagedLifecyclePlan(host, request(entries, { requestedPackageIds: entries.map(({ id }) => id) }));
      if (fault === 'schema') await writeFile(join(app, 'schemas/config.json'), schema.replace('true', 'null'));
      if (fault === 'manifest') await writeFile(join(app, 'agon.mod.json'), JSON.stringify({ ...definition, name: 'changed' }));
      if (fault === 'name') await writeFile(join(app, 'package.json'), '{"name":"@wrong/app","version":"1.0.0"}');
      if (fault === 'missing-manifest') await unlink(join(app, 'agon.mod.json'));
      if (fault === 'support') await writeFile(join(support, 'package.json'), '{"name":"@test/support","version":"1.0.0","changed":true}');
      if (fault === 'escape') {
        await unlink(join(app, 'schemas/config.json'));
        await writeFile(join(root, 'outside.json'), schema);
        await symlink(join(root, 'outside.json'), join(app, 'schemas/config.json'));
      }
      if (fault === 'launcher-name') await writeFile(join(launcher, 'package.json'), '{"name":"@wrong/launcher","version":"1.0.0"}');
      if (fault === 'launcher-escape') {
        const executable = await readFile(join(launcher, 'dist/index.js'));
        await writeFile(join(root, 'outside.cjs'), executable);
        await unlink(join(launcher, 'dist/index.js'));
        await symlink(join(root, 'outside.cjs'), join(launcher, 'dist/index.js'));
      }
      const result = await new ReleaseSetVerifier().verify(prefix, plan);
      expect(result.passed).toBe(fault === 'none');
      if (fault === 'none') expect(await readFile(marker, 'utf8')).toBe('yes');
      else await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
      const service = new ManagedLifecycleService(host);
      const application = service.apply(plan, { async install(entry, destination) {
        await cp(join(prefix, 'node_modules', entry.id), join(destination, 'node_modules', entry.id), { recursive: true });
        if (entry.id === '@test/app') await cp(launcher, join(destination, 'node_modules', '@kernlang', 'agon'), { recursive: true });
      } }, new ReleaseSetVerifier());
      if (fault === 'none') {
        await expect(application).resolves.toMatchObject({ pointer: { generation: 1 } });
        expect((await host.readCurrentPointer())?.generation).toBe(1);
      } else {
        await expect(application).rejects.toMatchObject({ code: 'MOD_TRANSACTION_FAILED' });
        expect(await host.readCurrentPointer()).toBeNull();
        expect(await readdir(service.installationsRoot)).toEqual([]);
        expect(await readdir(service.stagingRoot)).toEqual([]);
        await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
      }
    });

  it('refuses a setup preview after its global configuration changes', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agon-setup-config-source-'));
    vi.stubEnv('AGON_HOME', home);
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', join(home, 'modular-host'));
    const source = join(home, 'config.json');
    await writeFile(source, '{"forgeFitnessTimeout":91}\n');
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runManagedSetup({ profile: 'minimal', plan: true });
    const plan = JSON.parse(String(output.mock.calls.at(-1)?.[0])).lifecycle;
    await writeFile(source, '{"forgeFitnessTimeout":137}\n');
    const host = new DurableModHost(join(home, 'modular-host'), { kernelVersion: '1.0.0' });
    const install = vi.fn(installer.install);
    await expect(new ManagedLifecycleService(host).apply(plan, { install }, verifier))
      .rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
    expect(install).not.toHaveBeenCalled();
    expect(await host.readCurrentPointer()).toBeNull();
    expect(await readFile(source, 'utf8')).toBe('{"forgeFitnessTimeout":137}\n');
  });

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
