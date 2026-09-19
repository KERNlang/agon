import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandContribution, InvocationContext, ModPlatform } from '@kernlang/agon-mod-api';
import {
  ExternalActivationStore,
  SurfaceGenerationError,
  TrustGrantStore,
  bootstrapFirstPartySurfaceGeneration,
  inspectFolderMod,
  sha256Canonical,
  type GeneratedSurfaceRuntime,
} from '../../packages/mod-kernel/src/index.js';
import { detectIntent } from '../../packages/cli/src/signals/intent.js';

const marker = '__agonS8FolderModImported';

async function fixture(engineDispatch = false) {
  const root = await mkdtemp(join(tmpdir(), 'agon-s8-bootstrap-'));
  const hostRoot = join(root, 'modular-host');
  const modsRoot = join(root, 'mods');
  const packageRoot = join(modsRoot, 'hello');
  await mkdir(join(packageRoot, 'dist'), { recursive: true });
  const manifest = {
    schemaVersion: 2,
    id: 'example.bootstrap-mod',
    name: 'Bootstrap test mod',
    version: '1.0.0',
    apiRange: '>=1 <2',
    execution: 'executable',
    compatibility: { kernelRange: '>=0.0.0-0 <2', nodeRange: '>=22' },
    packageClass: 'user-toggleable-mod-package',
    entrypoints: { runtime: 'dist/index.js', types: 'dist/index.d.ts' },
    display: { group: 'Community tests', order: 1 },
    dependencies: { required: [], optional: [], conflicts: [] },
    permissions: engineDispatch ? [{ capability: 'engine.dispatch', resources: ['test-engine'], required: true }] : [],
    platforms: ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'],
    assets: [],
    contributes: {
      cliCommands: [{ id: 'bootstrap-hello', aliases: [] }],
      tuiActions: [{ id: 'bootstrap-wave', aliases: ['bootstrap-hi'] }], mcpTools: [], cesarTools: [], lifecycleHooks: [],
      resultTypes: [], configKeys: [], generatedDocs: [],
    },
    pack: { include: ['agon.mod.json', 'package.json', 'dist/index.js', 'dist/index.d.ts'], executable: [] },
  };
  await writeFile(join(packageRoot, 'agon.mod.json'), JSON.stringify(manifest));
  await writeFile(join(packageRoot, 'dist/index.d.ts'), 'export {};\n');
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(join(packageRoot, 'dist/index.js'), `
globalThis.${marker} = (globalThis.${marker} ?? 0) + 1;
export default function (services) {
  return { apiVersion: '1', async activate(registrar) {
    registrar.command('cli', { id: 'bootstrap-hello', aliases: [], description: 'hello',
      inputSchema: { type: 'object' }, async run(_input, context) { return { exitCode: 0, result: ${engineDispatch ? "await services.engines.dispatch('test-engine', 'fixture prompt', { ...context, cwd: '/spoofed-context' }, { textOnly: true, timeoutSeconds: 17, systemPrompt: 'fixture system', mode: 'review' })" : '{ ok: true }'} }; } });
    registrar.command('tui', { id: 'bootstrap-wave', aliases: ['bootstrap-hi'], description: 'wave',
      inputSchema: { type: 'object' }, async run() { return { exitCode: 0, result: { waved: true } }; } });
  } };
}
`);
  return { root, hostRoot, modsRoot, packageRoot };
}

const runtime: GeneratedSurfaceRuntime = {
  command: () => ({ exitCode: 0 }),
  tool: () => ({}),
  parseIntent: () => undefined,
  renderDocs: (id) => ({ text: id }),
};

afterEach(() => { delete (globalThis as Record<string, unknown>)[marker]; });

describe('S8 folder mod process bootstrap', () => {
    expect(detectIntent('/bootstrap-wave hello', undefined, new Set(['bootstrap-wave', 'bootstrap-hi'])))
      .toMatchObject({ type: 'mod-surface-command', commandName: 'bootstrap-wave', args: 'hello' });
    expect(detectIntent('/bootstrap-hi there', undefined, new Set(['bootstrap-wave', 'bootstrap-hi']))).toMatchObject({ type: 'mod-surface-command', commandName: 'bootstrap-hi' });
  it('loads an exactly trusted physical folder mod into the generated registry', async () => {
    const paths = await fixture();
    const candidate = await inspectFolderMod(paths.packageRoot);
    const store = new TrustGrantStore(paths.hostRoot);
    const plan = store.previewTrust({
      modId: candidate.manifest.id, version: candidate.manifest.version, source: candidate.source,
      sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash,
      decision: 'trusted', decidedAt: '2026-09-03T00:00:00.000Z', scope: 'exact-artifact',
      publisher: { registryOrigin: 'local-user-folder', packageName: candidate.manifest.id,
        provenanceIdentity: 'local-user', provenanceStatus: 'not-applicable' }, reason: 'test',
    });
    await store.apply(plan, { approvedPlanHash: plan.planHash });
    const activation = new ExternalActivationStore(paths.hostRoot);
    const activationPlan = activation.preview({ modId: candidate.manifest.id, version: candidate.manifest.version,
      source: candidate.source, sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash,
      publisherHash: sha256Canonical({ registryOrigin: 'local-user-folder', packageName: candidate.manifest.id, provenanceIdentity: 'local-user', provenanceStatus: 'not-applicable' }) }, true, 'test', '2026-09-03T00:00:01.000Z');
    await activation.apply(activationPlan, activationPlan.planHash);
    const boot = await bootstrapFirstPartySurfaceGeneration({ hostRoot: paths.hostRoot, modsRoot: paths.modsRoot, runtime });
    const record = boot.activated.generation.assertAvailable('cli', 'bootstrap-hello');
    expect(boot.activated.generation.assertAvailable('tui', '/bootstrap-wave').owner.id).toBe('example.bootstrap-mod');
    const context: InvocationContext = { invocationId: 'test', cwd: paths.root,
      platform: `${process.platform}-${process.arch}` as ModPlatform, signal: new AbortController().signal, config: {} };
    const output = await (record.payload as CommandContribution).run({}, context);
    expect(Symbol.asyncIterator in Object(output)).toBe(false);
    expect(output).toMatchObject({ exitCode: 0, result: { ok: true } });
    // Production activation is isolated: the mod's global write stays inside the worker.
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
    await boot.activated.dispose();
  });

  it('imports no third-party runtime in kernel-only safe mode', async () => {
    const paths = await fixture();
    const boot = await bootstrapFirstPartySurfaceGeneration({ hostRoot: paths.hostRoot, modsRoot: paths.modsRoot, runtime, safeMode: true });
    expect(() => boot.activated.generation.assertAvailable('cli', 'bootstrap-hello')).toThrow(SurfaceGenerationError);
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
    await boot.activated.dispose();
  });

  it('wires granted engine dispatch to the host and enforces live revocation', async () => {
    const paths = await fixture(true);
    const candidate = await inspectFolderMod(paths.packageRoot);
    const store = new TrustGrantStore(paths.hostRoot);
    const publisher = { registryOrigin: 'local-user-folder', packageName: candidate.manifest.id,
      provenanceIdentity: 'local-user', provenanceStatus: 'not-applicable' as const };
    const identity = { modId: candidate.manifest.id, version: candidate.manifest.version, source: candidate.source,
      sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash };
    const trust = store.previewTrust({ ...identity, decision: 'trusted', decidedAt: '2026-09-05T00:00:00Z', scope: 'exact-artifact', publisher, reason: 'fixture' });
    await store.apply(trust, { approvedPlanHash: trust.planHash });
    const grantInput = { modId: identity.modId, contentHash: identity.contentHash, capability: 'engine.dispatch',
      resources: ['test-engine'], grantedAt: '2026-09-05T00:00:01Z', grantedBy: 'local-user' as const, reason: 'fixture' };
    const grant = store.previewGrant({ ...grantInput, decision: 'allow' });
    await store.apply(grant, { approvedPlanHash: grant.planHash });
    const activation = new ExternalActivationStore(paths.hostRoot);
    const plan = activation.preview({ ...identity, publisherHash: sha256Canonical(publisher) }, true, 'fixture', '2026-09-05T00:00:02Z');
    await activation.apply(plan, plan.planHash);
    let calls = 0;
    const boot = await bootstrapFirstPartySurfaceGeneration({ ...paths,
      runtime: { ...runtime, tool: () => { throw new Error('compatibility stub must not dispatch engines'); } },
      dispatchEngine: async (id, prompt, context, options) => {
        calls++;
        expect(id).toBe('test-engine');
        expect(prompt).toBe('fixture prompt');
        expect(context.cwd).toBe(paths.root);
        expect(options).toEqual({ textOnly: true, timeoutSeconds: 17, systemPrompt: 'fixture system', mode: 'review' });
        return { answer: 'fixture-ok' };
      },
    });
    try {
      const command = boot.activated.generation.assertAvailable('cli', 'bootstrap-hello').payload as CommandContribution;
      const context: InvocationContext = { invocationId: 'test', cwd: paths.root,
        platform: `${process.platform}-${process.arch}` as ModPlatform, signal: new AbortController().signal, config: {} };
      await expect(command.run({}, context)).resolves.toMatchObject({ exitCode: 0, result: { answer: 'fixture-ok' } });
      expect(calls).toBe(1);
      const revoked = store.previewGrant({ ...grantInput, grantedAt: '2026-09-05T00:00:03Z', decision: 'deny' });
      await store.apply(revoked, { approvedPlanHash: revoked.planHash });
      await expect(command.run({}, context)).rejects.toThrow();
      expect(calls).toBe(1);
    } finally { await boot.activated.dispose(); }
  });
});
