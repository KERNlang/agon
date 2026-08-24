import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const evidenceDir = resolve(process.env.AGON_SPEC_EVIDENCE_DIR || join(root, 'docs/specs/evidence'));
mkdirSync(evidenceDir, { recursive: true });

const posix = (value) => value.split('\\').join('/');
const rel = (value) => posix(relative(root, value));
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

function objectField(node, name) {
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
  const prop = node.properties.find((entry) => ts.isPropertyAssignment(entry) && propertyName(entry.name) === name);
  return prop && ts.isPropertyAssignment(prop) ? prop.initializer : undefined;
}

function findVariable(file, name) {
  const sf = parsed.get(file);
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}

function arrayObjectCatalog(file, variable, nameField, extra = () => ({})) {
  const init = findVariable(file, variable);
  if (!init || !ts.isArrayLiteralExpression(init)) return [];
  return init.elements.flatMap((node) => {
    if (!ts.isObjectLiteralExpression(node)) return [];
    const name = stringValue(objectField(node, nameField));
    return typeof name === 'string' ? [{ id: name, source: locator(file, node), ...extra(node) }] : [];
  });
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

const lazyFile = join(root, 'packages/cli/src/lazy-commands.ts');
const lazyMap = findVariable(lazyFile, 'lazySubCommands');
const cliCommands = lazyMap && ts.isObjectLiteralExpression(lazyMap) ? lazyMap.properties.flatMap((node) => {
  const id = propertyName(node.name);
  if (!id) return [];
  let aliasOf;
  if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.initializer) && node.initializer.text !== id) aliasOf = node.initializer.text;
  return [{ id, ...(aliasOf ? { aliasOf } : {}), source: locator(lazyFile, node) }];
}) : [];

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

const tuiFile = join(root, 'packages/cli/src/signals/intent.ts');
const tuiCommands = arrayObjectCatalog(tuiFile, 'SLASH_COMMANDS', 'cmd', (node) => ({ description: stringValue(objectField(node, 'desc')) }));
const keyboardFile = join(root, 'packages/cli/src/signals/keyboard.ts');
const keyboardActions = discriminatedUnion(keyboardFile, 'KeyboardAction', 'type');
const builtinFile = join(root, 'packages/core/src/blocks/builtin-commands.ts');
const builtinCommands = arrayObjectCatalog(builtinFile, 'builtins', 'name', (node) => ({
  category: stringValue(objectField(node, 'category')),
  description: stringValue(objectField(node, 'desc')),
}));

const intentFile = join(root, 'packages/cli/src/signals/intent-types.ts');
const intents = discriminatedUnion(intentFile, 'Intent', 'type');

const mcpFiles = [
  ['packages/mcp/src/agon-orchestration.ts', 'ORCHESTRATION_TOOLS'],
  ['packages/mcp/src/rooms.ts', 'ROOM_TOOLS'],
  ['packages/mcp/src/job-tools.ts', 'JOB_TOOLS'],
  ['packages/mcp/src/project-context.ts', 'PROJECT_CONTEXT_TOOLS'],
];
const mcpTools = mcpFiles.flatMap(([path, variable]) => arrayObjectCatalog(join(root, path), variable, 'name').map((item) => ({ ...item, family: variable })));

const cesarFile = join(root, 'packages/cli/src/cesar/tools.ts');
const cesarSf = parsed.get(cesarFile);
const cesarTools = [];
function collectCesar(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'register' && node.arguments.length === 1) {
    const arg = node.arguments[0];
    if (ts.isCallExpression(arg) && ts.isIdentifier(arg.expression)) cesarTools.push({ id: arg.expression.text.replace(/^create|Tool$/g, ''), factory: arg.expression.text, source: locator(cesarFile, node) });
  }
  ts.forEachChild(node, collectCesar);
}
collectCesar(cesarSf);

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
  { id: 'docs/modes.md', generator: 'scripts/generate-mode-docs.mjs', source: 'package.json:12' },
  { id: 'AGENTS.md routing block', generator: 'packages/cli/src/commands/agent-guide-text.ts', source: 'packages/cli/src/commands/agent-guide-text.ts:1' },
  { id: 'installed agent prompts', generator: 'packages/cli/src/commands/install-agent-prompts.ts', source: 'packages/cli/src/commands/install-agent-prompts.ts:1' },
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
