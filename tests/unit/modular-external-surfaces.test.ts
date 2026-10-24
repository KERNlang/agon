import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeneratedLazySubCommands } from '../../packages/cli/src/lazy-commands.js';
import { ExternalActivationStore } from '../../packages/mod-kernel/src/external-activation-state.js';
import { inspectFolderMod } from '../../packages/mod-kernel/src/folder-mods.js';
import { TrustGrantStore } from '../../packages/mod-kernel/src/trust-authority.js';
import { sha256Canonical } from '../../packages/mod-kernel/src/lock.js';
import { createCesarToolRegistry } from '../../packages/cli/src/cesar/tools.js';
import { disposeProcessSurfaceAuthority, executeProcessCesarRoute, initializeProcessSurfaceAuthority, processSurfaceCatalog, processSurfacePublicIds } from '../../packages/cli/src/surface-authority-runtime.js';
import { activeMcpSurfaceTools, disposeMcpSurfaceAuthority, initializeMcpSurfaceAuthority, invokeActiveMcpSurfaceTool } from '../../packages/mcp/src/surface-authority.js';
import { manifest } from '../helpers/modular-agon.js';

const marker = '__agonS8ExternalSurfacesImported';
function activationIdentity(candidate: Awaited<ReturnType<typeof inspectFolderMod>>) {
  return { modId: candidate.manifest.id, version: candidate.manifest.version, source: candidate.source,
    sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash,
    publisherHash: sha256Canonical({ registryOrigin: 'local-user-folder', packageName: candidate.manifest.id,
      provenanceIdentity: 'local-user', provenanceStatus: 'not-applicable' }) };
}
async function fixture(captureSettings = false) {
  const root = await mkdtemp(join(tmpdir(), 'agon-s8-external-surfaces-'));
  const hostRoot = join(root, 'modular-host'); const packageRoot = join(root, 'mods', 'surface');
  await mkdir(join(packageRoot, 'dist'), { recursive: true });
  const shape = manifest('example.surfaces', '1.0.0', { compatibility: { kernelRange: '>=1 <2', nodeRange: '>=22 <27' }, contributes: {
    cliCommands: [{ id: 'external-settings', aliases: [] }], tuiActions: [], mcpTools: [{ id: 'ExternalMcp', aliases: ['external-mcp-alias'] }],
    cesarTools: [{ id: 'ExternalCesar', aliases: ['external-cesar-alias'] }], lifecycleHooks: [], resultTypes: [], configKeys: captureSettings ? [{ id: 'example.surfaces', aliases: [] }] : [], generatedDocs: [],
  } });
  await writeFile(join(packageRoot, 'agon.mod.json'), JSON.stringify(shape));
  await writeFile(join(packageRoot, 'dist/index.d.ts'), 'export {};\n');
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(join(packageRoot, 'dist/index.js'), `
globalThis.${marker} = (globalThis.${marker} ?? 0) + 1;
export default async () => ({ apiVersion: '1', activate(registrar) {
  if (${captureSettings}) registrar.config('example.surfaces', { type: 'object', properties: { value: { type: 'string' }, mode: { type: 'string', default: 'schema default' } }, additionalProperties: true });
  registrar.command('cli', { id: 'external-settings', description: 'inspect own settings', inputSchema: { type: 'object' }, async run(input, context) { return { exitCode: 0, stdout: JSON.stringify(context.config) }; } });
  registrar.tool('mcp', { id: 'ExternalMcp', aliases: ['external-mcp-alias'], description: 'external mcp', inputSchema: { type: 'object', required: ['value'], properties: { value: { type: 'integer' } }, additionalProperties: false }, effect: 'read', async run(input, context) { return { source: 'mcp', input, ...(${captureSettings} ? { config: context.config } : {}) }; } });
  registrar.tool('cesar', { id: 'ExternalCesar', aliases: ['external-cesar-alias'], description: 'external cesar', inputSchema: { type: 'object', required: ['value'], properties: { value: { type: 'integer' } }, additionalProperties: false }, effect: 'read', async run(input, context) { return { source: 'cesar', input, ...(${captureSettings} ? { config: context.config } : {}) }; } });
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
  vi.restoreAllMocks(); vi.unstubAllEnvs();
});

describe.sequential('S8 external generated surface execution', () => {
  it('rejects schema-invalid owner values through CLI, MCP and Cesar without exposing values', async () => {
    const paths = await fixture(true);
    vi.stubEnv('AGON_HOME', paths.root); vi.stubEnv('AGON_CWD', paths.root);
    process.env.AGON_MODULAR_HOST_ROOT = paths.hostRoot;
    await writeFile(join(paths.root, 'config.json'), JSON.stringify({ mods: {
      'example.surfaces': { value: { privateValue: 'must not appear in errors' } },
    } }));
    await initializeProcessSurfaceAuthority(paths.hostRoot);
    await initializeMcpSurfaceAuthority();
    vi.spyOn(process, 'cwd').mockReturnValue(paths.root);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const command = createGeneratedLazySubCommands()['external-settings'] as { run(context: unknown): Promise<void> };
    const tool = createCesarToolRegistry().get('ExternalCesar')!;
    for (const invoke of [
      () => command.run({ args: {} }),
      () => invokeActiveMcpSurfaceTool('ExternalMcp', { value: 1 }),
      () => tool.execute({ value: 1 }, { cwd: paths.root, readFileState: new Map() }),
    ]) {
      await expect(invoke()).rejects.toThrow(/mod settings for example\.surfaces are invalid/);
      await expect(invoke()).rejects.not.toThrow(/must not appear in errors/);
    }
    expect(write).not.toHaveBeenCalled();
  });
  it('rejects malformed selected settings before any of the four invocation paths runs', async () => {
    const paths = await fixture(true);
    vi.stubEnv('AGON_HOME', paths.root); vi.stubEnv('AGON_CWD', paths.root);
    process.env.AGON_MODULAR_HOST_ROOT = paths.hostRoot;
    await writeFile(join(paths.root, 'config.json'), JSON.stringify({ mods: { 'example.surfaces': null, 'agon.agent': [] } }));
    const dispatch = vi.fn(async () => ({ exitCode: 0, stdout: 'must not execute' }));
    await initializeProcessSurfaceAuthority(paths.hostRoot, (manifest, services) => manifest.id === 'agon.agent'
      ? { ...services, engines: { dispatch } } : services);
    await initializeMcpSurfaceAuthority();
    await expect(invokeActiveMcpSurfaceTool('ExternalMcp', { value: 1 })).rejects.toThrow(/mod settings/);
    const tool = createCesarToolRegistry().get('ExternalCesar')!;
    await expect(tool.execute({ value: 1 }, { cwd: paths.root, readFileState: new Map() })).rejects.toThrow(/mod settings/);
    vi.spyOn(process, 'cwd').mockReturnValue(paths.root);
    const command = createGeneratedLazySubCommands()['external-settings'] as { run(context: unknown): Promise<void> };
    await expect(command.run({ args: {} })).rejects.toThrow(/mod settings/);
    const route = processSurfaceCatalog('cesar').find(entry => entry.kind === 'plan-step' && entry.owner.id === 'agon.agent')!;
    await expect(executeProcessCesarRoute(route.publicId, { task: 'fixture task', engine: 'fixture' }, { cwd: paths.root, signal: new AbortController().signal })).rejects.toThrow(/mod settings/);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('passes the selected first-party route owner settings to its injected engine', async () => {
    const paths = await fixture();
    vi.stubEnv('AGON_HOME', paths.root);
    await writeFile(join(paths.root, 'config.json'), JSON.stringify({ mods: { 'agon.agent': { selected: true }, 'agon.forge': { other: true } } }));
    const dispatch = vi.fn(async () => ({ exitCode: 0, stdout: 'fixture response' }));
    await initializeProcessSurfaceAuthority(paths.hostRoot, (manifest, services) => manifest.id === 'agon.agent'
      ? { ...services, engines: { dispatch } } : services);
    const route = processSurfaceCatalog('cesar').find(entry => entry.kind === 'plan-step' && entry.owner.id === 'agon.agent')!;
    await executeProcessCesarRoute(route.publicId, { task: 'fixture task', engine: 'fixture' }, { cwd: paths.root, signal: new AbortController().signal });
    expect(dispatch).toHaveBeenCalledWith('fixture', expect.any(String), expect.objectContaining({ config: { selected: true, cesarAgenticContinuationLimit: 12 } }), expect.anything());
  });
  it('delivers only layered owner settings through CLI, MCP and Cesar', async () => {
    const paths = await fixture(true);
    const project = join(paths.root, 'project');
    await mkdir(project);
    vi.stubEnv('AGON_HOME', paths.root); vi.stubEnv('AGON_CWD', project);
    process.env.AGON_MODULAR_HOST_ROOT = paths.hostRoot;
    await writeFile(join(paths.root, 'config.json'), JSON.stringify({ hostPrivate: 'private', mods: {
      'example.surfaces': { inherited: true, value: 'global' }, 'example.other': { secret: 'other' },
    } }));
    await writeFile(join(project, '.agon.json'), JSON.stringify({ mods: { 'example.surfaces': { value: 'project' } } }));
    const expected = { inherited: true, value: 'project', mode: 'schema default' };
    await initializeMcpSurfaceAuthority();
    await expect(invokeActiveMcpSurfaceTool('ExternalMcp', { value: 1 })).resolves.toEqual({ source: 'mcp', input: { value: 1 }, config: expected });
    await initializeProcessSurfaceAuthority(paths.hostRoot);
    const tool = createCesarToolRegistry().get('ExternalCesar')!;
    const response = await tool.execute({ value: 2 }, { cwd: project, readFileState: new Map(), abortSignal: new AbortController().signal });
    expect(response.ok).toBe(true);
    expect(JSON.parse(response.content)).toEqual({ source: 'cesar', input: { value: 2 }, config: expected });
    vi.spyOn(process, 'cwd').mockReturnValue(project);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const command = createGeneratedLazySubCommands()['external-settings'] as { run(context: unknown): Promise<void> };
    await command.run({ args: {} });
    expect(write).toHaveBeenCalledWith(JSON.stringify(expected));
  });
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
    vi.stubEnv('AGON_HOME', paths.root);
    await writeFile(join(paths.root, 'config.json'), JSON.stringify({ mods: { 'example.surfaces': { enabled: true } } }));
    const activation = new ExternalActivationStore(paths.hostRoot);
    const disable = activation.preview(activationIdentity(paths.candidate), false, 'test disable', '2026-09-04T00:00:02.000Z');
    await activation.apply(disable, disable.planHash); process.env.AGON_MODULAR_HOST_ROOT = paths.hostRoot;
    expect(await activation.enabled(activationIdentity(paths.candidate))).toBe(false);
    await initializeMcpSurfaceAuthority(); expect(activeMcpSurfaceTools().map(({ name }) => name)).not.toContain('ExternalMcp');
    await initializeProcessSurfaceAuthority(paths.hostRoot); expect(createCesarToolRegistry().has('ExternalCesar')).toBe(false);
    expect(createGeneratedLazySubCommands()['external-settings']).toBeUndefined();
    await expect(invokeActiveMcpSurfaceTool('ExternalMcp', { value: 1 })).rejects.toThrow();
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
  });

  it('fails stale MCP and Cesar clients closed after the canonical generation changes', async () => {
    const paths = await fixture(); process.env.AGON_MODULAR_HOST_ROOT = paths.hostRoot;
    await initializeMcpSurfaceAuthority(); await initializeProcessSurfaceAuthority(paths.hostRoot);
    const captured = createCesarToolRegistry().get('ExternalCesar')!;
    const command = createGeneratedLazySubCommands()['external-settings'] as { run(context: unknown): Promise<void> };
    const route = processSurfaceCatalog('cesar').find(entry => entry.kind === 'plan-step' && entry.owner.id === 'agon.agent')!;
    await writeFile(join(paths.hostRoot, 'current-generation.json'), '{}');
    expect(() => activeMcpSurfaceTools()).toThrow(/generation changed|became unreadable/);
    await expect(captured.execute({ value: 1 }, { cwd: paths.root, readFileState: new Map(), abortSignal: new AbortController().signal })).rejects.toThrow(/generation changed|became unreadable/);
    expect(() => processSurfacePublicIds('cesar')).toThrow(/generation changed|became unreadable/);
    await expect(command.run({ args: {} })).rejects.toThrow(/generation changed|became unreadable/);
    await expect(executeProcessCesarRoute(route.publicId, {}, { cwd: paths.root, signal: new AbortController().signal })).rejects.toThrow(/generation changed|became unreadable/);
  });
