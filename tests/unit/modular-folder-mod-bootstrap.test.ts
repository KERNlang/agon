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

async function fixture() {
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
    permissions: [],
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
export default function () {
  return { apiVersion: '1', async activate(registrar) {
    registrar.command('cli', { id: 'bootstrap-hello', aliases: [], description: 'hello',
      inputSchema: { type: 'object' }, async run() { return { exitCode: 0, result: { ok: true } }; } });
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
});
