import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CommandContribution, InvocationContext, ModPlatform } from '@kernlang/agon-mod-api';
import {
  ExternalActivationStore,
  SurfaceGenerationError,
  TrustGrantStore,
  bootstrapFirstPartySurfaceGeneration,
  inspectFolderMod,
  sha256Canonical,
  type FolderModCandidate,
  type GeneratedSurfaceRuntime,
} from '../../packages/mod-kernel/src/index.js';

const runtime: GeneratedSurfaceRuntime = {
  command: () => ({ exitCode: 0 }), tool: () => ({}), parseIntent: () => undefined,
  renderDocs: (id) => ({ text: id }),
};

function manifest(id: string, commandId: string) {
  return {
    schemaVersion: 2, id, name: id, version: '1.0.0', apiRange: '>=1 <2', execution: 'executable',
    compatibility: { kernelRange: '>=0.0.0-0 <2', nodeRange: '>=22' }, packageClass: 'user-toggleable-mod-package',
    entrypoints: { runtime: 'dist/index.js', types: 'dist/index.d.ts' }, display: { group: 'Community tests', order: 1 },
    dependencies: { required: [], optional: [], conflicts: [] }, permissions: [],
    platforms: ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'], assets: [],
    contributes: { cliCommands: [{ id: commandId, aliases: [] }], tuiActions: [], mcpTools: [], cesarTools: [],
      lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [] },
    pack: { include: ['agon.mod.json', 'package.json', 'dist/index.js', 'dist/index.d.ts'], executable: [] },
  };
}

async function writeMod(modsRoot: string, folder: string, id: string, commandId: string, runtimeSource: string) {
  const root = join(modsRoot, folder);
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'agon.mod.json'), JSON.stringify(manifest(id, commandId)));
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(join(root, 'dist/index.d.ts'), 'export {};\n');
  await writeFile(join(root, 'dist/index.js'), runtimeSource);
  return inspectFolderMod(root);
}

async function authorize(hostRoot: string, candidate: FolderModCandidate, timestamp: number) {
  const publisher = { registryOrigin: 'local-user-folder', packageName: candidate.manifest.id,
    provenanceIdentity: 'local-user', provenanceStatus: 'not-applicable' } as const;
  const trust = new TrustGrantStore(hostRoot);
  const trustPlan = trust.previewTrust({ modId: candidate.manifest.id, version: candidate.manifest.version,
    source: candidate.source, sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash,
    manifestHash: candidate.manifestHash, decision: 'trusted', decidedAt: new Date(timestamp).toISOString(),
    scope: 'exact-artifact', publisher, reason: 'bootstrap isolation test' });
  await trust.apply(trustPlan, { approvedPlanHash: trustPlan.planHash });
  const activation = new ExternalActivationStore(hostRoot);
  const activationPlan = activation.preview({ modId: candidate.manifest.id, version: candidate.manifest.version,
    source: candidate.source, sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash,
    manifestHash: candidate.manifestHash, publisherHash: sha256Canonical(publisher) }, true,
  'bootstrap isolation test', new Date(timestamp + 1).toISOString());
  await activation.apply(activationPlan, activationPlan.planHash);
}

describe('S8 process bootstrap failure isolation', () => {
  it('keeps a healthy trusted mod callable when its sibling throws during activation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-bootstrap-isolation-'));
    const hostRoot = join(root, 'host');
    const modsRoot = join(root, 'mods');
    const broken = await writeMod(modsRoot, 'broken', 'example.broken-mod', 'broken-command', `
export default function () { return { apiVersion: '1', async activate() { throw new Error('broken activation sentinel'); } }; }
`);
    const healthy = await writeMod(modsRoot, 'healthy', 'example.healthy-mod', 'healthy-command', `
export default function () { return { apiVersion: '1', async activate(registrar) {
  registrar.command('cli', { id: 'healthy-command', aliases: [], description: 'healthy', inputSchema: { type: 'object' },
    async run() { return { exitCode: 0, result: { healthy: true } }; } });
} }; }
`);
    await authorize(hostRoot, broken, Date.UTC(2026, 8, 4, 0, 0, 0));
    await authorize(hostRoot, healthy, Date.UTC(2026, 8, 4, 0, 0, 2));

    const boot = await bootstrapFirstPartySurfaceGeneration({ hostRoot, modsRoot, runtime });
    expect(boot.externalDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EXTERNAL_ACTIVATION_FAILED', details: expect.objectContaining({ modId: 'example.broken-mod' }) }),
    ]));
    expect(() => boot.activated.generation.assertAvailable('cli', 'broken-command')).toThrow(SurfaceGenerationError);
    expect(await new ExternalActivationStore(hostRoot).readFailures()).toEqual(expect.arrayContaining([
      expect.objectContaining({ modId: 'example.broken-mod', phase: 'activation', code: 'EXTERNAL_ACTIVATION_FAILED' }),
    ]));
    expect(boot.activated.generation.catalog('cli').map(({ publicId }) => publicId)).not.toContain('broken-command');
    const healthyRecord = boot.activated.generation.assertAvailable('cli', 'healthy-command');
    const context: InvocationContext = { invocationId: 'bootstrap-isolation', cwd: root,
      platform: `${process.platform}-${process.arch}` as ModPlatform, signal: new AbortController().signal, config: {} };
    await expect((healthyRecord.payload as CommandContribution).run({}, context)).resolves.toMatchObject({ result: { healthy: true } });
    await boot.activated.dispose();
  });
  it('isolates an external public-name collision before generation construction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s8-bootstrap-collision-'));
    const hostRoot = join(root, 'host'); const modsRoot = join(root, 'mods');
    const collision = await writeMod(modsRoot, 'collision', 'example.collision-mod', 'ask', `
export default function () { return { apiVersion: '1', activate(registrar) {
  registrar.command('cli', { id: 'ask', aliases: [], description: 'collision', inputSchema: { type: 'object' }, async run() { return { exitCode: 0 }; } });
} }; }
`);
    const healthy = await writeMod(modsRoot, 'healthy', 'example.collision-healthy', 'collision-healthy', `
export default function () { return { apiVersion: '1', activate(registrar) {
  registrar.command('cli', { id: 'collision-healthy', aliases: [], description: 'healthy', inputSchema: { type: 'object' }, async run() { return { exitCode: 0 }; } });
} }; }
`);
    await authorize(hostRoot, collision, Date.UTC(2026, 8, 4, 1, 0, 0));
    await authorize(hostRoot, healthy, Date.UTC(2026, 8, 4, 1, 0, 2));
    const boot = await bootstrapFirstPartySurfaceGeneration({ hostRoot, modsRoot, runtime });
    expect(boot.externalDiagnostics).toEqual(expect.arrayContaining([expect.objectContaining({
      code: 'EXTERNAL_ACTIVATION_FAILED', details: expect.objectContaining({ modId: 'example.collision-mod' }),
    })]));
    expect(boot.activated.generation.assertAvailable('cli', 'collision-healthy')).toBeDefined();
    expect(await new ExternalActivationStore(hostRoot).readFailures()).toEqual(expect.arrayContaining([
      expect.objectContaining({ modId: 'example.collision-mod', phase: 'catalog', code: 'EXTERNAL_ACTIVATION_FAILED' }),
    ]));
    expect(boot.activated.generation.catalog('cli').filter(({ publicId }) => publicId === 'ask')).toHaveLength(1);
    await boot.activated.dispose();
  });

});
