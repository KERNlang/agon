import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import ts from 'typescript';
import * as core from '@kernlang/agon-core';
import * as owner from '@kernlang/agon-support-engine-runtime';
import * as legacyEstimator from '../../packages/core/src/sessions/token-estimator.js';
import * as legacyBudget from '../../packages/core/src/sessions/session-budget.js';

// Canonical non-import ASTs from main26c026356. Import relocation is intentional.
const frozen = {
  'token-estimator': '9a2c086e3887b90da3cd245342d397a6704d9cd08638d59826af08cc788cde32',
  'session-budget': 'dfafe1cae54708a99ba49b76dc97b91532752bdb59f85ee570998ec88d3cc07a',
};

function source(path: string) {
  return ts.createSourceFile(path, readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
}

it.each(Object.entries(frozen))('moves %s without changing its policy', (name, hash) => {
  const ast = source(`packages/support-engine-runtime/src/${name}.ts`);
  const printer = ts.createPrinter({ removeComments: true });
  const body = ast.statements.filter(node => !ts.isImportDeclaration(node))
    .map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast)).join('\n');
  expect(createHash('sha256').update(body).digest('hex')).toBe(hash);
  const imports = ast.statements.filter(ts.isImportDeclaration).map(node =>
    ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '');
  expect(imports).toEqual(name === 'token-estimator' ? ['./types.js'] : ['./types.js', './token-estimator.js']);
});

it.each(Object.keys(frozen))('keeps %s as an export-only compatibility path', name => {
  const ast = source(`packages/core/src/sessions/${name}.ts`);
  expect(ast.statements.length).toBeGreaterThan(0);
  expect(ast.statements.every(node => ts.isExportDeclaration(node)
    && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
    && node.moduleSpecifier.text === '@kernlang/agon-support-engine-runtime')).toBe(true);
});

it('keeps every legacy direct export identical to its public owner', () => {
  const owned = owner as Record<string, unknown>;
  expect(Object.keys(legacyEstimator).sort()).toEqual([
    'DEFAULT_CHARS_PER_TOKEN', 'MIN_RESERVE_TOKENS', 'RESERVE_WINDOW_FRACTION',
    'effectiveWindow', 'estimateFlatHistoryTokens', 'estimateMessageHistoryTokens',
    'estimateMessageTokens', 'estimatePtyTokens', 'estimateSessionTokens', 'resolveCharsPerToken',
  ].sort());
  expect(Object.keys(legacyBudget).sort()).toEqual([
    'DEFAULT_WARN_AT', 'DEFAULT_COMPACT_AT', 'DEFAULT_HARD_STOP_AT',
    'budgetRatioPct', 'checkSessionBudget', 'resolveThresholds',
  ].sort());
  for (const legacy of [legacyEstimator, legacyBudget]) {
    for (const [name, value] of Object.entries(legacy)) {
      expect(owned[name], name).toBeDefined();
      expect(value, name).toBe(owned[name]);
    }
  }
  for (const name of ['estimateSessionTokens', 'estimateMessageHistoryTokens',
    'estimateFlatHistoryTokens', 'estimatePtyTokens', 'estimateMessageTokens',
    'effectiveWindow', 'resolveCharsPerToken', 'checkSessionBudget',
    'resolveThresholds', 'budgetRatioPct']) {
    expect(owned[name], name).toBeTypeOf('function');
    expect((core as Record<string, unknown>)[name], name).toBe(owned[name]);
  }
});

it('routes Cesar budget policy directly to the public owner', () => {
  const ast = source('packages/cli/src/cesar/context-budget.ts');
  const imports = new Map<string, string>();
  for (const node of ast.statements.filter(ts.isImportDeclaration)) {
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    for (const item of bindings.elements) imports.set(item.propertyName?.text ?? item.name.text, node.moduleSpecifier.text);
  }
  for (const name of ['estimateSessionTokens', 'checkSessionBudget', 'budgetRatioPct', 'SessionBudget']) {
    expect(imports.get(name), name).toBe('@kernlang/agon-support-engine-runtime');
  }
  expect(imports.get('updateChatSummary')).toBe('@kernlang/agon-core');
});
