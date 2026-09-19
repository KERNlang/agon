import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const expected = new Map([
  ['engine-runtime', []],
  ['persistence', []],
  ['dedup', []],
  ['browser-bridge', []],
  ['saas-api', []],
  ['engine-catalog', ['engine-runtime']],
  ['verification', ['persistence']],
  ['panel', ['engine-runtime']],
  ['worktree', ['verification']],
  ['agent-runtime', ['engine-runtime', 'persistence', 'verification']],
  ['judge', ['panel', 'verification']],
]);

const legacyAdapters = new Map([
  ['packages/core/src/api/agent-loop.ts', 'agent-runtime'],
  ['packages/core/src/cesar/agent-session.ts', 'agent-runtime'],
  ['packages/core/src/blocks/syntax-validator-bridge.ts', 'browser-bridge'],
  ['packages/core/src/blocks/dedup-resolver.ts', 'dedup'],
  ['packages/core/src/signals/engine-registry.ts', 'engine-catalog'],
  ['packages/core/src/signals/engine-health.ts', 'engine-runtime'],
  ['packages/core/src/signals/chat-store.ts', 'persistence'],
  ['packages/core/src/sessions/history-search-bridge.ts', 'persistence'],
  ['packages/core/src/guards/guard-types.ts', 'verification'],
  ['packages/core/src/blocks/worktree-session.ts', 'worktree'],
  ['packages/forge/src/health-check.ts', 'panel'],
  ['packages/cli/src/cesar/judge.ts', 'judge'],
]);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

export function inspectSourceImports(text, source, directory) {
  const errors = [];
  const parsed = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true);
  const location = node => `${source}:${parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1}`;
  for (const diagnostic of parsed.parseDiagnostics) {
    errors.push(`${source}: parse error: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
  }
  function check(node) {
    if (!node || !(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
      errors.push(`${source}: computed module target requires explicit boundary review`);
      return;
    }
    const specifier = node.text;
    if (/^@kernlang\/agon-(?:core|cli|forge|dedup)(?:\/|$)/.test(specifier)) {
      errors.push(`${location(node)}: private legacy import ${specifier}`);
    }
    if (isAbsolute(specifier) || /^(?:file:|[A-Za-z]:[\\/])/.test(specifier)) {
      errors.push(`${location(node)}: absolute module target bypasses package exports (${specifier})`);
    }
    if (specifier.startsWith('.')) {
      const target = resolve(dirname(source), specifier);
      if (!(target === directory || target.startsWith(directory + sep))) {
        errors.push(`${location(node)}: relative import escapes package (${specifier})`);
      }
    }
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) check(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node)) {
      check(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : node.argument);
    } else if (ts.isExternalModuleReference(node)) {
      check(node.expression);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const requireCall = ts.isIdentifier(callee) && callee.text === 'require';
      const requireResolve = ts.isPropertyAccessExpression(callee)
        && ts.isIdentifier(callee.expression) && callee.expression.text === 'require'
        && callee.name.text === 'resolve';
      if (callee.kind === ts.SyntaxKind.ImportKeyword || requireCall || requireResolve) check(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return errors;
}

function inspect(definitions = expected) {
  const errors = [];
  for (const [name, dependencies] of definitions) {
    const directory = join(root, 'packages', `support-${name}`);
    const packageJsonPath = join(directory, 'package.json');
    if (!existsSync(packageJsonPath)) {
      errors.push(`missing package: support-${name}`);
      continue;
    }
    const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const expectedName = `@kernlang/agon-support-${name}`;
    if (manifest.name !== expectedName) errors.push(`${name}: wrong package name ${manifest.name}`);
    if (manifest.dependencies?.['@kernlang/agon-kernel']) errors.push(`${name}: kernel must be a peer, not a runtime dependency`);
    if (!manifest.peerDependencies?.['@kernlang/agon-kernel']) errors.push(`${name}: missing kernel peer contract`);
    const actualSupportDeps = Object.keys(manifest.dependencies ?? {})
      .filter((id) => id.startsWith('@kernlang/agon-support-'))
      .map((id) => id.slice('@kernlang/agon-support-'.length))
      .sort();
    const wanted = [...dependencies].sort();
    if (JSON.stringify(actualSupportDeps) !== JSON.stringify(wanted)) {
      errors.push(`${name}: support dependencies ${actualSupportDeps.join(',')} != ${wanted.join(',')}`);
    }
    const metadata = readFileSync(join(directory, 'src/package-metadata.ts'), 'utf8');
    if (/capabilities:\s*Object\.freeze\(\[\]\)/.test(metadata)) errors.push(`${name}: capability descriptor is empty`);

    for (const source of walk(join(directory, 'src')).filter((path) => /\.[cm]?[jt]sx?$/.test(path))) {
      const text = readFileSync(source, 'utf8');
      if (/export\s+function\s+configure[A-Z][A-Za-z0-9]*Runtime\s*\(/.test(text)) {
        errors.push(relative(root, source) + ": process-global runtime configurator crosses the package boundary");
      }
      errors.push(...inspectSourceImports(text, source, directory));
    }
  }

  for (const [path, owner] of legacyAdapters) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) {
      errors.push(`missing compatibility adapter: ${path}`);
      continue;
    }
    const text = readFileSync(absolute, 'utf8');
    if (!text.includes(`@kernlang/agon-support-${owner}`)) errors.push(`${path}: does not bind support-${owner}`);
  }

  const assetOwners = [
    ['packages/support-persistence/python/history-search.py', true],
    ['packages/support-dedup/python/history-search.py', false],
    ['packages/support-dedup/python/classifier.py', true],
    ['packages/support-dedup/python/embedder.py', true],
    ['packages/support-dedup/python/syntax-validator.py', true],
    ['packages/support-saas-api/python/routes/get_health.py', true],
  ];
  for (const [path, shouldExist] of assetOwners) {
    if (existsSync(join(root, path)) !== shouldExist) errors.push(`${path}: expected exists=${shouldExist}`);
  }
  return errors;
}

function main() {
  const errors = inspect();
  if (process.argv.includes('--self-test')) {
    const mutated = new Map(expected);
    mutated.set('judge', ['panel']);
    const mutationErrors = inspect(mutated);
    if (!mutationErrors.some((error) => error.includes('judge: support dependencies'))) {
      throw new Error('negative control failed: dependency mutation survived');
    }
    if (!/export\s+function\s+configure[A-Z][A-Za-z0-9]*Runtime\s*\(/.test("export function configureFakeRuntime(runtime: unknown): void {}")) {
      throw new Error("negative control failed: mutable runtime configurator survived");
    }
    const fixtureRoot = join(root, 'packages/support-fixture');
    const fixtureSource = join(fixtureRoot, 'src/test.mjs');
    for (const text of ["import('@kernlang/agon-core/private.js')", "require('@kernlang/agon-forge')", "import('../../core/private.js')", 'import(target)']) {
      if (inspectSourceImports(text, fixtureSource, fixtureRoot).length === 0) {
        throw new Error(`negative control failed: forbidden source survived: ${text}`);
      }
    }
    if (inspectSourceImports("// import '@kernlang/agon-core'\nimport 'node:fs';", fixtureSource, fixtureRoot).length !== 0) {
      throw new Error('negative control failed: comments or public imports were rejected');
    }
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log(`verified ${expected.size} support-package source boundaries, ${legacyAdapters.size} compatibility bindings, assets, and kernel peer declarations (not whole-product parity or runtime singleton proof)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
