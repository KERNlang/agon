import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const json = (path) => JSON.parse(read(path));
const source = read('packages/mod-kernel/src/generated/first-party-surface-catalog.ts');
const catalog = JSON.parse(source.slice(source.indexOf('Object.freeze(') + 14, source.lastIndexOf(') as readonly GeneratedSurfaceCatalogEntry[];')));
const packageMap = json('docs/specs/evidence/modular-agon-package-map.json');
const adapters = json('docs/specs/evidence/modular-agon-slice6-compatibility-adapters.json');
const fail = (message) => { throw new Error(message); };
const unique = (values, label) => { if (new Set(values).size !== values.length) fail(`duplicate ${label}`); };

if (catalog.length !== 449) fail(`expected 449 generated entries, got ${catalog.length}`);
for (const surface of ['cli', 'tui', 'mcp', 'cesar', 'docs']) {
  const entries = catalog.filter((entry) => entry.surface === surface);
  if (!entries.length) fail(`missing ${surface} projection`);
  unique(entries.map((entry) => `${entry.kind}\0${entry.registryId}`), `${surface} contribution`);
}

const userPackages = packageMap.packages.filter((entry) => entry.class === 'user-toggleable-mod-package');
if (userPackages.length !== 36) fail(`expected 36 physical user packages, got ${userPackages.length}`);
for (const record of userPackages) {
  const manifest = json(`packages/${record.id.replace('@kernlang/agon-mod-', 'mod-')}/agon.mod.json`);
  const entries = catalog.filter((entry) => entry.owner.id === manifest.id);
  const declared = new Set(Object.values(manifest.contributes).flat().map(({ id }) => id));
  if (!entries.length || entries.some((entry) => entry.ownerClass !== 'user-toggleable-mod-package' || !declared.has(entry.registryId))) {
    fail(`${record.id} does not own its generated declarations`);
  }
}

const requirements = [
  ['packages/mod-kernel/src/first-party-surface-bootstrap.ts', 'assertSelectedLockIntegrity'],
  ['packages/mod-kernel/src/first-party-surface-bootstrap.ts', 'assertFirstPartyPackagesMatchLock'],
  ['packages/mod-kernel/src/first-party-surface-bootstrap.ts', 'assertSelectedLockPackageClosure'],
  ['packages/cli/src/index.ts', 'await initializeProcessSurfaceAuthority()'],
  ['packages/cli/src/surface-authority-runtime.ts', 'bootstrapFirstPartySurfaceGeneration'],
  ['packages/mcp/src/index.ts', 'await initializeMcpSurfaceAuthority()'],
  ['packages/mcp/src/agon-orchestration.ts', '!available.has(toolName)'],
  ['packages/cli/src/cesar/tools.ts', "processSurfaceNames('cesar')"],
  ['packages/cli/src/signals/intent.ts', "processSurfaceNames('tui')"],
];
for (const [path, marker] of requirements) if (!read(path).includes(marker)) fail(`${path} lacks ${marker}`);

const fields = ['id', 'owner', 'path', 'killList', 'purpose', 'removalCondition', 'unreachableProof', 'status'];
if (adapters.adapters.length !== 5) fail('expected five compatibility adapters');
for (const adapter of adapters.adapters) {
  if (fields.some((field) => !(field in adapter)) || adapter.status !== 'temporary') fail(`incomplete adapter: ${adapter.id}`);
  read(adapter.path); read(adapter.unreachableProof);
}

if (process.argv.includes('--self-test')) {
  const duplicate = [...catalog, catalog[0]];
  let rejected = false;
  try { unique(duplicate.map((entry) => `${entry.surface}\0${entry.kind}\0${entry.registryId}`), 'negative control'); } catch { rejected = true; }
  if (!rejected || catalog.filter((entry) => entry.owner.id !== 'agon.brainstorm').some((entry) => entry.owner.id === 'agon.brainstorm')) fail('negative controls failed');
}

console.log(JSON.stringify({ status: 'passed', entries: catalog.length, physicalUserPackages: userPackages.length, temporaryAdapters: adapters.adapters.length }, null, 2));
