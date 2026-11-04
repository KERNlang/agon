import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import ts from 'typescript';
import * as owner from '@kernlang/agon-mod-jobs';
import * as legacy from '../../packages/core/src/sessions/daemon-protocol.js';

const values = ['encodeDaemonRequest', 'encodeDaemonResponse', 'parseDaemonRequest', 'parseDaemonResponse', 'splitFrames'];
const types = ['DaemonRequest', 'DaemonResponse'];
const ownerPackage = '@kernlang/agon-mod-jobs';

function source(path: string) {
  const text = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  return { text, ast: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true) };
}

it('preserves the frozen daemon implementation after local type imports', () => {
  const { text, ast } = source('packages/mod-jobs/src/daemon-protocol.ts');
  const imports = ast.statements.filter(ts.isImportDeclaration);
  expect(imports).toHaveLength(2);
  expect(imports.every(node => node.importClause?.isTypeOnly)).toBe(true);
  const contracts = imports.map(node => ({
    path: ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '',
    names: node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
      ? node.importClause.namedBindings.elements.map(item => item.name.text).sort() : [],
  }));
  expect(contracts).toEqual([
    { path: './daemon-contract.js', names: ['DaemonJobRequest', 'DaemonJobResponse'] },
    { path: './job-service.js', names: ['JobEvent', 'JobOutcome', 'JobSnapshot'] },
  ]);
  // Frozen from main26c026356, excluding its single type-import line.
  const body = text.slice(imports[imports.length - 1].end + 1);
  expect(createHash('sha256').update(body).digest('hex')).toBe('d4649cb98142288c5dc99c3cd3be3232d80d5ffcd1d1d69a5f429e2b4f4941b3');
});

it('retains all Core value and type exports through the public owner', () => {
  const { ast } = source('packages/core/src/sessions/daemon-protocol.ts');
  expect(ast.statements).toHaveLength(2);
  expect(ast.statements.every(node => ts.isExportDeclaration(node)
    && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
    && node.moduleSpecifier.text === ownerPackage)).toBe(true);
  const declarations = ast.statements.filter(ts.isExportDeclaration);
  const names = (typeOnly: boolean) => declarations.filter(node => node.isTypeOnly === typeOnly)
    .flatMap(node => node.exportClause && ts.isNamedExports(node.exportClause)
      ? node.exportClause.elements.map(item => item.name.text) : []).sort();
  expect(names(false)).toEqual([...values].sort());
  expect(names(true)).toEqual([...types].sort());
});

it('keeps one function instance across Core and Jobs public exports', () => {
  expect(Object.keys(legacy).sort()).toEqual([...values].sort());
  for (const name of values) {
    const value = (owner as Record<string, unknown>)[name];
    expect(value, name).toBeTypeOf('function');
    expect((legacy as Record<string, unknown>)[name], name).toBe(value);
  }
});

it('imports all CLI daemon protocol symbols from Jobs', () => {
  const { ast } = source('packages/cli/src/commands/daemon.ts');
  const found = new Set<string>();
  for (const node of ast.statements.filter(ts.isImportDeclaration)) {
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    for (const binding of bindings.elements) {
      const name = binding.propertyName?.text ?? binding.name.text;
      if (![...values, ...types].includes(name)) continue;
      expect(node.moduleSpecifier.text, name).toBe(ownerPackage);
      found.add(name);
    }
  }
  expect([...found].sort()).toEqual([...values, ...types].sort());
});
