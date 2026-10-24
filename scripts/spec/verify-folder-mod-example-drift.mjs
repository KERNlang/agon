import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const output = mkdtempSync(join(tmpdir(), 'agon-folder-mod-example-'));

function moduleSpecifiers(sourceText) {
  const source = ts.createSourceFile('index.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const values = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) values.push(node.moduleSpecifier.text);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) values.push(node.moduleReference.expression.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const [argument] = node.arguments; if (!argument || !ts.isStringLiteral(argument)) throw new Error('example may not use computed dynamic module loading');
      values.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values;
}

function assertPublicOnly(sourceText) {
  const imports = moduleSpecifiers(sourceText);
  if (imports.length === 0 || imports.some((specifier) => specifier !== '@kernlang/agon-mod-api')) {
    throw new Error('example source must import only the public @kernlang/agon-mod-api package');
  }
}

try {
  const exampleRoot = join(root, 'docs/examples/hello-folder-mod');
  const sourceText = readFileSync(join(exampleRoot, 'src/index.ts'), 'utf8');
  assertPublicOnly(sourceText);
  for (const mutant of [
    `${sourceText}\nvoid import('@kernlang/agon-kernel');`,
    `${sourceText}\nexport * from '@kernlang/agon-kernel';`,
    `${sourceText}\nrequire('@kernlang/agon-kernel');`,
  ]) {
    let rejected = false; try { assertPublicOnly(mutant); } catch { rejected = true; }
    if (!rejected) throw new Error('private-import negative control survived');
  }
  const packageJson = JSON.parse(readFileSync(join(exampleRoot, 'package.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(exampleRoot, 'agon.mod.json'), 'utf8'));
  if (packageJson.type !== 'module' || !manifest.pack.include.includes('package.json')) throw new Error('example ESM package metadata must be hash-bound in pack.include');

  const packRoot = join(output, 'packs'); mkdirSync(packRoot);
  const npmEnv = { ...process.env, npm_config_cache: join(output, 'npm-cache'), npm_config_logs_dir: join(output, 'npm-logs') };
  const pack = (path, label) => {
    const before = new Set(readdirSync(packRoot));
    const packed = spawnSync('npm', ['pack', path, '--pack-destination', packRoot, '--json'], { cwd: output, encoding: 'utf8', env: npmEnv });
    if (packed.status !== 0) throw new Error(packed.stderr || packed.stdout || `${label} pack failed`);
    const name = readdirSync(packRoot).find((entry) => entry.endsWith('.tgz') && !before.has(entry));
    if (!name) throw new Error(`${label} pack produced no tarball`); return join(packRoot, name);
  };
  const tarball = pack(join(root, 'packages/mod-api'), 'public Mod API');
  const zodTarball = pack(join(root, 'node_modules/zod'), 'zod public dependency');
  const semverTarball = pack(join(root, 'node_modules/semver'), 'semver public dependency');
  const isolated = join(output, 'isolated-example');
  cpSync(exampleRoot, isolated, { recursive: true }); rmSync(join(isolated, 'dist'), { recursive: true, force: true });
  const isolatedPackage = { ...packageJson, dependencies: { '@kernlang/agon-mod-api': `file:${tarball}`, zod: `file:${zodTarball}`, semver: `file:${semverTarball}` }, devDependencies: {} };
  writeFileSync(join(isolated, 'package.json'), JSON.stringify(isolatedPackage, null, 2));
  const installed = spawnSync('npm', ['install', '--ignore-scripts', '--offline', '--no-package-lock'], { cwd: isolated, encoding: 'utf8', env: npmEnv });
  if (installed.status !== 0) throw new Error(installed.stderr || installed.stdout || 'isolated public API install failed');
  const result = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(isolated, 'tsconfig.json')], { cwd: isolated, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'isolated example build failed');
  for (const name of ['index.js', 'index.d.ts']) {
    const expected = readFileSync(join(exampleRoot, 'dist', name), 'utf8'); const actual = readFileSync(join(isolated, 'dist', name), 'utf8');
    if (actual !== expected) throw new Error(`example dist drift: ${name}; rebuild the checked-in example`);
  }
  const namespace = await import(`${pathToFileURL(join(isolated, 'dist/index.js')).href}?verify=${Date.now()}`);
  if (typeof namespace.default !== 'function') throw new Error('example output lacks a default mod factory');
  const mod = await namespace.default({}); const registrations = [];
  await mod.activate({ command(surface, contribution) { registrations.push([surface, contribution.id]); } });
  if (mod.apiVersion !== '1' || JSON.stringify(registrations) !== JSON.stringify([['cli', 'hello-folder']])) throw new Error('example runtime does not register its declared public contribution');
  console.log(JSON.stringify({ passed: true, isolatedInstall: true, packedPublicApiOnly: true, privateImportNegativeControls: 3,
    files: ['agon.mod.json', 'package.json', 'src/index.ts', 'dist/index.js', 'dist/index.d.ts'], runtimeImported: true, publicApiOnly: true }));
} finally { rmSync(output, { recursive: true, force: true }); }
