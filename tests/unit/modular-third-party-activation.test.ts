import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ModServices } from '../../packages/mod-api/src/index.js';
import { inspectFolderMod } from '../../packages/mod-kernel/src/folder-mods.js';
import { ModRegistry } from '../../packages/mod-kernel/src/registry.js';
import { activateTrustedFolderMod } from '../../packages/mod-kernel/src/third-party-activation.js';
import type { GrantRecord, TrustPublisher, TrustRecord } from '../../packages/mod-kernel/src/trust-authority.js';
import { manifest } from '../helpers/modular-agon.js';

const publisher: TrustPublisher = { registryOrigin: 'file:', packageName: 'example.runtime', provenanceIdentity: 'local-folder', provenanceStatus: 'not-applicable' };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'agon-s8-runtime-'));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/index.js'), 'export default () => { throw new Error("real import must be injectable in this test") }');
  await writeFile(join(root, 'dist/index.d.ts'), 'export {};');
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  const shape = manifest('example.runtime', '1.0.0', {
    permissions: [{ capability: 'engine.dispatch', resources: ['test-engine'], required: true }],
    contributes: { cliCommands: [{ id: 'hello', aliases: [] }], tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [] },
  });
  await writeFile(join(root, 'agon.mod.json'), JSON.stringify(shape));
  return inspectFolderMod(root);
}

function authority(candidate: Awaited<ReturnType<typeof fixture>>): { trust: TrustRecord; grant: GrantRecord } {
  return {
    trust: { schemaVersion: 1, recordId: '11111111-1111-4111-8111-111111111111', modId: candidate.manifest.id, version: candidate.manifest.version, source: candidate.source, sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash, decision: 'trusted', decidedAt: '2026-09-03T00:00:00Z', scope: 'exact-artifact', publisher, reason: 'approved locally' },
    grant: { schemaVersion: 1, recordId: '22222222-2222-4222-8222-222222222222', modId: candidate.manifest.id, contentHash: candidate.contentHash, capability: 'engine.dispatch', resources: ['test-engine'], decision: 'allow', grantedAt: '2026-09-03T00:00:00Z', grantedBy: 'local-user', reason: 'approved locally' },
  };
}

function services(candidate: Awaited<ReturnType<typeof fixture>>): ModServices {
  return {
    identity: { id: candidate.manifest.id, version: candidate.manifest.version, contentHash: candidate.contentHash }, source: candidate.source,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record: vi.fn(async () => 'receipt') },
    permissions: { check: vi.fn(async () => 'deny') }, state: { read: vi.fn(async () => undefined), write: vi.fn(async () => undefined) },
    engines: { dispatch: vi.fn(async () => ({ ok: true })) },
  };
}

describe('S8 trusted third-party activation', () => {
  it('imports only after exact trust/grants, registers under its owner, and disposes cleanly', async () => {
    const candidate = await fixture(); const { trust, grant } = authority(candidate); const base = services(candidate);
    const registry = new ModRegistry({ generation: 's8', activeOwners: [{ id: candidate.manifest.id, version: candidate.manifest.version, contentHash: candidate.contentHash }] });
    const modDispose = vi.fn();
    const result = await activateTrustedFolderMod({ candidate, publisher, trustRecords: [trust], grantRecords: [grant], registry, services: base, capabilityRuntime: { dispatchEngine: async () => ({ ok: true }) }, importModule: async () => ({ default: async (injected: ModServices) => { await injected.engines.dispatch('test-engine', 'hello', {} as never); return { apiVersion: '1', activate(registrar: any) { registrar.command('cli', { id: 'hello', description: 'x', run: async () => ({ exitCode: 0 }) }); return modDispose; } }; } }) });
    expect(registry.resolve('cli-command', 'hello')?.owner.id).toBe('example.runtime');
    expect(base.receipts.record).toHaveBeenCalledWith('capability-decision', expect.objectContaining({ capability: 'engine.dispatch', decision: 'allow' }));
    expect(base.receipts.record).toHaveBeenCalledWith('capability-action', expect.objectContaining({ capability: 'engine.dispatch', outcome: 'completed' }));
    expect(base.engines.dispatch).not.toHaveBeenCalled();
    await result.dispose();
    expect(registry.resolve('cli-command', 'hello')).toBeUndefined();
  });

  it('applies grant revocation to the next capability call in an already-running host', async () => {
    const candidate = await fixture(); const { trust, grant } = authority(candidate); const base = services(candidate);
    const registry = new ModRegistry({ generation: 's8-live-authority', activeOwners: [{ id: candidate.manifest.id, version: candidate.manifest.version, contentHash: candidate.contentHash }] });
    let grants: readonly GrantRecord[] = [{ ...grant, sequence: 1 }];
    let injected: ModServices | undefined;
    const dispatchEngine = vi.fn(async () => ({ ok: true }));
    const result = await activateTrustedFolderMod({ candidate, publisher, trustRecords: [{ ...trust, sequence: 1 }], grantRecords: grants,
      readAuthority: async () => ({ trustRecords: [{ ...trust, sequence: 1 }], grantRecords: grants }), registry, services: base,
      capabilityRuntime: { dispatchEngine },
      importModule: async () => ({ default: async (value: ModServices) => { injected = value; return { apiVersion: '1', activate: (registrar: any) => registrar.command('cli', { id: 'hello', description: 'live authority test', run: async () => ({ exitCode: 0 }) }) }; } }) });
    const context = {} as never;
    const dispatchOptions = { textOnly: true, timeoutSeconds: 17, systemPrompt: 'fixture system', mode: 'review' as const };
    await expect(injected!.engines.dispatch('test-engine', 'before', context, dispatchOptions)).resolves.toEqual({ ok: true });
    expect(dispatchEngine).toHaveBeenCalledExactlyOnceWith('test-engine', 'before', context, dispatchOptions);
    grants = [{ ...grant, sequence: 1 }, { ...grant, recordId: '33333333-3333-4333-8333-333333333333', sequence: 2, decision: 'deny', grantedAt: '2020-01-01T00:00:00Z', reason: 'revoked now' }];
    await expect(injected!.engines.dispatch('test-engine', 'after', {} as never)).rejects.toThrow(/not granted/);
    expect(dispatchEngine).toHaveBeenCalledTimes(1);
    await result.dispose();
  });

  it('refuses safe mode and incomplete grants before import', async () => {
    const candidate = await fixture(); const { trust } = authority(candidate); const imported = vi.fn();
    const registry = new ModRegistry({ generation: 's8', activeOwners: [{ id: candidate.manifest.id, version: candidate.manifest.version, contentHash: candidate.contentHash }] });
    await expect(activateTrustedFolderMod({ candidate, publisher, trustRecords: [trust], grantRecords: [], registry, services: services(candidate), importModule: imported })).rejects.toThrow(/authority is incomplete/);
    await expect(activateTrustedFolderMod({ candidate, publisher, trustRecords: [trust], grantRecords: [], registry, services: services(candidate), safeMode: true, importModule: imported })).rejects.toThrow(/safe mode/);
    expect(imported).not.toHaveBeenCalled();
  });

  it('rolls back partial registration when activation fails', async () => {
    const candidate = await fixture(); const { trust, grant } = authority(candidate);
    const registry = new ModRegistry({ generation: 's8', activeOwners: [{ id: candidate.manifest.id, version: candidate.manifest.version, contentHash: candidate.contentHash }] });
    await expect(activateTrustedFolderMod({ candidate, publisher, trustRecords: [trust], grantRecords: [grant], registry, services: services(candidate), importModule: async () => ({ default: async () => ({ apiVersion: '1', activate(registrar: any) { registrar.command('cli', { id: 'hello', description: 'x', run: async () => ({ exitCode: 0 }) }); throw new Error('boom'); } }) }) })).rejects.toThrow('boom');
    expect(registry.resolve('cli-command', 'hello')).toBeUndefined();
  });
});
