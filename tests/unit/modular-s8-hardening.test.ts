import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, InvocationContext, ModPlatform, ModServices } from '../../packages/mod-api/src/index.js';
import { inspectFolderMod } from '../../packages/mod-kernel/src/folder-mods.js';
import { ModRegistry } from '../../packages/mod-kernel/src/registry.js';
import { activateTrustedFolderMod } from '../../packages/mod-kernel/src/third-party-activation.js';
import { AUTHORITY_LIMITS, TrustGrantStore, evaluateThirdPartyAuthority, parseTrustRecord, type GrantRecord, type TrustPublisher, type TrustRecord } from '../../packages/mod-kernel/src/trust-authority.js';
import { manifest } from '../helpers/modular-agon.js';

const h = (value: string) => `sha256:${value.repeat(64)}` as const;
const publisher: TrustPublisher = { registryOrigin: 'file:', packageName: 'example.hardened', provenanceIdentity: 'local-folder', provenanceStatus: 'not-applicable' };
const identity = { modId: 'example.hardened', version: '1.0.0', source: 'user-folder' as const, sourceLocator: '/tmp/mod', contentHash: h('a'), manifestHash: h('b'), publisher };
const trust = (decision: TrustRecord['decision'], decidedAt: string, recordId: string): TrustRecord => ({ schemaVersion: 1, recordId, modId: identity.modId, version: identity.version, source: identity.source, sourceLocator: identity.sourceLocator, contentHash: identity.contentHash, manifestHash: identity.manifestHash, decision, decidedAt, scope: 'exact-artifact', publisher, reason: decision });

function services(): ModServices {
  return {
    identity: { id: identity.modId, version: identity.version, contentHash: identity.contentHash }, source: identity.source,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record: vi.fn(async () => 'receipt') },
    permissions: { check: vi.fn(async () => 'deny') }, state: { read: vi.fn(async () => undefined), write: vi.fn(async () => undefined) },
    engines: { dispatch: vi.fn(async () => ({ ok: true })) },
  };
}

async function executableFixture(id = identity.modId, runtimeSource = "export default async () => ({ apiVersion: '1', activate: () => undefined });\n", manifestOverrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'agon-s8-real-import-'));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/index.js'), runtimeSource);
  await writeFile(join(root, 'dist/index.d.ts'), 'export {};\n');
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(join(root, 'agon.mod.json'), JSON.stringify(manifest(id, '1.0.0', manifestOverrides)));
  return inspectFolderMod(root);
}

describe('S8 authority negative controls', () => {
  it('uses the newest trust decision regardless of input ordering', () => {
    const older = trust('trusted', '2026-09-03T00:00:00.000Z', '11111111-1111-4111-8111-111111111111');
    const newer = trust('revoked', '2026-09-03T00:00:01.000Z', '22222222-2222-4222-8222-222222222222');
    for (const records of [[older, newer], [newer, older]]) {
      expect(evaluateThirdPartyAuthority(identity, manifest(identity.modId), records, [])).toMatchObject({ allowed: false, reason: 'untrusted-source' });
    }
  });

  it('invalidates authority on publisher, provenance, and requested-capability changes', () => {
    const accepted = trust('trusted', '2026-09-03T00:00:00.000Z', '11111111-1111-4111-8111-111111111111');
    expect(evaluateThirdPartyAuthority({ ...identity, publisher: { ...publisher, packageName: 'changed' } }, manifest(identity.modId), [accepted], [])).toMatchObject({ allowed: false, reason: 'untrusted-source' });
    expect(evaluateThirdPartyAuthority({ ...identity, publisher: { ...publisher, provenanceStatus: 'invalid' } }, manifest(identity.modId), [accepted], [])).toMatchObject({ allowed: false, reason: 'invalid-provenance' });
    const expanded = manifest(identity.modId, identity.version, { permissions: [{ capability: 'process.exec', resources: ['git'], required: true }] });
    expect(evaluateThirdPartyAuthority(identity, expanded, [accepted], [])).toMatchObject({ allowed: false, reason: 'permission-not-granted' });
  });

  it('invalidates explicit development-path trust when bytes change even without permissions', () => {
    const devIdentity = { ...identity, source: 'explicit-dev' as const };
    const accepted: TrustRecord = {
      ...trust('trusted', '2026-09-03T00:00:00.000Z', '11111111-1111-4111-8111-111111111111'),
      source: 'explicit-dev', scope: 'explicit-dev-path',
    };
    expect(evaluateThirdPartyAuthority(devIdentity, manifest(identity.modId), [accepted], []))
      .toMatchObject({ allowed: true });
    expect(evaluateThirdPartyAuthority({ ...devIdentity, contentHash: h('c') }, manifest(identity.modId), [accepted], []))
      .toMatchObject({ allowed: false, reason: 'untrusted-source' });
    expect(evaluateThirdPartyAuthority({ ...devIdentity, manifestHash: h('d') }, manifest(identity.modId), [accepted], []))
      .toMatchObject({ allowed: false, reason: 'untrusted-source' });
    expect(evaluateThirdPartyAuthority({ ...devIdentity, version: '1.0.1' }, manifest(identity.modId, '1.0.1'), [accepted], []))
      .toMatchObject({ allowed: false, reason: 'untrusted-source' });
  });

  it('does not let optional ungranted capabilities block load or become usable', () => {
    const accepted = trust('trusted', '2026-09-03T00:00:00.000Z', '11111111-1111-4111-8111-111111111111');
    const optional = manifest(identity.modId, identity.version, { permissions: [{ capability: 'state.read', resources: ['secret'], required: false }] });
    expect(evaluateThirdPartyAuthority(identity, optional, [accepted], [])).toMatchObject({ allowed: true, grantRecordIds: [] });
  });

  it('persists grants immutably and rejects plan tampering and duplicate record IDs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-authority-hardening-'));
    const store = new TrustGrantStore(root);
    const plan = store.previewGrant({ modId: identity.modId, contentHash: identity.contentHash, capability: 'state.read', resources: ['public'], decision: 'allow', grantedAt: '2026-09-03T00:00:00.000Z', grantedBy: 'local-user', reason: 'test', recordId: '33333333-3333-4333-8333-333333333333' });
    await store.apply(plan, { approvedPlanHash: plan.planHash });
    await expect(store.apply(plan, { approvedPlanHash: plan.planHash })).rejects.toThrow();
    expect(await store.readGrants()).toHaveLength(1);
    await expect(store.apply({ ...plan, warning: 'tampered' as never }, { approvedPlanHash: plan.planHash })).rejects.toThrow(/hash mismatch/);
  });

  it('rejects non-UTC and impossible authority timestamps', () => {
    const base = trust('trusted', '2026-09-03T00:00:00.000Z', '11111111-1111-4111-8111-111111111111');
    expect(() => parseTrustRecord({ ...base, decidedAt: '2026-09-03T02:00:00+02:00' })).toThrow(/UTC ISO/);
    expect(() => parseTrustRecord({ ...base, decidedAt: '2026-99-99T00:00:00.000Z' })).toThrow(/UTC ISO/);
  });
  it('uses host-assigned sequence so a later revocation beats future-dated authority', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-authority-order-'));
    const store = new TrustGrantStore(root);
    const accepted = store.previewTrust({ ...trust('trusted', '2099-01-01T00:00:00.000Z', '11111111-1111-4111-8111-111111111111') });
    await store.apply(accepted, { approvedPlanHash: accepted.planHash });
    const revoked = store.previewTrust({ ...trust('revoked', '2026-09-04T00:00:00.000Z', '22222222-2222-4222-8222-222222222222') });
    await store.apply(revoked, { approvedPlanHash: revoked.planHash });
    const records = await store.readTrust();
    expect(records.map(({ sequence }) => sequence)).toEqual([1, 2]);
    expect(evaluateThirdPartyAuthority(identity, manifest(identity.modId), [...records].reverse(), []))
      .toMatchObject({ allowed: false, reason: 'untrusted-source' });
  });

  it('rejects oversized authority records before parsing them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-authority-bounds-'));
    await mkdir(join(root, 'trust'));
    await writeFile(join(root, 'trust', '11111111-1111-4111-8111-111111111111.json'), Buffer.alloc(AUTHORITY_LIMITS.maxRecordBytes + 1, 0x20));
    await expect(new TrustGrantStore(root).readTrust()).rejects.toThrow(/file limit/);
  });

});

describe('S8 folder and runtime negative controls', () => {
  it('rejects nested archives instead of exposing an extraction bomb path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-archive-'));
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'dist/index.js'), 'export default {};');
    await writeFile(join(root, 'dist/index.d.ts'), 'export {};');
    await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(join(root, 'payload.zip'), 'not even a real archive');
    const shape = manifest('example.archive');
    await writeFile(join(root, 'agon.mod.json'), JSON.stringify({ ...shape, pack: { include: [...shape.pack.include, 'payload.zip'] } }));
    await expect(inspectFolderMod(root)).rejects.toThrow(/archives are forbidden/);
  });

  it('loads a real verified module URL and then cleans up its owner', async () => {
    const candidate = await executableFixture();
    const accepted: TrustRecord = { ...trust('trusted', '2026-09-03T00:00:00.000Z', '11111111-1111-4111-8111-111111111111'), sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash };
    const registry = new ModRegistry({ generation: 's8-real', activeOwners: [{ id: candidate.manifest.id, version: candidate.manifest.version, contentHash: candidate.contentHash }] });
    const result = await activateTrustedFolderMod({ candidate, publisher, trustRecords: [accepted], grantRecords: [], registry, services: services() });
    expect(result.trustModel).toBe('full-code');
    await result.dispose();
  });

  it('bounds authority evaluation with the maximum supported record set', () => {
    const accepted = { ...trust('trusted', '2026-09-03T00:00:00.000Z', '11111111-1111-4111-8111-111111111111'), sequence: 1 };
    const grants = Array.from({ length: 4_096 }, (_, index) => ({ schemaVersion: 1 as const, recordId: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`, sequence: index + 1, modId: 'example.other', contentHash: identity.contentHash, capability: 'state.read', resources: ['public'], decision: 'deny' as const, grantedAt: '2026-09-03T00:00:00.000Z', grantedBy: 'local-user' as const, reason: 'load test' }));
    const started = performance.now(); expect(evaluateThirdPartyAuthority(identity, manifest(identity.modId), [accepted], grants)).toMatchObject({ allowed: true });
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('preserves external command output streams instead of collapsing progress', async () => {
    const base = manifest(identity.modId);
    const candidate = await executableFixture(identity.modId, `
export default () => ({ apiVersion: '1', activate(registrar) {
  registrar.command('cli', { id: 'stream-events', aliases: [], description: 'stream', inputSchema: { type: 'object' },
    async *run() { yield { type: 'text', text: 'hello' }; yield { type: 'progress', message: 'half', completed: 1, total: 2 }; yield { type: 'result', result: { exitCode: 0, result: { ok: true } } }; }
  });
} });
`, { contributes: { ...base.contributes, cliCommands: [{ id: 'stream-events', aliases: [] }] } });
    const accepted: TrustRecord = { ...trust('trusted', '2026-09-03T00:00:00.000Z', '11111111-1111-4111-8111-111111111111'), sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash };
    const registry = new ModRegistry({ generation: 's8-stream', activeOwners: [{ id: candidate.manifest.id, version: candidate.manifest.version, contentHash: candidate.contentHash }] });
    const activated = await activateTrustedFolderMod({ candidate, publisher, trustRecords: [accepted], grantRecords: [], registry, services: services() });
    const command = registry.project('cli').entries[0]!.payload as CommandContribution;
    const context: InvocationContext = { invocationId: 'stream', cwd: candidate.sourceLocator, platform: `${process.platform}-${process.arch}` as ModPlatform, signal: new AbortController().signal, config: {} };
    const output = await command.run({}, context);
    expect(Symbol.asyncIterator in output).toBe(true);
    const events = []; for await (const event of output as AsyncIterable<unknown>) events.push(event);
    expect(events).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'progress', message: 'half', completed: 1, total: 2 },
      { type: 'result', result: { exitCode: 0, result: { ok: true } } },
    ]);
    await activated.dispose();
  });

  it('fails and terminates an abandoned external output stream at its buffer bound', async () => {
    const base = manifest(identity.modId);
    const candidate = await executableFixture(identity.modId, `
export default () => ({ apiVersion: '1', activate(registrar) {
  registrar.command('cli', { id: 'overflow-stream', aliases: [], description: 'overflow', inputSchema: { type: 'object' },
    async *run() { for (let index = 0; index < 300; index += 1) yield { type: 'progress', message: String(index) }; }
  });
} });
`, { contributes: { ...base.contributes, cliCommands: [{ id: 'overflow-stream', aliases: [] }] } });
    const accepted: TrustRecord = { ...trust('trusted', '2026-09-03T00:00:00.000Z', '11111111-1111-4111-8111-111111111111'), sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash };
    const registry = new ModRegistry({ generation: 's8-stream-bound', activeOwners: [{ id: candidate.manifest.id, version: candidate.manifest.version, contentHash: candidate.contentHash }] });
    const activated = await activateTrustedFolderMod({ candidate, publisher, trustRecords: [accepted], grantRecords: [], registry, services: services() });
    const command = registry.project('cli').entries[0]!.payload as CommandContribution;
    const context: InvocationContext = { invocationId: 'overflow', cwd: candidate.sourceLocator, platform: `${process.platform}-${process.arch}` as ModPlatform, signal: new AbortController().signal, config: {} };
    const output = await command.run({}, context) as AsyncIterable<unknown>;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(output[Symbol.asyncIterator]().next()).rejects.toThrow(/buffer limit/);
    await activated.dispose();
  });

  it('bounds concurrent worker-to-host service calls', async () => {
    const base = manifest(identity.modId);
    const candidate = await executableFixture(identity.modId, `
export default services => ({ apiVersion: '1', activate(registrar) {
  registrar.command('cli', { id: 'flood-host', aliases: [], description: 'flood', inputSchema: { type: 'object' },
    async run() { await Promise.all(Array.from({ length: 100 }, () => services.logger.info('bounded'))); return { exitCode: 0 }; }
  });
} });
`, { contributes: { ...base.contributes, cliCommands: [{ id: 'flood-host', aliases: [] }] } });
    const accepted: TrustRecord = { ...trust('trusted', '2026-09-03T00:00:00.000Z', '11111111-1111-4111-8111-111111111111'), sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash };
    let active = 0; let peak = 0;
    const hostServices = services();
    (hostServices.logger as any).info = async () => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 100)); active -= 1; };
    const registry = new ModRegistry({ generation: 's8-service-bound', activeOwners: [{ id: candidate.manifest.id, version: candidate.manifest.version, contentHash: candidate.contentHash }] });
    const activated = await activateTrustedFolderMod({ candidate, publisher, trustRecords: [accepted], grantRecords: [], registry, services: hostServices });
    const command = registry.project('cli').entries[0]!.payload as CommandContribution;
    const context: InvocationContext = { invocationId: 'service-bound', cwd: candidate.sourceLocator, platform: `${process.platform}-${process.arch}` as ModPlatform, signal: new AbortController().signal, config: {} };
    await expect(Promise.resolve(command.run({}, context))).rejects.toThrow(/concurrency limit/);
    expect(peak).toBeLessThanOrEqual(64);
    await activated.dispose();
  });

  it('passes the real host abort signal into engine capability dispatch', async () => {
    const base = manifest(identity.modId);
    const candidate = await executableFixture(identity.modId, `
export default services => ({ apiVersion: '1', activate(registrar) {
  registrar.command('cli', { id: 'dispatch-until-abort', aliases: [], description: 'dispatch', inputSchema: { type: 'object' },
    async run(_input, context) { await services.engines.dispatch('test-engine', 'work', context); return { exitCode: 0 }; }
  });
} });
`, {
      permissions: [{ capability: 'engine.dispatch', resources: ['test-engine'], required: true }],
      contributes: { ...base.contributes, cliCommands: [{ id: 'dispatch-until-abort', aliases: [] }] },
    });
    const accepted: TrustRecord = { ...trust('trusted', '2026-09-03T00:00:00.000Z', '11111111-1111-4111-8111-111111111111'), sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash };
    const grant: GrantRecord = { schemaVersion: 1, recordId: '22222222-2222-4222-8222-222222222222', modId: candidate.manifest.id, contentHash: candidate.contentHash, capability: 'engine.dispatch', resources: ['test-engine'], decision: 'allow', grantedAt: '2026-09-03T00:00:00.000Z', grantedBy: 'local-user', reason: 'test' };
    const registry = new ModRegistry({ generation: 's8-engine-abort', activeOwners: [{ id: candidate.manifest.id, version: candidate.manifest.version, contentHash: candidate.contentHash }] });
    let signalSeen: AbortSignal | undefined; let dispatchStarted!: () => void;
    const started = new Promise<void>((resolve) => { dispatchStarted = resolve; });
    const activated = await activateTrustedFolderMod({ candidate, publisher, trustRecords: [accepted], grantRecords: [grant], registry, services: services(), capabilityRuntime: {
      dispatchEngine: async (_engine, _prompt, context) => { signalSeen = context.signal; dispatchStarted(); await new Promise((_resolve, reject) => context.signal.addEventListener('abort', () => reject(new Error('host dispatch aborted')), { once: true })); return {}; },
    } });
    const command = registry.project('cli').entries[0]!.payload as CommandContribution;
    const controller = new AbortController();
    const context: InvocationContext = { invocationId: 'engine-abort', cwd: candidate.sourceLocator, platform: `${process.platform}-${process.arch}` as ModPlatform, signal: controller.signal, config: {} };
    const invocation = Promise.resolve(command.run({}, context));
    await started; controller.abort();
    await expect(invocation).rejects.toThrow(/aborted/);
    expect(signalSeen).toBe(controller.signal); expect(signalSeen?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 75));
    await activated.dispose();
  });

  it('propagates invocation cancellation and fail-stops the per-mod worker', async () => {
    const markerRoot = await mkdtemp(join(tmpdir(), 'agon-s8-worker-cancel-'));
    const markerPath = join(markerRoot, 'observed-abort');
    const base = manifest(identity.modId);
    const candidate = await executableFixture(identity.modId, `
import { writeFileSync } from 'node:fs';
export default () => ({ apiVersion: '1', activate(registrar) {
  registrar.command('cli', { id: 'wait-for-abort', aliases: [], description: 'wait', inputSchema: { type: 'object' },
    run(_input, context) { return new Promise((_resolve, reject) => {
      context.signal.addEventListener('abort', () => { writeFileSync(${JSON.stringify(markerPath)}, 'observed'); reject(new Error('mod observed abort')); }, { once: true });
    }); }
  });
} });
`, { contributes: { ...base.contributes, cliCommands: [{ id: 'wait-for-abort', aliases: [] }] } });
    const accepted: TrustRecord = { ...trust('trusted', '2026-09-03T00:00:00.000Z', '11111111-1111-4111-8111-111111111111'), sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash };
    const registry = new ModRegistry({ generation: 's8-worker-cancel', activeOwners: [{ id: candidate.manifest.id, version: candidate.manifest.version, contentHash: candidate.contentHash }] });
    const activated = await activateTrustedFolderMod({ candidate, publisher, trustRecords: [accepted], grantRecords: [], registry, services: services() });
    const command = registry.project('cli').entries[0]!.payload as CommandContribution;
    const controller = new AbortController();
    const context: InvocationContext = { invocationId: 'cancel-test', cwd: markerRoot, platform: `${process.platform}-${process.arch}` as ModPlatform, signal: controller.signal, config: {} };
    const invocation = Promise.resolve(command.run({}, context));
    controller.abort();
    await expect(invocation).rejects.toThrow(/aborted/);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { if (await readFile(markerPath, 'utf8') === 'observed') break; } catch { /* worker has one bounded grace window */ }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(await readFile(markerPath, 'utf8')).toBe('observed');
    await new Promise((resolve) => setTimeout(resolve, 75));
    await expect(Promise.resolve(command.run({}, { ...context, signal: new AbortController().signal }))).rejects.toThrow(/unavailable|terminated/);
    await activated.dispose();
  });

  it('kills a sacrificial worker when synchronous third-party factory code never yields', async () => {
    const candidate = await executableFixture(identity.modId, 'export default () => { while (true) {} };\n');
    const accepted: TrustRecord = { ...trust('trusted', '2026-09-03T00:00:00.000Z', '11111111-1111-4111-8111-111111111111'), sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash };
    const registry = new ModRegistry({ generation: 's8-worker-timeout', activeOwners: [{ id: candidate.manifest.id, version: candidate.manifest.version, contentHash: candidate.contentHash }] });
    const started = Date.now();
    await expect(activateTrustedFolderMod({ candidate, publisher, trustRecords: [accepted], grantRecords: [], registry, services: services(), timeoutMs: 50 })).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(2_000); expect(registry.project('cli').entries).toEqual([]);
  });

  it('kills a sacrificial worker when synchronous activation code never yields', async () => {
    const candidate = await executableFixture(identity.modId, "export default () => ({ apiVersion: '1', activate() { while (true) {} } });\n");
    const accepted: TrustRecord = { ...trust('trusted', '2026-09-03T00:00:00.000Z', '11111111-1111-4111-8111-111111111111'), sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash };
    const registry = new ModRegistry({ generation: 's8-worker-activation-timeout', activeOwners: [{ id: candidate.manifest.id, version: candidate.manifest.version, contentHash: candidate.contentHash }] });
    await expect(activateTrustedFolderMod({ candidate, publisher, trustRecords: [accepted], grantRecords: [], registry, services: services(), timeoutMs: 50 })).rejects.toThrow(/timed out/);
    expect(registry.project('cli').entries).toEqual([]);
  });

  it('times out a stalled import and never leaves registered contributions', async () => {
    const candidate = await executableFixture();
    const accepted: TrustRecord = { ...trust('trusted', '2026-09-03T00:00:00.000Z', '11111111-1111-4111-8111-111111111111'), sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash };
    const registry = new ModRegistry({ generation: 's8-timeout', activeOwners: [{ id: candidate.manifest.id, version: candidate.manifest.version, contentHash: candidate.contentHash }] });
    await expect(activateTrustedFolderMod({ candidate, publisher, trustRecords: [accepted], grantRecords: [], registry, services: services(), timeoutMs: 5, importModule: async () => new Promise(() => undefined) })).rejects.toThrow(/timed out/);
    expect(registry.project('cli').entries).toEqual([]);
  });
});
