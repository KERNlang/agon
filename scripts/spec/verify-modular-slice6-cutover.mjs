import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const json = (path) => JSON.parse(read(path));
const source = read('packages/mod-kernel/src/generated/first-party-surface-catalog.ts');
const catalog = JSON.parse(source.slice(source.indexOf('Object.freeze(') + 14, source.lastIndexOf(') as readonly GeneratedSurfaceCatalogEntry[];')));
const packageMap = json('docs/specs/evidence/modular-agon-package-map.json');
const adapters = json('docs/specs/evidence/modular-agon-slice6-compatibility-adapters.json');
const fail = (message) => { throw new Error(message); };
const unique = (values, label) => { if (new Set(values).size !== values.length) fail(`duplicate ${label}`); };
const assertCesarRouteKinds = (entries) => {
  for (const entry of entries) {
    if (/^(?:cesarRoutes|physicalCesarRoutes):/.test(entry.registryId) && entry.kind !== 'plan-step') {
      fail(`Cesar route ${entry.registryId} must be a plan-step, got ${entry.kind}`);
    }
  }
};

function assertMcpInvocation(text) {
  const parsed = ts.createSourceFile('mcp.ts', text, ts.ScriptTarget.Latest, true);
  if (parsed.parseDiagnostics.length) fail('MCP dispatch source has parse errors');
  let calls = 0;
  const identifier = (node, name) => node && ts.isIdentifier(node) && node.text === name;
  function visit(node) {
    if (ts.isCallExpression(node) && identifier(node.expression, 'invokeDynamic')) {
      calls++;
      const [name, input, signal] = node.arguments;
      if (node.arguments.length !== 3 || !identifier(name, 'toolName') || !identifier(input, 'toolArgs')
        || !signal || !ts.isPropertyAccessExpression(signal)
        || !identifier(signal.expression, 'controller') || signal.name.text !== 'signal') {
        fail('MCP dynamic dispatch must carry toolName, toolArgs and the request controller.signal');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  if (calls !== 1) fail(`expected one MCP dynamic dispatch call, got ${calls}`);
}

if (catalog.length !== 450) fail(`expected 450 generated entries, got ${catalog.length}`);
assertCesarRouteKinds(catalog);
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
assertMcpInvocation(read('packages/mcp/src/agon-orchestration.ts'));

const fields = ['id', 'owner', 'path', 'killList', 'purpose', 'removalCondition', 'unreachableProof', 'status'];
const expectedAdapters = [];
if (JSON.stringify(adapters.adapters.map(({ id }) => id).sort()) !== JSON.stringify(expectedAdapters)) fail('unexpected compatibility adapter set');
for (const adapter of adapters.adapters) {
  if (fields.some((field) => !(field in adapter)) || adapter.status !== 'temporary') fail(`incomplete adapter: ${adapter.id}`);
  read(adapter.path); read(adapter.unreachableProof);
}

if (process.argv.includes('--self-test')) {
  const duplicate = [...catalog, catalog[0]];
  let rejected = false;
  try { unique(duplicate.map((entry) => `${entry.surface}\0${entry.kind}\0${entry.registryId}`), 'negative control'); } catch { rejected = true; }
  const routeKindMutant = catalog.map((entry) => /^(?:cesarRoutes|physicalCesarRoutes):/.test(entry.registryId) ? { ...entry, kind: 'cesar-tool' } : entry);
  let routeKindRejected = false;
  try { assertCesarRouteKinds(routeKindMutant); } catch { routeKindRejected = true; }
  const mcp = read('packages/mcp/src/agon-orchestration.ts');
  const call = 'invokeDynamic(toolName, toolArgs, controller.signal)';
  if (!mcp.includes(call)) fail('MCP negative-control target changed; update the mutation explicitly');
  for (const replacement of ['invokeDynamic(toolName, toolArgs)', 'invokeDynamic(toolArgs, toolName, controller.signal)', 'undefined']) {
    let refused = false;
    try { assertMcpInvocation(mcp.replace(call, replacement)); } catch { refused = true; }
    if (!refused) fail(`MCP invocation negative control survived: ${replacement}`);
  }
  const cesar = read('packages/cli/src/cesar/tools.ts');
  if (!rejected || !routeKindRejected || catalog.filter((entry) => entry.owner.id !== 'agon.brainstorm').some((entry) => entry.owner.id === 'agon.brainstorm')
    || mcp.includes('ORCHESTRATION_TOOLS') || mcp.includes('handleToolCall(')
    || cesar.includes('CESAR_SURFACE_IDS') || cesar.includes('register(createBrainstormTool')) fail('negative controls failed');
}

console.log(JSON.stringify({ status: 'passed', scope: 'surface-declarations-and-dispatch-shape',
  entries: catalog.length, physicalUserPackages: userPackages.length,
  declaredSurfaceAdapters: adapters.adapters.length, legacyAdapterRemovalVerified: false }, null, 2));
