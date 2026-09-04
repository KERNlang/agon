import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExternalActivationStore } from '../../packages/mod-kernel/src/external-activation-state.js';
import { inspectFolderMod } from '../../packages/mod-kernel/src/folder-mods.js';
import { TrustGrantStore } from '../../packages/mod-kernel/src/trust-authority.js';
import { sha256Canonical } from '../../packages/mod-kernel/src/lock.js';
import { createCesarToolRegistry } from '../../packages/cli/src/cesar/tools.js';
import { disposeProcessSurfaceAuthority, initializeProcessSurfaceAuthority, processSurfacePublicIds } from '../../packages/cli/src/surface-authority-runtime.js';
import { activeMcpSurfaceTools, disposeMcpSurfaceAuthority, initializeMcpSurfaceAuthority, invokeActiveMcpSurfaceTool } from '../../packages/mcp/src/surface-authority.js';
import { manifest } from '../helpers/modular-agon.js';

const marker = '__agonS8ExternalSurfacesImported';
function activationIdentity(candidate: Awaited<ReturnType<typeof inspectFolderMod>>) {
  return { modId: candidate.manifest.id, version: candidate.manifest.version, source: candidate.source,
    sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash,
    publisherHash: sha256Canonical({ registryOrigin: 'local-user-folder', packageName: candidate.manifest.id,
      provenanceIdentity: 'local-user', provenanceStatus: 'not-applicable' }) };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'agon-s8-external-surfaces-'));
  const hostRoot = join(root, 'modular-host'); const packageRoot = join(root, 'mods', 'surface');
  await mkdir(join(packageRoot, 'dist'), { recursive: true });
  const shape = manifest('example.surfaces', '1.0.0', { compatibility: { kernelRange: '>=0.2.0 <1', nodeRange: '>=22 <27' }, contributes: {
    cliCommands: [], tuiActions: [], mcpTools: [{ id: 'ExternalMcp', aliases: ['external-mcp-alias'] }],
    cesarTools: [{ id: 'ExternalCesar', aliases: ['external-cesar-alias'] }], lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [],
  } });
  await writeFile(join(packageRoot, 'agon.mod.json'), JSON.stringify(shape));
  await writeFile(join(packageRoot, 'dist/index.d.ts'), 'export {};\n');
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(join(packageRoot, 'dist/index.js'), `
globalThis.${marker} = (globalThis.${marker} ?? 0) + 1;
export default async () => ({ apiVersion: '1', activate(registrar) {
  registrar.tool('mcp', { id: 'ExternalMcp', aliases: ['external-mcp-alias'], description: 'external mcp', inputSchema: { type: 'object', required: ['value'], properties: { value: { type: 'integer' } }, additionalProperties: false }, effect: 'read', async run(input) { return { source: 'mcp', input }; } });
  registrar.tool('cesar', { id: 'ExternalCesar', aliases: ['external-cesar-alias'], description: 'external cesar', inputSchema: { type: 'object', required: ['value'], properties: { value: { type: 'integer' } }, additionalProperties: false }, effect: 'read', async run(input) { return { source: 'cesar', input }; } });
} });`);
  const candidate = await inspectFolderMod(packageRoot); const store = new TrustGrantStore(hostRoot);
  const trust = store.previewTrust({ modId: shape.id, version: shape.version, source: candidate.source,
    sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash,
    decision: 'trusted', decidedAt: '2026-09-04T00:00:00.000Z', scope: 'exact-artifact',
    publisher: { registryOrigin: 'local-user-folder', packageName: shape.id, provenanceIdentity: 'local-user', provenanceStatus: 'not-applicable' }, reason: 'test' });
  await store.apply(trust, { approvedPlanHash: trust.planHash });
  const activation = new ExternalActivationStore(hostRoot); const plan = activation.preview(activationIdentity(candidate), true, 'test', '2026-09-04T00:00:01.000Z');
  await activation.apply(plan, plan.planHash); return { root, hostRoot, candidate };
}

afterEach(async () => {
  await disposeMcpSurfaceAuthority(); await disposeProcessSurfaceAuthority();
  delete process.env.AGON_MODULAR_HOST_ROOT; delete process.env.AGON_MOD_SAFE_MODE;
  delete (globalThis as Record<string, unknown>)[marker];
});

describe.sequential('S8 external generated surface execution', () => {
  it('lists and invokes external MCP and Cesar tools from the active registry', async () => {
    const paths = await fixture(); process.env.AGON_MODULAR_HOST_ROOT = paths.hostRoot;
    await initializeMcpSurfaceAuthority();
    expect(activeMcpSurfaceTools().map(({ name }) => name)).toEqual(expect.arrayContaining(['ExternalMcp', 'external-mcp-alias']));
    await expect(invokeActiveMcpSurfaceTool('external-mcp-alias', { value: 1 })).resolves.toEqual({ source: 'mcp', input: { value: 1 } });
    await expect(invokeActiveMcpSurfaceTool('ExternalMcp', { value: 'wrong' })).rejects.toThrow(/input does not match its schema/);
    await initializeProcessSurfaceAuthority(paths.hostRoot); const registry = createCesarToolRegistry();
    const handler = registry.get('external-cesar-alias'); expect(handler).toBeDefined();
    expect(handler!.validate({ value: 'wrong' })).toMatch(/input does not match its schema/);
    await expect(handler!.execute({ value: 2 }, { cwd: paths.root, readFileState: new Map(), abortSignal: new AbortController().signal })).resolves.toMatchObject({ ok: true, content: '{"source":"cesar","input":{"value":2}}' });
  });

  it('propagates kernel-only safe mode into the MCP host before import', async () => {
    const paths = await fixture(); process.env.AGON_MODULAR_HOST_ROOT = paths.hostRoot; process.env.AGON_MOD_SAFE_MODE = '1';
    await initializeMcpSurfaceAuthority();
    expect(activeMcpSurfaceTools().map(({ name }) => name)).not.toContain('ExternalMcp');
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
  });
});

  it('removes disabled external tools from both generated surfaces after restart', async () => {
    const paths = await fixture();
    const activation = new ExternalActivationStore(paths.hostRoot);
    const disable = activation.preview(activationIdentity(paths.candidate), false, 'test disable', '2026-09-04T00:00:02.000Z');
    await activation.apply(disable, disable.planHash); process.env.AGON_MODULAR_HOST_ROOT = paths.hostRoot;
    expect(await activation.enabled(activationIdentity(paths.candidate))).toBe(false);
    await initializeMcpSurfaceAuthority(); expect(activeMcpSurfaceTools().map(({ name }) => name)).not.toContain('ExternalMcp');
    await initializeProcessSurfaceAuthority(paths.hostRoot); expect(createCesarToolRegistry().has('ExternalCesar')).toBe(false);
  });

  it('fails stale MCP and Cesar clients closed after the canonical generation changes', async () => {
    const paths = await fixture(); process.env.AGON_MODULAR_HOST_ROOT = paths.hostRoot;
    await initializeMcpSurfaceAuthority(); await initializeProcessSurfaceAuthority(paths.hostRoot);
    const captured = createCesarToolRegistry().get('ExternalCesar')!;
    await writeFile(join(paths.hostRoot, 'current-generation.json'), '{}');
    expect(() => activeMcpSurfaceTools()).toThrow(/generation changed|became unreadable/);
    await expect(captured.execute({ value: 1 }, { cwd: paths.root, readFileState: new Map(), abortSignal: new AbortController().signal })).rejects.toThrow(/generation changed|became unreadable/);
    expect(() => processSurfacePublicIds('cesar')).toThrow(/generation changed|became unreadable/);
  });
