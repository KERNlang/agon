import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const check = process.argv.includes('--check');
const packageMap = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-package-map.json'), 'utf8'));
const ownership = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-ownership.json'), 'utf8'));
const inventory = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-current-inventory.json'), 'utf8'));
const hierarchy = JSON.parse(readFileSync(resolve(root, 'docs/specs/evidence/modular-agon-ui-hierarchy.json'), 'utf8'));

const platforms = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'];
const surfaceCategories = new Map([
  ['cliCommands', { manifestKind: 'cliCommands', registryKind: 'cli-command' }],
  ['tuiSlashCommands', { manifestKind: 'tuiActions', registryKind: 'tui-action' }],
  ['tuiKeyboardActions', { manifestKind: 'tuiActions', registryKind: 'tui-action' }],
  ['builtinCommandMetadata', { manifestKind: 'tuiActions', registryKind: 'tui-action' }],
  ['intentVariants', { manifestKind: 'tuiActions', registryKind: 'intent' }],
  ['mcpTools', { manifestKind: 'mcpTools', registryKind: 'mcp-tool' }],
  ['cesarTools', { manifestKind: 'cesarTools', registryKind: 'cesar-tool' }],
  ['cesarRoutes', { manifestKind: 'cesarTools', registryKind: 'cesar-tool' }],
  ['resultAndEnvelopeTypes', { manifestKind: 'resultTypes', registryKind: 'result-type' }],
  ['configKeys', { manifestKind: 'configKeys', registryKind: 'config' }],
  ['generatedDocumentation', { manifestKind: 'generatedDocs', registryKind: 'docs' }],
]);

const compareAscii = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const json = (value) => JSON.stringify(value, null, 2) + '\n';

function ownerId(packageName) {
  if (packageName === '@kernlang/agon-kernel') return 'agon.kernel';
  const short = packageName.replace(/^@kernlang\/agon-(?:mod-|support-)?/, '').replace(/[^a-z0-9]+/g, '-');
  return `agon.${short}`;
}

function shortName(packageName) {
  return packageName.replace('@kernlang/agon-mod-', '');
}

function packageDirectory(packageName) {
  if (packageName === '@kernlang/agon-mod-api') return 'mod-api';
  if (packageName === '@kernlang/agon-kernel') return 'mod-kernel';
  return packageName.replace('@kernlang/agon-', '');
}

function packageVersion(packageName) {
  if (packageName === '@kernlang/agon-mod-api') return '1.0.0';
  if (packageName.includes('/agon-support-')) return '0.0.0-slice.4';
  if (packageName.includes('/agon-mod-')) return '0.0.0-slice.5';
  return '>=0.0.0-0';
}

function displayByShort() {
  const result = new Map();
  hierarchy.groups.forEach((group, groupIndex) => {
    if (group.nonToggleable) return;
    group.children.forEach((child, order) => {
      const id = typeof child === 'string' ? child : child.id;
      const parent = typeof child === 'string' ? undefined : child.parent;
      result.set(id, { group: group.label, order: groupIndex * 100 + order, ...(parent ? { parent: `agon.${parent}` } : {}) });
    });
  });
  return result;
}

const displays = displayByShort();
const assignmentKey = (entry) => [entry.category, entry.id, entry.source].join('\0');
const assignmentByOccurrence = new Map(ownership.assignments.map((entry) => [assignmentKey(entry), entry]));

function contributionsFor(packageName) {
  const result = [];
  for (const [category, projection] of surfaceCategories) {
    for (const [index, occurrence] of (inventory.categories[category] ?? []).entries()) {
      const assignment = assignmentByOccurrence.get(assignmentKey({ category, id: occurrence.id, source: occurrence.source }));
      if (assignment?.package !== packageName) continue;
      result.push({
        id: `${category}:${String(index).padStart(4, '0')}`,
        publicId: occurrence.id,
        category,
        source: occurrence.source,
        ...projection,
      });
    }
  }
  return result.sort((left, right) => compareAscii(left.registryKind, right.registryKind) || compareAscii(left.id, right.id));
}

function expectedFiles(packageRecord) {
  const packageName = packageRecord.id;
  const short = shortName(packageName);
  const directory = resolve(root, 'packages', `mod-${short}`);
  const packageAssignments = ownership.assignments
    .filter((entry) => entry.package === packageName)
    .sort((left, right) => compareAscii(left.category, right.category) || compareAscii(left.id, right.id) || compareAscii(left.source, right.source));
  const ownershipText = json({ schemaVersion: 1, package: packageName, assignments: packageAssignments });
  const configSchema = json({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://kernlang.dev/schemas/${short}/config.schema.json`,
    title: `${short} configuration`,
    type: 'object',
    additionalProperties: true,
  });
  const contributions = contributionsFor(packageName);
  const byManifestKind = Object.fromEntries([
    'cliCommands', 'tuiActions', 'mcpTools', 'cesarTools', 'lifecycleHooks',
    'resultTypes', 'configKeys', 'generatedDocs',
  ].map((kind) => [kind, contributions.filter((entry) => entry.manifestKind === kind).map(({ id }) => ({ id, aliases: [] }))]));
  const display = displays.get(short);
  if (!display) throw new Error(`missing UI hierarchy placement for ${packageName}`);
  const dependencies = packageRecord.dependencies.map((dependency) => ({ id: ownerId(dependency), range: '>=0.0.0-0' }));
  const physicalPackFiles = short === 'rag' ? ['dist/store.d.ts', 'dist/types.d.ts'] : [];
  const manifest = {
    schemaVersion: 2,
    id: ownerId(packageName),
    name: short.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' '),
    version: '0.0.0-slice.5',
    apiRange: '>=1.0.0 <2',
    execution: 'executable',
    compatibility: { kernelRange: '>=0.0.0-0 <2', nodeRange: '>=22' },
    packageClass: 'user-toggleable-mod-package',
    entrypoints: { runtime: 'dist/index.js', types: 'dist/index.d.ts' },
    display,
    dependencies: { required: dependencies, optional: [], conflicts: [] },
    permissions: [],
    platforms,
    assets: [
      { path: 'ownership.json', kind: 'documentation', mediaType: 'application/json', contentHash: sha256(ownershipText), bytes: Buffer.byteLength(ownershipText), executable: false, platforms },
      { path: 'schemas/config.schema.json', kind: 'schema', mediaType: 'application/schema+json', contentHash: sha256(configSchema), bytes: Buffer.byteLength(configSchema), executable: false, platforms },
    ],
    contributes: byManifestKind,
    pack: { include: ['agon.mod.json', 'dist/index.js', 'dist/index.d.ts', ...physicalPackFiles, 'ownership.json', 'schemas/config.schema.json'], executable: [] },
  };

  const dependencyVersions = Object.fromEntries(packageRecord.dependencies.map((dependency) => [dependency, packageVersion(dependency)]));
  const packageJson = {
    name: packageName,
    version: '0.0.0-slice.5',
    private: true,
    type: 'module',
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' }, './manifest': './agon.mod.json', './ownership': './ownership.json' },
    main: './dist/index.js',
    types: './dist/index.d.ts',
    files: ['dist', 'schemas', 'agon.mod.json', 'ownership.json'],
    sideEffects: false,
    scripts: { build: 'tsup && tsc -b tsconfig.json --force', typecheck: 'tsc --noEmit' },
    peerDependencies: { '@kernlang/agon-kernel': '>=0.0.0-0 <2' },
    dependencies: dependencyVersions,
  };
  const paths = Object.fromEntries(packageRecord.dependencies.map((dependency) => [dependency, [`../${packageDirectory(dependency)}/src/index.ts`]]));
  const references = packageRecord.dependencies.map((dependency) => ({ path: `../${packageDirectory(dependency)}` }));
  const tsconfig = {
    extends: '../../tsconfig.base.json',
    compilerOptions: {
      composite: true,
      outDir: 'dist',
      rootDir: 'src',
      baseUrl: '.',
      paths,
      sourceMap: false,
      declarationMap: false,
      emitDeclarationOnly: true,
    },
    references,
    include: ['src'],
  };
  const runtimeRecords = contributions.map(({ id, publicId, registryKind, category, source }) => ({ id, publicId, registryKind, category, source }));
  const physicalExports = short === 'rag' ? `export * from './store.js';
export type * from './types.js';
` : '';
  const resultSchemaName = contributions.some(({ registryKind }) => registryKind === 'result-type') ? 'resultSchema' : '_resultSchema';
  const indexSource = `import { validateManifest } from '@kernlang/agon-mod-api';\nimport type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';\n\nexport const MANIFEST = validateManifest(${JSON.stringify(manifest, null, 2)});\nexport const SOURCE_OCCURRENCES = Object.freeze(${JSON.stringify(packageAssignments, null, 2)});\nexport const COMPATIBILITY_CONTRIBUTIONS = Object.freeze(${JSON.stringify(runtimeRecords, null, 2)});\n\nexport interface FirstPartyCompatibilityRuntime {\n  command(kind: string, id: string, input: Json, context: InvocationContext): InvocationOutput;\n  tool(kind: string, id: string, input: Json, context: InvocationContext): Awaitable<Json>;\n  parseIntent(id: string, input: string): Awaitable<Json | undefined>;\n  lifecycle(id: string, payload: Json, context: InvocationContext): Awaitable<void>;\n  render(id: string, payload: Json): Awaitable<{ readonly text: string; readonly markdown?: string }>;\n}\n\ntype FirstPartyServices = ModServices & { readonly firstPartyCompatibility?: FirstPartyCompatibilityRuntime };\nconst inputSchema = Object.freeze({ type: 'object', additionalProperties: true }) as Readonly<Record<string, Json>>;\nconst ${resultSchemaName} = Object.freeze({ type: 'object', additionalProperties: true }) as Readonly<Record<string, Json>>;\n\nexport function createFirstPartyCompatibilityMod(runtime: FirstPartyCompatibilityRuntime): AgonModV1 {\n  return Object.freeze({\n    apiVersion: '1' as const,\n    async activate(registrar: Registrar): Promise<Dispose> {\n      const disposers: Dispose[] = [];\n${contributions.map((entry) => {
  const label = JSON.stringify(`${entry.publicId} compatibility contribution`);
  const id = JSON.stringify(entry.id);
  const publicId = JSON.stringify(entry.publicId);
  if (entry.registryKind === 'cli-command') return `      disposers.push(registrar.command('cli', { id: ${id}, description: ${label}, inputSchema, run: (input, context) => runtime.command('cli-command', ${publicId}, input, context) }));`;
  if (entry.registryKind === 'tui-action') return `      disposers.push(registrar.command('tui', { id: ${id}, description: ${label}, inputSchema, run: (input, context) => runtime.command('tui-action', ${publicId}, input, context) }));`;
  if (entry.registryKind === 'intent') return `      disposers.push(registrar.intent({ id: ${id}, description: ${label}, inputSchema, parse: (input) => runtime.parseIntent(${publicId}, input), run: (input, context) => runtime.command('intent', ${publicId}, input, context) }));`;
  if (entry.registryKind === 'mcp-tool') return `      disposers.push(registrar.tool('mcp', { id: ${id}, description: ${label}, inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', ${publicId}, input, context) }));`;
  if (entry.registryKind === 'cesar-tool') return `      disposers.push(registrar.tool('cesar', { id: ${id}, description: ${label}, inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', ${publicId}, input, context) }));`;
  if (entry.registryKind === 'result-type') return `      disposers.push(registrar.resultType({ id: ${id}, schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render(${publicId}, payload) }));`;
  if (entry.registryKind === 'config') return `      disposers.push(registrar.config(${id}, inputSchema));`;
  if (entry.registryKind === 'docs') return `      disposers.push(registrar.docs({ id: ${id}, title: ${label}, markdown: ${JSON.stringify(`Compatibility documentation owned by ${packageName}.`)} }));`;
  throw new Error(`unsupported registry kind: ${entry.registryKind}`);
}).join('\n')}\n      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };\n    },\n  });\n}\n\nexport const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {\n  const runtime = (services as FirstPartyServices).firstPartyCompatibility;\n  if (!runtime) {\n    throw Object.assign(new Error('${packageName} requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });\n  }\n  return createFirstPartyCompatibilityMod(runtime);\n};\n\nexport default createMod;\n${physicalExports}`;
  return new Map([
    [resolve(directory, 'package.json'), json(packageJson)],
    [resolve(directory, 'agon.mod.json'), json(manifest)],
    [resolve(directory, 'ownership.json'), ownershipText],
    [resolve(directory, 'schemas/config.schema.json'), configSchema],
    [resolve(directory, 'src/index.ts'), indexSource],
    [resolve(directory, 'tsconfig.json'), json(tsconfig)],
    [resolve(directory, 'tsup.config.ts'), "import { defineConfig } from 'tsup';\n\nexport default defineConfig({ entry: ['src/index.ts'], format: ['esm'], dts: false, sourcemap: false, clean: true, target: 'es2022' });\n"],
  ]);
}

const mods = packageMap.packages.filter((entry) => entry.class === 'user-toggleable-mod-package');
if (mods.length !== 36) throw new Error(`expected 36 first-party mods, got ${mods.length}`);
const generated = new Map();
for (const mod of mods) for (const [path, source] of expectedFiles(mod)) generated.set(path, source);

const rootPackagePath = resolve(root, 'package.json');
const rootPackage = JSON.parse(readFileSync(rootPackagePath, 'utf8'));
const modWorkspaces = mods.map((entry) => `packages/mod-${shortName(entry.id)}`);
rootPackage.workspaces = [...rootPackage.workspaces.filter((entry) => !entry.startsWith('packages/mod-') || ['packages/mod-api', 'packages/mod-kernel'].includes(entry)), ...modWorkspaces];
generated.set(rootPackagePath, json(rootPackage));

const rootTsconfigPath = resolve(root, 'tsconfig.json');
const rootTsconfig = JSON.parse(readFileSync(rootTsconfigPath, 'utf8'));
const retainedReferences = rootTsconfig.references.filter(({ path }) => !path.startsWith('packages/mod-') || ['packages/mod-api', 'packages/mod-kernel'].includes(path));
rootTsconfig.references = [...retainedReferences, ...mods.map((entry) => ({ path: `packages/mod-${shortName(entry.id)}` }))];
generated.set(rootTsconfigPath, json(rootTsconfig));

const stale = [];
for (const [path, source] of generated) {
  if (check) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== source) stale.push(path.replace(root + '/', ''));
    continue;
  }
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, source);
}
if (stale.length) {
  console.error(`first-party package generation drift:\n${stale.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`${check ? 'verified' : 'generated'} ${mods.length} first-party packages and ${generated.size} files`);
}
