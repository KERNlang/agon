import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { modCommand } from '../../packages/cli/src/commands/mod.js';
import { DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState, parseDesiredState, resolveDesiredState } from '../../packages/mod-kernel/src/index.js';
import { assertSelectedLockPackageClosure, assertSelectedLockIntegrity } from '../../packages/mod-kernel/src/selected-lock-integrity.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';

afterEach(() => { delete process.env.AGON_MODULAR_HOST_ROOT; vi.restoreAllMocks(); });

async function hostFixture() {
  const root = await mkdtemp(join(tmpdir(), 'agon-s8-first-party-cli-')); const hostRoot = join(root, 'host');
  const desired = createFullCompatDesiredState(createFirstPartyModCatalog(), '2026-09-04T00:00:00.000Z');
  const host = new DurableModHost(hostRoot, { kernelVersion: '0.2.5' });
  await host.commitGeneration({ operation: 'install', lock: await surfaceLockFor(desired), desiredState: desired,
    installedIndex: { packages: [], installationId: 'fixture-installation' }, files: { 'installation.json': '{"fixture":true}\n' } });
  process.env.AGON_MODULAR_HOST_ROOT = hostRoot; return { root, hostRoot, host, desired };
}

async function previewAndApprove(command: any, target: string) {
  const output: string[] = []; vi.spyOn(console, 'log').mockImplementation((value) => { output.push(String(value)); });
  await command.run({ args: { target } }); const preview = JSON.parse(output.at(-1)!); output.length = 0;
  await command.run({ args: { target: preview.planPath, approve: preview.planHash } }); return { preview, applied: JSON.parse(output.at(-1)!) };
}

describe('first-party safe-mode CLI recovery', () => {
  it('retains a bootable closure and exact package identities across disable and re-enable', async () => {
    const { host, desired } = await hostFixture();
    const original = await surfaceLockFor(desired);
    for (const verb of ['disable', 'enable'] as const) {
      await previewAndApprove(modCommand.subCommands[verb], 'agon.think');
      const pointer = (await host.readCurrentPointer())!;
      const root = host.generationPath(pointer.generation);
      const state = parseDesiredState(JSON.parse(await readFile(join(root, 'desired-state.json'), 'utf8')));
      const lock = JSON.parse(await readFile(join(root, 'mods.lock.json'), 'utf8'));
      expect(await readFile(join(root, 'installation.json'), 'utf8')).toBe('{"fixture":true}\n');
      expect(() => assertSelectedLockIntegrity(lock, state)).not.toThrow();
      expect(() => assertSelectedLockPackageClosure(lock, resolveDesiredState(createFirstPartyModCatalog(), state).effectivePackages)).not.toThrow();
      expect(lock.packages.some((entry: { id: string }) => entry.id === 'agon.think')).toBe(verb === 'enable');
      if (verb === 'enable') expect(lock.packages).toEqual(original.packages);
    }
  });

  it('disables a first-party mod through a preview-bound durable generation without importing it', async () => {
    const { host } = await hostFixture(); const result = await previewAndApprove(modCommand.subCommands.disable, 'agon.think');
    expect(result.applied).toMatchObject({ disabled: 'agon.think', generation: 2, restartRequired: true });
    expect(parseDesiredState(JSON.parse(await readFile(host.paths.desiredState, 'utf8'))).disabled).toContain('agon.think');
  });

  it('recovers an exact verified generation through two-step approval when the pointer is malformed', async () => {
    const { host, desired } = await hostFixture();
    await host.commitGeneration({ operation: 'update', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: { packages: [] } });
    await writeFile(host.paths.current, '{malformed'); const result = await previewAndApprove(modCommand.subCommands.recover, '1');
    expect(result.applied).toEqual({ recoveredGeneration: 1, restartRequired: true }); expect((await host.boot()).mode).toBe('normal');
  });
});
