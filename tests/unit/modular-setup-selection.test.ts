import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DurableModHost as SetupHost, ManagedLifecycleService as SetupLifecycleService,
  bootstrapFirstPartySurfaceGeneration, currentInvocationConfiguration } from '@kernlang/agon-kernel';
import { invalidateConfigCache, loadConfig } from '@kernlang/agon-core';
import { DurableModHost, ManagedLifecycleService, createManagedLifecyclePlan,
  hashInstalledPackagePayload,
  createReleaseSetupSelection, createFirstPartyModCatalog, runBoundedCandidateProcess, sha256Canonical } from '../../packages/mod-kernel/src/index.js';
import { stageConfigurationMigration } from '../../packages/mod-kernel/src/configuration-migration.js';
import { nodeHostIo } from '../../packages/mod-kernel/src/host-io.js';
import type { CommandContribution } from '../../packages/mod-api/src/index.js';
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

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); invalidateConfigCache(); });

describe('setup preserves selected desired state', () => {
  it.each(['none', 'selected-bytes', 'source-identity', 'missing-artifacts'] as const)
    ('hands staged configuration through the verifier to the real runner: %s', async fault => {
      const home = await mkdtemp(join(tmpdir(), 'agon-staged-config-probe-'));
      try {
        vi.stubEnv('AGON_HOME', home);
        const hostRoot = join(home, 'host');
        vi.stubEnv('AGON_MODULAR_HOST_ROOT', hostRoot);
        const source = '{"forgeFitnessTimeout":77,"unknown":"preserve"}\n';
        await writeFile(join(home, 'config.json'), source);
        const output = vi.spyOn(console, 'log').mockImplementation(() => {});
        await runManagedSetup({ profile: 'minimal', with: 'forge', plan: true });
        const original = JSON.parse(String(output.mock.calls.at(-1)?.[0])).lifecycle;
        const release = JSON.parse(await readFile(new URL('../../docs/specs/evidence/modular-agon-release-set.json', import.meta.url), 'utf8'));
        const prefix = join(home, 'candidate');
        for (const entry of original.packages) {
          const metadata = release.packages.find((item: { id: string }) => item.id === entry.id);
          const root = join(prefix, 'node_modules', entry.id);
          await mkdir(root, { recursive: true });
          const sourceRoot = new URL(`../../${metadata.directory}/`, import.meta.url);
          await cp(new URL('package.json', sourceRoot), join(root, 'package.json'));
          if (metadata.modId) {
            const declaration = JSON.parse(await readFile(new URL('agon.mod.json', sourceRoot), 'utf8'));
            for (const path of declaration.pack.include) {
              await mkdir(dirname(join(root, path)), { recursive: true });
              await cp(new URL(path, sourceRoot), join(root, path));
            }
          }
        }
        // This bridge tests serialization against the actual built runner. It does
        // not qualify dependency resolution from a fully packed installation.
        const runnerRoot = join(prefix, 'node_modules/@kernlang/agon-kernel/dist');
        await mkdir(runnerRoot, { recursive: true });
        await writeFile(join(runnerRoot, 'candidate-activation-runner.js'),
          `import ${JSON.stringify(new URL('../../packages/mod-kernel/dist/candidate-activation-runner.js', import.meta.url).href)};`);
        const launcherRoot = join(prefix, 'node_modules/@kernlang/agon');
        await mkdir(join(launcherRoot, 'dist'), { recursive: true });
        await writeFile(join(launcherRoot, 'package.json'), '{"name":"@kernlang/agon","version":"1.0.0"}');
        await writeFile(join(launcherRoot, 'dist/index.js'), 'console.log("1.0.0");');
        const { planHash: _hash, ...unsigned } = original;
        const packages = await Promise.all(original.packages.map(async (entry: { id: string }) => ({
          ...entry, payloadHash: await hashInstalledPackagePayload(join(prefix, 'node_modules', entry.id)),
        })));
        const subject = { ...unsigned, packages };
        const plan = { ...subject, planHash: sha256Canonical(subject) };
        const configurationFiles = await stageConfigurationMigration(plan, prefix, nodeHostIo);
        const selected = JSON.parse(Buffer.from(configurationFiles['config/selected-global.json']!).toString('utf8'));
        expect(selected.mods['agon.forge'].forgeFitnessTimeout).toBe(77);
        expect(selected.unknown).toBe('preserve');
        let verificationPlan = plan;
        let verificationFiles = configurationFiles;
        if (fault === 'selected-bytes') verificationFiles = { ...configurationFiles, 'config/selected-global.json': Buffer.from('{}') };
        if (fault === 'missing-artifacts') verificationFiles = {};
        if (fault === 'source-identity') {
          const changed = { ...subject, configSource: { ...plan.configSource, path: join(home, 'other.json') } };
          verificationPlan = { ...changed, planHash: sha256Canonical(changed) };
        }
        const verified = await new ReleaseSetVerifier().verify(prefix, verificationPlan, { configurationFiles: verificationFiles });
        expect(verified.passed, JSON.stringify(verified.checks)).toBe(fault === 'none');
        expect(verified.checks.find(check => check.id === 'sacrificial-activation')?.passed).toBe(fault === 'none');
        if (fault === 'none') {
          const unexpected = () => { throw new Error('fixture must not execute a workflow'); };
          const boot = await bootstrapFirstPartySurfaceGeneration({ hostRoot,
            candidateSelection: { desiredState: plan.desiredState, lock: plan.lock, configSource: plan.configSource, configurationFiles },
            runtime: { command: unexpected, tool: unexpected, parseIntent: unexpected, renderDocs: unexpected } });
          try {
            // Inspect the invocation scope without dispatching a real workflow.
            const registration = boot.activated.generation.registry.beginRegistration(manifest('agon.forge', '1.0.0', { contributes: {
              cliCommands: [{ id: 'fixture-config-observer', aliases: [] }], tuiActions: [], mcpTools: [], cesarTools: [],
              lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [],
            } }));
            let observed: unknown;
            registration.registrar.command('cli', { id: 'fixture-config-observer', description: 'fixture', run() {
              observed = currentInvocationConfiguration()?.configuration;
              expect(loadConfig(home).forgeFitnessTimeout).toBe(77);
              return { exitCode: 0 };
            } });
            registration.commit();
            const command = boot.activated.generation.registry.resolve('cli-command', 'fixture-config-observer')!.payload as CommandContribution;
            await command.run({}, { invocationId: 'fixture', cwd: home, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} });
            expect(observed).toMatchObject({ source: plan.configSource,
              owners: expect.arrayContaining([expect.objectContaining({ ownerId: 'agon.forge' })]) });
            expect(currentInvocationConfiguration()).toBeUndefined();
          } finally { await boot.activated.dispose(); }
        }
        expect(await readFile(join(home, 'config.json'), 'utf8')).toBe(source);
        expect(await new DurableModHost(hostRoot, { kernelVersion: '1.0.0' }).readCurrentPointer()).toBeNull();
        expect((await readdir(prefix)).some(name => name.startsWith('.qualification-'))).toBe(false);
      } finally { await rm(home, { recursive: true, force: true }); }
    });

  it.each(['minimal', 'full-compat'] as const)('runs the real built activation probe for %s without executing workflows', async profile => {
    const home = await mkdtemp(join(tmpdir(), 'agon-real-candidate-probe-'));
    vi.stubEnv('AGON_HOME', home);
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', join(home, 'host'));
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runManagedSetup({ profile, plan: true });
    // Qualify the supported config-less plan here. Migration tests cover staged configuration.
    const { planHash: _hash, configSource: _source, ...unsigned } = JSON.parse(String(output.mock.calls.at(-1)?.[0])).lifecycle;
    const plan = { ...unsigned, planHash: sha256Canonical(unsigned) };
    const input = join(home, 'input.json');
    await writeFile(input, JSON.stringify({ plan, hostRoot: join(home, 'probe-host'), configurationFiles: {} }));
    const result = await runBoundedCandidateProcess({ executable: process.execPath,
      args: [fileURLToPath(new URL('../../packages/mod-kernel/dist/candidate-activation-runner.js', import.meta.url)), input],
      cwd: home, env: { HOME: home, AGON_HOME: join(home, 'agon'), XDG_CONFIG_HOME: join(home, 'config'),
        XDG_CACHE_HOME: join(home, 'cache'), XDG_DATA_HOME: join(home, 'data'), XDG_STATE_HOME: join(home, 'state') },
      timeoutMs: 10_000, maxOutputBytes: 128 * 1024 });
    expect(result, result.stderr).toMatchObject({ exitCode: 0, signal: null, timedOut: false, outputTruncated: false });
    const records = result.stdout.split('\n').filter(line => line.startsWith('AGON_CANDIDATE_RESULT:'));
    expect(records).toHaveLength(1);
    const receipt = JSON.parse(records[0]!.slice('AGON_CANDIDATE_RESULT:'.length));
    const physical = createFirstPartyModCatalog().mods.map(entry => entry.id);
    expect(receipt).toMatchObject({ schemaVersion: 1, planHash: plan.planHash, disposed: true,
      activePackageIds: plan.packages.map((entry: { id: string }) => entry.id).filter((id: string) => physical.includes(id)).sort() });
    expect(await new DurableModHost(join(home, 'probe-host'), { kernelVersion: '1.0.0' }).readCurrentPointer()).toBeNull();
  });

  it.each(['current', 'legacy', 'changed-package', 'modified-bytes', 'extra-file', 'missing-file', 'scope-link', 'prefix-link', 'internal-prefix-link'] as const)('qualifies the idempotence shortcut against %s state', async scenario => {
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
    const release = JSON.parse(await readFile(new URL('../../docs/specs/evidence/modular-agon-release-set.json', import.meta.url), 'utf8'));
    const result = await new ManagedLifecycleService(host).apply(plan, { async install(entry, prefix) {
      const owner = release.packages.find((owner: { id: string }) => owner.id === entry.id);
      expect(owner).toBeDefined();
      const root = join(prefix, 'node_modules', entry.id);
      for (const { path } of owner.files) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await cp(new URL(`../../${owner.directory}/${path}`, import.meta.url), join(root, path));
      }
      expect(await hashInstalledPackagePayload(root)).toBe(entry.payloadHash);
    } }, verifier);
    const prefix = join(host.root, result.installation.prefix);
    const packageRoot = join(prefix, 'node_modules', plan.packages[0].id);
    const entrypoint = join(packageRoot, 'dist/index.js');
    if (scenario === 'modified-bytes') {
      await chmod(entrypoint, 0o600);
      await writeFile(entrypoint, 'throw new Error("changed after qualification");');
    } else if (scenario === 'extra-file') {
      await chmod(packageRoot, 0o700);
      await writeFile(join(packageRoot, 'unexpected.js'), 'export {};');
    } else if (scenario === 'missing-file') {
      await chmod(dirname(entrypoint), 0o700);
      await unlink(entrypoint);
    } else if (scenario === 'scope-link') {
      const modules = join(prefix, 'node_modules');
      await chmod(modules, 0o700);
      await chmod(join(modules, '@kernlang'), 0o700);
      await rename(join(modules, '@kernlang'), join(modules, 'moved-scope'));
      await symlink(join(modules, 'moved-scope'), join(modules, '@kernlang'));
    } else if (scenario === 'prefix-link' || scenario === 'internal-prefix-link') {
      await chmod(prefix, 0o700);
      const moved = join(scenario === 'internal-prefix-link' ? host.root : home, 'moved-installation');
      await rename(prefix, moved);
      await symlink(moved, prefix);
    }
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

  it.each(['none', 'runtime', 'runtime-valid-hash', 'activation-exit-zero', 'activation-wrong-plan', 'activation-dispose-failure', 'activation-payload-write', 'activation-scope-link', 'activation-duplicate-receipt', 'extra-file', 'missing-payload-hash', 'schema', 'manifest', 'name', 'missing-manifest', 'support', 'escape', 'package-link', 'launcher-name', 'launcher-escape', 'launcher-output', 'launcher-payload-write'] as const)
    ('checks staged static identity before executing the launcher: %s', async fault => {
      const root = await mkdtemp(join(tmpdir(), 'agon-setup-static-'));
      const prefix = join(root, 'candidate');
      const app = join(prefix, 'node_modules', '@test', 'app');
      const support = join(prefix, 'node_modules', '@test', 'support');
      const launcher = join(prefix, 'node_modules', '@kernlang', 'agon');
      const kernel = join(prefix, 'node_modules', '@kernlang', 'agon-kernel');
      for (const path of [join(app, 'dist'), join(app, 'schemas'), support, join(launcher, 'dist'), join(kernel, 'dist')]) await mkdir(path, { recursive: true });
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
      if (fault === 'runtime-valid-hash') await writeFile(join(app, 'dist/index.js'), 'throw new Error("hash-matched broken runtime");');
      await writeFile(join(app, 'dist/index.d.ts'), 'export {};');
      await writeFile(join(support, 'package.json'), metadata);
      await writeFile(join(launcher, 'package.json'), JSON.stringify({ name: '@kernlang/agon', version: '1.0.0' }));
      const marker = join(root, 'executed');
      await writeFile(join(launcher, 'dist/index.js'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes'); console.log('1.0.0');`);
      if (fault === 'launcher-payload-write') await writeFile(join(launcher, 'dist/index.js'),
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes'); console.log('1.0.0');
        require('node:fs').writeFileSync(require('node:path').join(__dirname, '../../../@test/app/dist/index.js'), 'export const changed = true;');`);
      // This fixture tests the verifier protocol. Real bootstrap tests cover registration.
      const kernelMetadata = JSON.stringify({ name: '@kernlang/agon-kernel', version: '1.0.0', type: 'module' });
      const runner = `
        import { readFile, writeFile, rename, symlink } from 'node:fs/promises';
        import { fileURLToPath } from 'node:url';
        const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
        ${fault === 'activation-exit-zero' ? 'process.exit(0);' : ''}
        const app = new URL('../../../@test/app/dist/index.js', import.meta.url);
        await import(app.href);
        ${fault === 'activation-dispose-failure' ? 'throw new Error("fixture disposal failed");' : ''}
        ${fault === 'activation-payload-write' ? 'await writeFile(app, "export const changed = true;");' : ''}
        ${fault === 'activation-scope-link' ? `
          const scope = new URL('../../../@test', import.meta.url);
          const moved = new URL('../../../outside-scope', import.meta.url);
          await rename(scope, moved); await symlink(fileURLToPath(moved), scope);
        ` : ''}
        const receipt = { schemaVersion: 1, planHash: ${fault === 'activation-wrong-plan' ? '"wrong-plan"' : 'input.plan.planHash'},
          activePackageIds: [], surfaceCounts: { cli: 0, tui: 0, mcp: 0, cesar: 0, docs: 0 }, disposed: true };
        console.log('AGON_CANDIDATE_RESULT:' + JSON.stringify(receipt));
        ${fault === 'activation-duplicate-receipt' ? "console.log('AGON_CANDIDATE_RESULT:' + JSON.stringify(receipt));" : ''}
      `;
      await writeFile(join(kernel, 'package.json'), kernelMetadata);
      await writeFile(join(kernel, 'dist/candidate-activation-runner.js'), runner);
      const payload = await Promise.all([...definition.pack.include].sort().map(async path => {
        const bytes = await readFile(join(app, path), 'utf8');
        return { path, size: Buffer.byteLength(bytes), contentHash: hash(bytes) };
      }));
      const entries = [artifact('@test/app', [], { manifestHash: sha256Canonical(definition),
        payloadHash: fault === 'missing-payload-hash' ? undefined : sha256Canonical(payload) }),
        artifact('@test/support', [], { manifestHash: hash(metadata),
          payloadHash: sha256Canonical([{ path: 'package.json', size: Buffer.byteLength(metadata), contentHash: hash(metadata) }]) }),
        artifact('@kernlang/agon-kernel', [], { manifestHash: hash(kernelMetadata), payloadHash: sha256Canonical([
          { path: 'dist/candidate-activation-runner.js', size: Buffer.byteLength(runner), contentHash: hash(runner) },
          { path: 'package.json', size: Buffer.byteLength(kernelMetadata), contentHash: hash(kernelMetadata) },
        ]) })];
      const host = new DurableModHost(join(root, 'host'), { kernelVersion: '1.0.0' });
      const plan = await createManagedLifecyclePlan(host, request(entries, { requestedPackageIds: entries.map(({ id }) => id) }));
      if (fault === 'runtime') await writeFile(join(app, 'dist/index.js'), 'throw new Error("corrupt runtime");');
      if (fault === 'extra-file') await writeFile(join(app, 'dist/injected.js'), 'export {};');
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
      if (fault === 'package-link') {
        await rename(app, join(prefix, 'app-copy'));
        await symlink(join(prefix, 'app-copy'), app);
      }
      if (fault === 'launcher-name') await writeFile(join(launcher, 'package.json'), '{"name":"@wrong/launcher","version":"1.0.0"}');
      if (fault === 'launcher-output') await writeFile(join(launcher, 'dist/index.js'), `console.log('1.0.0'); process.stdout.write('x'.repeat(128 * 1024));`);
      if (fault === 'launcher-escape') {
        const executable = await readFile(join(launcher, 'dist/index.js'));
        await writeFile(join(root, 'outside.cjs'), executable);
        await unlink(join(launcher, 'dist/index.js'));
        await symlink(join(root, 'outside.cjs'), join(launcher, 'dist/index.js'));
      }
      const result = await new ReleaseSetVerifier().verify(prefix, plan);
      expect(result.passed, JSON.stringify(result.checks)).toBe(fault === 'none');
      expect((await readdir(prefix)).filter(name => name.startsWith('.qualification-'))).toEqual([]);
      if (fault === 'none' || fault === 'launcher-payload-write') expect(await readFile(marker, 'utf8')).toBe('yes');
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
        if (fault !== 'launcher-payload-write') await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
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
