import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import ts from 'typescript';
import * as owner from '@kernlang/agon-support-engine-runtime';
import * as legacy from '../../packages/core/src/sessions/first-chunk-retry-policy.js';

function source(path: string) {
  return ts.createSourceFile(path, readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
}

it('preserves the frozen first-chunk retry policy at its runtime owner', () => {
  const ast = source('packages/support-engine-runtime/src/first-chunk-retry-policy.ts');
  const printer = ts.createPrinter({ removeComments: true });
  const body = ast.statements.map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast)).join('\n');
  // Frozen from the pre-extraction Git object 26c026356.
  expect(createHash('sha256').update(body).digest('hex')).toBe('8b5563dc99127fcaae53a91fe48bab9b57b93e7be2822196b3010acbe9621e9f');
});

it('keeps the legacy policy path export-only with its complete contract', () => {
  const ast = source('packages/core/src/sessions/first-chunk-retry-policy.ts');
  expect(ast.statements.length).toBeGreaterThan(0);
  expect(ast.statements.every(node => ts.isExportDeclaration(node)
    && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
    && node.moduleSpecifier.text === '@kernlang/agon-support-engine-runtime')).toBe(true);
  const names = ast.statements.filter(ts.isExportDeclaration).flatMap(node =>
    node.exportClause && ts.isNamedExports(node.exportClause)
      ? node.exportClause.elements.map(item => item.name.text) : []);
  expect(names.sort()).toEqual(['FirstChunkRetryDecision', 'FirstChunkRetryInput', 'decideFirstChunkRetry']);
});

it('preserves one public policy function for legacy callers', () => {
  expect(Object.keys(legacy)).toEqual(['decideFirstChunkRetry']);
  const exported = (owner as Record<string, unknown>).decideFirstChunkRetry;
  expect(exported).toBeTypeOf('function');
  expect(legacy.decideFirstChunkRetry).toBe(exported);
});

it('routes the session retry decision through the public runtime owner', () => {
  const ast = source('packages/core/src/sessions/session-resume.ts');
  const targets: string[] = [];
  for (const node of ast.statements.filter(ts.isImportDeclaration)) {
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    if (bindings.elements.some(item => (item.propertyName?.text ?? item.name.text) === 'decideFirstChunkRetry')) {
      targets.push(node.moduleSpecifier.text);
    }
  }
  expect(targets).toEqual(['@kernlang/agon-support-engine-runtime']);
});
