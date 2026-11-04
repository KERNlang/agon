import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ModServices } from '../../packages/mod-api/src/index.js';
import { FolderModManager } from '../../packages/mod-kernel/src/folder-mod-manager.js';
import { ModRegistry } from '../../packages/mod-kernel/src/registry.js';
import { manifest } from '../helpers/modular-agon.js';

async function fixture() {
  const modsRoot = await mkdtemp(join(tmpdir(), 'agon-s8-manager-mods-'));
  const root = join(modsRoot, 'hello');
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'dist/index.js'), "export default async () => ({ apiVersion: '1', activate: r => { r.command('cli', { id: 'hello', description: 'hello', run: async () => ({ exitCode: 0 }) }); } });\n");
  await writeFile(join(root, 'dist/index.d.ts'), 'export {};\n');
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(join(root, 'agon.mod.json'), JSON.stringify(manifest('example.manager', '1.0.0', { contributes: { cliCommands: [{ id: 'hello', aliases: [] }], tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [] } })));
  return modsRoot;
}

function services(): ModServices {
  return { identity: { id: 'kernel', version: '1.0.0', contentHash: `sha256:${'0'.repeat(64)}` }, source: 'bundled', logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record: vi.fn(async () => 'r') }, permissions: { check: vi.fn(async () => 'deny') }, state: { read: vi.fn(async () => undefined), write: vi.fn(async () => undefined) }, engines: { dispatch: vi.fn(async () => ({})) } };
}

describe('S8 folder mod operator backend', () => {
  it('runs inspect → preview → exact approval → authority check → activation → cleanup', async () => {
    const modsRoot = await fixture();
    const hostRoot = await mkdtemp(join(tmpdir(), 'agon-s8-manager-host-'));
    const candidateList = await (async () => {
      const preliminary = await import('../../packages/mod-kernel/src/folder-mods.js');
      return preliminary.discoverUserFolderMods(modsRoot);
    })();
    const candidate = candidateList[0]!;
    const registry = new ModRegistry({ generation: 'manager', activeOwners: [{ id: candidate.manifest.id, version: candidate.manifest.version, contentHash: candidate.contentHash }] });
    const manager = new FolderModManager({ modsRoot, hostRoot, registry, services: services(), kernelVersion: '1.0.0', publisherFor: ({ manifest }) => ({ registryOrigin: 'file:', packageName: manifest.id, provenanceIdentity: 'local-folder', provenanceStatus: 'not-applicable' }) });
    expect((await manager.inspect('example.manager'))[0]?.contentHash).toBe(candidate.contentHash);
    expect(await manager.evaluate(candidate)).toMatchObject({ allowed: false, reason: 'untrusted-source' });
    const preview = manager.previewApproval(candidate, 'operator approved', {}, '2026-09-03T00:00:00.000Z');
    await expect(manager.approve(preview, [])).rejects.toThrow(/every exact plan hash/);
    await manager.approve(preview, [preview.trust.planHash]);
    expect(await manager.evaluate(candidate)).toMatchObject({ allowed: true, trustModel: 'full-code' });
    await expect(manager.activate(candidate)).rejects.toThrow(/not enabled/);
    const enable = manager.previewActivation(candidate, true, 'operator enabled', '2026-09-03T00:00:01.000Z');
    await manager.applyActivation(enable, enable.activation.planHash);
    expect(await manager.isEnabled(candidate)).toBe(true);
    const active = await manager.activate(candidate);
    expect(registry.resolve('cli-command', 'hello')?.owner.id).toBe('example.manager');
    await active.dispose();
    expect(await manager.isEnabled(candidate)).toBe(true);
    const disable = manager.previewActivation(candidate, false, 'operator disabled', '2026-09-03T00:00:02.000Z');
    await manager.applyActivation(disable, disable.activation.planHash);
    expect(await manager.isEnabled(candidate)).toBe(false);
    expect(registry.resolve('cli-command', 'hello')).toBeUndefined();
  });
});
