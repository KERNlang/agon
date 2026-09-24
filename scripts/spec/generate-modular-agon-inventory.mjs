import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const evidenceDir = resolve(process.env.AGON_SPEC_EVIDENCE_DIR || join(root, 'docs/specs/evidence'));
mkdirSync(evidenceDir, { recursive: true });

const posix = (value) => value.split('\\').join('/');
const rel = (value) => posix(relative(root, value));

// The inventory is the migration input captured before physical extraction. It
// is deliberately not a live inventory of the rewritten tree: scanning newly
// extracted packages would count both the legacy owner and its destination and
// silently move the acceptance target. Refreshing the baseline therefore needs
// an explicit, reviewable flag. The default command is a frozen-baseline check.
const frozenInventoryPath = join(evidenceDir, 'modular-agon-current-inventory.json');
const canonicalFrozenInventoryPath = join(root, 'docs/specs/evidence/modular-agon-current-inventory.json');
const canonicalFrozenInventoryMarkdownPath = join(root, 'docs/specs/evidence/modular-agon-current-inventory.md');
const frozenCategoryHash = 'e19cc1b2d0686d9be2872999d3165196b2fc827683d8edca3bb746fd8d0c9772';
const refreshFrozenBaseline = process.argv.includes('--refresh-frozen-baseline');
const selfTest = process.argv.includes('--self-test');

function categoryHash(categories) {
  return createHash('sha256').update(JSON.stringify(categories)).digest('hex');
}

function validateFrozenInventory(value) {
  if (!value || value.schemaVersion !== 1 || typeof value.categories !== 'object' || value.categories === null) {
    throw new Error('frozen legacy inventory has an invalid schema');
  }
  const assignments = Object.values(value.categories).reduce((sum, entries) => {
    if (!Array.isArray(entries)) throw new Error('frozen legacy inventory category is not an array');
    return sum + entries.length;
  }, 0);
  if (assignments !== 872) throw new Error(`frozen legacy inventory must contain 872 assignments; got ${assignments}`);
  const actualHash = categoryHash(value.categories);
  if (actualHash !== frozenCategoryHash) {
    throw new Error(`frozen legacy inventory category hash mismatch: ${actualHash}`);
  }
  return { assignments, categoryHash: actualHash };
}

if (!refreshFrozenBaseline) {
  // Verification sandboxes receive an exact copy of the committed migration
  // baseline. They must never reconstruct it from the post-extraction tree.
  const canonicalBytes = readFileSync(canonicalFrozenInventoryPath, 'utf8');
  const frozen = JSON.parse(canonicalBytes);
  const result = validateFrozenInventory(frozen);
  if (resolve(frozenInventoryPath) !== resolve(canonicalFrozenInventoryPath)) {
    writeFileSync(frozenInventoryPath, canonicalBytes);
    writeFileSync(
      join(evidenceDir, 'modular-agon-current-inventory.md'),
      readFileSync(canonicalFrozenInventoryMarkdownPath, 'utf8'),
    );
  }
  if (selfTest) {
    const tampered = structuredClone(frozen);
    tampered.categories.cliCommands = tampered.categories.cliCommands.slice(1);
    let rejected = false;
    try { validateFrozenInventory(tampered); } catch { rejected = true; }
    if (!rejected) throw new Error('negative control failed: a changed frozen baseline was accepted');
  }
  console.log(JSON.stringify({
    mode: 'frozen-baseline-check',
    ...result,
    negativeControl: selfTest ? 'passed' : 'not-requested',
    refreshCommand: 'node scripts/spec/generate-modular-agon-inventory.mjs --refresh-frozen-baseline',
  }, null, 2));
  process.exit(0);
}

const modularSourceRoots = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('mod-') && !['mod-api', 'mod-kernel'].includes(entry.name))
  .map((entry) => 'packages/' + entry.name + '/src');
const supportSourceRoots = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('support-'))
  .map((entry) => 'packages/' + entry.name + '/src');
const sourceRoots = ['packages/core/src', 'packages/forge/src', 'packages/cli/src', 'packages/mcp/src', 'packages/adapter-cli/src', ...supportSourceRoots];

function walk(dir, predicate = () => true) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path, predicate));
    else if (predicate(path)) out.push(path);
  }
  return out.sort();
}

const sourceFiles = [...sourceRoots.flatMap((dir) => walk(join(root, dir), (file) => /\.tsx?$/.test(file))), ...modularSourceRoots.flatMap((dir) => walk(join(root, dir), (file) => /\.tsx?$/.test(file) && !file.endsWith('/index.ts')))];
const parsed = new Map(sourceFiles.map((file) => [file, ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)]));

function locator(file, node) {
  const sf = parsed.get(file);
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return `${rel(file)}:${line + 1}`;
}

function propertyName(node) {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return undefined;
}

function stringValue(node) {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  return undefined;
}

function generatedSurfaceCatalog(category) {
  const file = join(root, 'packages/mod-kernel/src/generated/first-party-surface-catalog.ts');
  const text = readFileSync(file, 'utf8');
  const prefix = 'Object.freeze(';
  const suffix = ') as readonly GeneratedSurfaceCatalogEntry[];';
  const start = text.indexOf(prefix);
  const end = text.lastIndexOf(suffix);
  if (start < 0 || end < 0) throw new Error('generated surface catalog is unreadable');
  return JSON.parse(text.slice(start + prefix.length, end))
    .filter((entry) => entry.category === category)
    .map((entry) => ({ id: entry.publicId, source: entry.source, category: entry.group, description: entry.description, ...(entry.aliasOf ? { aliasOf: entry.aliasOf } : {}) }));
}

function exportedTypeMembers(file, declarationName) {
  const sf = parsed.get(file);
  const decl = sf.statements.find((node) => (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name.text === declarationName);
  if (!decl || !ts.isInterfaceDeclaration(decl)) return [];
  return decl.members.flatMap((member) => {
    if (!ts.isPropertySignature(member)) return [];
    const id = propertyName(member.name);
    return id ? [{ id, optional: Boolean(member.questionToken), source: locator(file, member) }] : [];
  });
}

function stringUnion(file, declarationName) {
  const sf = parsed.get(file);
  const decl = sf.statements.find((node) => ts.isTypeAliasDeclaration(node) && node.name.text === declarationName);
  if (!decl) return [];
  const nodes = ts.isUnionTypeNode(decl.type) ? decl.type.types : [decl.type];
  return nodes.flatMap((node) => ts.isLiteralTypeNode(node) && ts.isStringLiteralLike(node.literal)
    ? [{ id: node.literal.text, source: locator(file, node) }]
    : []);
}

function discriminatedUnion(file, declarationName, discriminator) {
  const sf = parsed.get(file);
  const decl = sf.statements.find((node) => ts.isTypeAliasDeclaration(node) && node.name.text === declarationName);
  if (!decl || !ts.isUnionTypeNode(decl.type)) return [];
  return decl.type.types.flatMap((node) => {
    if (!ts.isTypeLiteralNode(node)) return [];
    const member = node.members.find((entry) => ts.isPropertySignature(entry) && propertyName(entry.name) === discriminator);
    if (!member || !member.type || !ts.isLiteralTypeNode(member.type) || !ts.isStringLiteralLike(member.type.literal)) return [];
    return [{ id: member.type.literal.text, source: locator(file, node) }];
  });
}

const cliCommands = generatedSurfaceCatalog('cliCommands');

for (const file of walk(join(root, 'packages/cli/src/commands'), (path) => path.endsWith('.ts'))) {
  const sf = parsed.get(file);
  if (!sf) continue;
  function visit(node, stack = []) {
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === 'subCommands' && ts.isObjectLiteralExpression(node.initializer)) {
      for (const child of node.initializer.properties) {
        const id = propertyName(child.name);
        if (id) cliCommands.push({ id: `${rel(file).replace(/^packages\/cli\/src\/commands\/|\.ts$/g, '')} ${id}`, kind: 'subcommand', source: locator(file, child) });
      }
    }
    ts.forEachChild(node, (child) => visit(child, stack));
  }
  visit(sf);
}

const tuiCommands = generatedSurfaceCatalog('tuiSlashCommands');
const keyboardFile = join(root, 'packages/cli/src/signals/keyboard.ts');
const keyboardActions = discriminatedUnion(keyboardFile, 'KeyboardAction', 'type');
const builtinCommands = generatedSurfaceCatalog('builtinCommandMetadata');

const intentFile = join(root, 'packages/cli/src/signals/intent-types.ts');
const intents = discriminatedUnion(intentFile, 'Intent', 'type');

const mcpTools = generatedSurfaceCatalog("mcpTools");

const cesarTools = generatedSurfaceCatalog("cesarTools");

const cesarRouteDeclarations = [
  ['packages/cli/src/models/handler-types.ts', 'CesarLiveMode'],
  ['packages/core/src/cesar/plan.ts', 'CesarStepType'],
  ['packages/cli/src/cesar/routing.ts', 'CesarUncertaintyFamily'],
  ['packages/cli/src/cesar/routing.ts', 'CesarEscalationHint'],
  ['packages/cli/src/cesar/routing.ts', 'CesarBreadthHint'],
  ['packages/cli/src/cesar/routing.ts', 'CesarForgeScopeHint'],
  ['packages/cli/src/cesar/routing.ts', 'CesarIntakeKind'],
  ['packages/cli/src/cesar/routing.ts', 'CesarFlowHint'],
];
const cesarRoutes = cesarRouteDeclarations.flatMap(([path, declaration]) =>
  stringUnion(join(root, path), declaration).map((item) => ({ ...item, routeType: declaration })),
);

const hookFile = join(root, 'packages/core/src/blocks/hooks.ts');
const lifecycleHooks = stringUnion(hookFile, 'HookEvent');
for (const id of ['preToolUse', 'postToolUse']) lifecycleHooks.push({ id, source: 'packages/core/src/tools/tool-hooks.ts:62' });

const emittedEvents = [];
for (const [file, sf] of parsed) {
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'emit') {
      const first = node.arguments[0];
      if (first && ts.isStringLiteralLike(first)) emittedEvents.push({ id: first.text, source: locator(file, node) });
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

const exportedResults = [];
for (const [file, sf] of parsed) {
  for (const node of sf.statements) {
    const isExported = node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExported || !(ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node)) || !node.name) continue;
    if (/(Result|Receipt|Envelope|Session|Plan|Journal|Record|Snapshot|Verdict|Event)$/.test(node.name.text)) {
      exportedResults.push({ id: node.name.text, declaration: ts.SyntaxKind[node.kind], source: locator(file, node) });
    }
  }
}

const configFile = join(root, 'packages/core/src/models/types.ts');
const configKeys = exportedTypeMembers(configFile, 'AgonConfig');

const statePaths = [];
const stateSeen = new Set();
for (const [file, sf] of parsed) {
  function add(id, kind, node) {
    const key = `${id}|${rel(file)}`;
    if (!stateSeen.has(key)) {
      stateSeen.add(key);
      statePaths.push({ id, kind, source: locator(file, node) });
    }
  }
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /(?:PATH|DIR|HOME)$/.test(node.name.text)) add(node.name.text, 'exported-path-symbol', node);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'agonPath') {
      const parts = node.arguments.map(stringValue);
      if (parts.length > 0 && parts.every((part) => typeof part === 'string')) add(parts.join('/'), 'agon-home-relative', node);
    }
    if (ts.isStringLiteralLike(node) && /^(?:\.agon(?:\.local)?\.json|\.agon\/)/.test(node.text)) add(node.text, 'project-relative', node);
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

const stateStoreModules = sourceFiles.flatMap((file) => {
  const pathLooksPersistent = /(?:store|history|memory|session|cache|ledger|journal|rating|telemetry|provenance|room|job|snapshot|checkpoint|flow|state)/i.test(rel(file));
  const source = readFileSync(file, 'utf8');
  const performsPersistence = /(?:readFile|writeFile|appendFile|openSync|createReadStream|createWriteStream|sqlite|ndjson|agonPath|localStorage)/.test(source);
  return pathLooksPersistent && performsPersistence ? [{ id: rel(file), source: rel(file) }] : [];
});

const staticAssets = [];
for (const dir of ['engines', 'packages/cli/py', 'packages/cli/assets', 'patches']) {
  const absolute = join(root, dir);
  try {
    for (const file of walk(absolute, (path) => !/__pycache__|\.pyc$/.test(path) && !/\.(?:ts|tsx|js|mjs|cjs)$/.test(path))) {
      staticAssets.push({ id: rel(file), bytes: statSync(file).size, extension: extname(file) || '(none)', source: rel(file) });
    }
  } catch {}
}
for (const file of ['packages/cli/package.json', 'packages/cli/tsup.config.ts', 'scripts/generate-mode-docs.mjs', 'docs/modes.md']) {
  const absolute = join(root, file);
  try { staticAssets.push({ id: file, bytes: statSync(absolute).size, extension: extname(file), source: file }); } catch {}
}

const nativeComponents = ['packages', 'scripts'].flatMap((dir) => walk(join(root, dir), (file) =>
  !/__pycache__|\.pyc$/.test(file) && /\.(?:py|sh|node|c|cc|cpp|h|rs|wasm)$/.test(file),
)).map((file) => ({
  id: rel(file), kind: extname(file).slice(1) || 'native', source: rel(file),
}));

const generatedDocs = [
  { id: 'docs/modes.md', generator: 'packages/mod-routing-docs/src/guide-content.ts', source: 'packages/mod-routing-docs/src/guide-content.ts:1' },
  { id: 'AGENTS.md routing block', generator: 'packages/mod-routing-docs/src/guide-content.ts', source: 'packages/mod-routing-docs/src/guide-content.ts:1' },
  { id: 'installed agent prompts', generator: 'packages/mod-routing-docs/src/guide-content.ts', source: 'packages/mod-routing-docs/src/guide-content.ts:1' },
];

function unique(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.id}|${item.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.id.localeCompare(b.id) || a.source.localeCompare(b.source));
}

const inventory = {
  schemaVersion: 1,
  generatedFrom: 'working-tree source; regenerate with node scripts/spec/generate-modular-agon-inventory.mjs',
  categories: {
    cliCommands: unique(cliCommands),
    tuiSlashCommands: unique(tuiCommands),
    tuiKeyboardActions: unique(keyboardActions),
    builtinCommandMetadata: unique(builtinCommands),
    intentVariants: unique(intents),
    mcpTools: unique(mcpTools),
    cesarTools: unique(cesarTools),
    cesarRoutes: unique(cesarRoutes),
    lifecycleHooks: unique(lifecycleHooks),
    emittedEvents: unique(emittedEvents),
    resultAndEnvelopeTypes: unique(exportedResults),
    configKeys: unique(configKeys),
    statePaths: unique(statePaths),
    stateStoreModules: unique(stateStoreModules),
    staticAssets: unique(staticAssets),
    pythonAndNativeComponents: unique(nativeComponents),
    generatedDocumentation: unique(generatedDocs),
  },
};

const jsonPath = join(evidenceDir, 'modular-agon-current-inventory.json');
writeFileSync(jsonPath, `${JSON.stringify(inventory, null, 2)}\n`);

const lines = ['# Modular Agon current-surface inventory', '', '> Generated evidence. Do not edit by hand.', '', '| Category | Count |', '|---|---:|'];
for (const [name, items] of Object.entries(inventory.categories)) lines.push(`| ${name} | ${items.length} |`);
lines.push('', 'Canonical machine-readable evidence: [docs/specs/evidence/modular-agon-current-inventory.json](./evidence/modular-agon-current-inventory.json).');
writeFileSync(join(evidenceDir, 'modular-agon-current-inventory.md'), `${lines.join('\n')}\n`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(inventory.categories).map(([name, items]) => [name, items.length])), null, 2));
