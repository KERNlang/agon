import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
const packageMap = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-package-map.json'), 'utf8'));
const ownership = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-ownership.json'), 'utf8'));
const mods = packageMap.packages.filter((entry) => entry.class === 'user-toggleable-mod-package');
const packageById = new Map(packageMap.packages.map((entry) => [entry.id, entry]));
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

function run(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_ignore_scripts: 'true', npm_config_cache: process.env.AGON_S5_NPM_CACHE ?? '/private/tmp/modular-agon-s5-npm-cache' } });
}

function shortName(id) {
  return id.replace('@kernlang/agon-mod-', '');
}

function topologicalMods() {
  const pending = new Map(mods.map((entry) => [entry.id, entry]));
  const ordered = [];
  while (pending.size) {
    const ready = [...pending.values()].filter((entry) => entry.dependencies
      .filter((dependency) => pending.has(dependency) || mods.some((mod) => mod.id === dependency))
      .every((dependency) => !pending.has(dependency)));
    if (!ready.length) throw new Error(`first-party mod cycle: ${[...pending.keys()].join(', ')}`);
    ready.sort((left, right) => left.id.localeCompare(right.id));
    for (const entry of ready) {
      pending.delete(entry.id);
      ordered.push(entry);
    }
  }
  return ordered;
}

run('npm', ['run', 'build', '-w', 'packages/mod-api']);
run('npm', ['run', 'build', '-w', 'packages/mod-kernel']);
const { validateManifest } = await import(pathToFileURL(resolve(root, 'packages/mod-api/dist/index.js')).href);
const { ModRegistry, RegistryInvariantError } = await import(pathToFileURL(resolve(root, 'packages/mod-kernel/dist/index.js')).href);
const results = [];

for (const record of topologicalMods()) {
  const short = shortName(record.id);
  const directory = resolve(root, 'packages', `mod-${short}`);
  run('npm', ['run', 'build', '-w', `packages/mod-${short}`]);
  const manifest = validateManifest(JSON.parse(readFileSync(resolve(directory, 'agon.mod.json'), 'utf8')));
  const packageJson = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  if (packageJson.name !== record.id || manifest.packageClass !== 'user-toggleable-mod-package') throw new Error(`${record.id}: identity mismatch`);
  const expectedDependencyIds = record.dependencies.map((dependency) => packageById.has(dependency) ? dependency : null).filter(Boolean);
  if (expectedDependencyIds.length !== record.dependencies.length) throw new Error(`${record.id}: unknown package-map dependency`);

  for (const asset of manifest.assets) {
    const bytes = readFileSync(resolve(directory, asset.path));
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.contentHash) throw new Error(`${record.id}: asset hash mismatch ${asset.path}`);
  }
  const packed = JSON.parse(run('npm', ['pack', '--json', '--dry-run', directory]))[0];
  const packedFiles = packed.files.map(({ path }) => path).sort();
  const expectedFiles = ['package.json', ...manifest.pack.include].sort();
  if (JSON.stringify(packedFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(`${record.id}: packed files ${packedFiles.join(', ')} != ${expectedFiles.join(', ')}`);
  }

  const module = await import(pathToFileURL(resolve(directory, 'dist/index.js')).href);
  if (module.MANIFEST.id !== manifest.id || !Object.isFrozen(module.MANIFEST)) throw new Error(`${record.id}: runtime manifest mismatch`);
  const expectedOccurrences = ownership.assignments.filter((entry) => entry.package === record.id).length;
  if (module.SOURCE_OCCURRENCES.length !== expectedOccurrences) throw new Error(`${record.id}: ownership occurrence mismatch`);

  const services = Object.freeze({
    identity: Object.freeze({ id: manifest.id, version: manifest.version, contentHash: sha256(JSON.stringify(manifest)) }),
    source: 'bundled',
    logger: Object.freeze({ debug() {}, info() {}, warn() {} }),
    receipts: Object.freeze({ async record() { return 'receipt'; } }),
    permissions: Object.freeze({ async check() { return 'allow'; } }),
    state: Object.freeze({ async read() { return undefined; }, async write() {} }),
    engines: Object.freeze({ async dispatch() { return null; } }),
  });
  let failedClosed = false;
  try { await module.createMod(services); } catch (error) { failedClosed = error?.code === 'MOD_RESTART_REQUIRED'; }
  if (!failedClosed) throw new Error(`${record.id}: activation without compatibility runtime did not fail closed`);

  const calls = [];
  const runtime = Object.freeze({
    command: (kind, id) => { calls.push({ kind, id }); return Object.freeze({ exitCode: 0 }); },
    tool: async (kind, id) => { calls.push({ kind, id }); return null; },
    parseIntent: async (id) => { calls.push({ kind: 'intent-parse', id }); return undefined; },
    lifecycle: async (id) => { calls.push({ kind: 'lifecycle', id }); },
    render: async (id) => { calls.push({ kind: 'result-type', id }); return Object.freeze({ text: 'compatibility result' }); },
  });
  const owner = services.identity;
  const registry = new ModRegistry({ generation: 's5-verification', activeOwners: [owner] });
  const session = registry.beginRegistration(manifest);
  const mod = module.createFirstPartyCompatibilityMod(runtime);
  await mod.activate(session.registrar);
  session.commit();
  const counts = {
    cli: registry.project('cli').entries.length,
    tui: registry.project('tui').entries.length,
    mcp: registry.project('mcp').entries.length,
    cesar: registry.project('cesar').entries.length,
    docs: registry.project('docs').entries.length,
  };
  const expectedCounts = {
    cli: manifest.contributes.cliCommands.length,
    tui: manifest.contributes.tuiActions.length,
    mcp: manifest.contributes.mcpTools.length,
    cesar: manifest.contributes.cesarTools.length,
    docs: manifest.contributes.generatedDocs.length,
  };
  if (JSON.stringify(counts) !== JSON.stringify(expectedCounts)) throw new Error(`${record.id}: projection parity mismatch`);
  for (const entry of module.COMPATIBILITY_CONTRIBUTIONS) {
    const kind = entry.registryKind === 'cli-command' ? 'cli-command'
      : entry.registryKind === 'tui-action' ? 'tui-action'
      : entry.registryKind === 'intent' ? 'intent'
      : entry.registryKind === 'mcp-tool' ? 'mcp-tool'
      : entry.registryKind === 'cesar-tool' ? 'cesar-tool'
      : entry.registryKind === 'result-type' ? 'result-type'
      : entry.registryKind === 'config' ? 'config'
      : 'docs';
    const resolved = registry.resolve(kind, entry.id);
    if (!resolved) throw new Error(record.id + ' registered contribution missing ' + kind + '/' + entry.id);
    const before = calls.length;
    if (["cli-command", "tui-action", "intent", "mcp-tool", "cesar-tool"].includes(entry.registryKind)) await resolved.payload.run({}, {});
    else if (entry.registryKind === "result-type") await resolved.payload.render({});
    if (["cli-command", "tui-action", "intent", "mcp-tool", "cesar-tool", "result-type"].includes(entry.registryKind)
      && (calls.length !== before + 1 || calls.at(-1).id !== entry.publicId)) throw new Error(record.id + ' compatibility runtime did not receive public id ' + entry.publicId);
  }
  await registry.disposeOwner(owner.id);
  if (Object.values(registry.projections()).some((projection) => projection.entries.length)) throw new Error(`${record.id}: owner disposal left reachable surfaces`);

  const disabledRegistry = new ModRegistry({ generation: 's5-disabled', activeOwners: [] });
  let disabled = false;
  try { disabledRegistry.beginRegistration(manifest); } catch (error) { disabled = error instanceof RegistryInvariantError; }
  if (!disabled || Object.values(disabledRegistry.projections()).some((projection) => projection.entries.length)) {
    throw new Error(`${record.id}: disabled package remained reachable`);
  }
  results.push({ id: record.id, occurrences: expectedOccurrences, contributions: module.COMPATIBILITY_CONTRIBUTIONS.length, packedFiles: packedFiles.length });
}

if (process.argv.includes('--self-test')) {
  const first = JSON.parse(readFileSync(resolve(root, 'packages/mod-ask/agon.mod.json'), 'utf8'));
  first.dependencies.required.push(first.dependencies.required[0]);
  let rejected = false;
  try { validateManifest(first); } catch { rejected = true; }
  if (!rejected) throw new Error('negative control: duplicate dependency survived manifest validation');
  console.log('first-party package negative control passed');
}

console.log(JSON.stringify({ packages: results.length, occurrences: results.reduce((sum, entry) => sum + entry.occurrences, 0), contributions: results.reduce((sum, entry) => sum + entry.contributions, 0), status: 'passed' }, null, 2));
