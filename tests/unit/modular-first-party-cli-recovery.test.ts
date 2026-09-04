import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { modCommand } from '../../packages/cli/src/commands/mod.js';
import { DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState, parseDesiredState } from '../../packages/mod-kernel/src/index.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';

afterEach(() => { delete process.env.AGON_MODULAR_HOST_ROOT; vi.restoreAllMocks(); });

async function hostFixture() {
  const root = await mkdtemp(join(tmpdir(), 'agon-s8-first-party-cli-')); const hostRoot = join(root, 'host');
  const desired = createFullCompatDesiredState(createFirstPartyModCatalog(), '2026-09-04T00:00:00.000Z');
  const host = new DurableModHost(hostRoot, { kernelVersion: '0.2.5' });
  await host.commitGeneration({ operation: 'install', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: { packages: [] } });
  process.env.AGON_MODULAR_HOST_ROOT = hostRoot; return { root, hostRoot, host, desired };
}

async function previewAndApprove(command: any, target: string) {
  const output: string[] = []; vi.spyOn(console, 'log').mockImplementation((value) => { output.push(String(value)); });
  await command.run({ args: { target } }); const preview = JSON.parse(output.at(-1)!); output.length = 0;
  await command.run({ args: { target: preview.planPath, approve: preview.planHash } }); return { preview, applied: JSON.parse(output.at(-1)!) };
}

describe('first-party safe-mode CLI recovery', () => {
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
