import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
import * as core from '@kernlang/agon-core';
import * as owner from '@kernlang/agon-support-worktree';

const root = fileURLToPath(new URL('../../', import.meta.url));
const retired = ['packages/core/src/blocks/patch-parser.ts', 'packages/core/src/utils/patch.ts'];
const targets = new Set(retired.map(path => resolve(root, path)));

function retiredImports(path: string, text: string): string[] {
  return ts.preProcessFile(text, true, true).importedFiles
    .map(item => item.fileName)
    .filter(name => name.startsWith('.') && targets.has(resolve(dirname(path), name).replace(/\.js$/, '.ts')));
}
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

it('removes the parser and normalization facades from core source', () => {
  for (const path of targets) expect(existsSync(path), path).toBe(false);
});

it('leaves no production source import of either retired facade', () => {
  const violations: string[] = [];
  for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    const directory = join(root, 'packages', entry.name, 'src');
    if (!entry.isDirectory() || !existsSync(directory)) continue;
    for (const path of sourceFiles(directory)) {
      for (const imported of retiredImports(path, readFileSync(path, 'utf8'))) violations.push(`${path}: ${imported}`);
    }
  }
  expect(violations).toEqual([]);
});

it('detects a restored static, dynamic or re-export edge', () => {
  const path = join(root, 'packages/core/src/index.ts');
  for (const source of [
    "import { parsePatch } from './blocks/patch-parser.js';",
    "export { parsePatch } from './blocks/patch-parser.js';",
    "const mod = import('./utils/patch.js');",
  ]) expect(retiredImports(path, source)).toHaveLength(1);
  expect(retiredImports(path, "export { parsePatch } from '@kernlang/agon-support-worktree';")).toEqual([]);
});

it('preserves core public parser exports as the same physical functions', () => {
  expect(core.parsePatch).toBe(owner.parsePatch);
  expect(core.patchSummary).toBe(owner.patchSummary);
  expect(core.invertPatch).toBe(owner.invertPatch);
});

function corePatchImports(text: string): string[] {
  const file = ts.createSourceFile('subject.ts', text, ts.ScriptTarget.Latest, true);
  return file.statements.flatMap(statement => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== '@kernlang/agon-core') return [];
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return [];
    return bindings.elements.map(element => (element.propertyName ?? element.name).text)
      .filter(name => name === 'applyPatchWithUndo' || name === 'undoPatch');
  });
}

it('keeps CLI apply and undo consumers off the legacy core binding', () => {
  const violations = sourceFiles(join(root, 'packages/cli/src')).flatMap(path =>
    corePatchImports(readFileSync(path, 'utf8')).map(name => `${path}: ${name}`));
  expect(violations).toEqual([]);
});

it('detects renamed imports of legacy patch operations', () => {
  expect(corePatchImports("import { undoPatch as undo, applyPatchWithUndo } from '@kernlang/agon-core';"))
    .toEqual(['undoPatch', 'applyPatchWithUndo']);
  expect(corePatchImports("import { undoPatch } from '@kernlang/agon-support-worktree';")).toEqual([]);
});
