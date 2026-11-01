import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import ts from 'typescript';
import * as owner from '@kernlang/agon-support-engine-runtime';
import * as legacy from '../../packages/core/src/sessions/turn-protocol.js';

const values = [
  'controlPlaneIdentity', 'isCurrentCesarResponse', 'isCurrentControlPlaneEnvelope',
  'isTerminalTurnState', 'reduceTurnLifecycle', 'validateControlPlaneEnvelope',
];
const types = [
  'ControlPlaneEnvelopeV1', 'ControlPlaneEnvelopeValidation',
  'TurnLifecycleState', 'TurnLifecycleTransition',
];

function source(path: string) {
  return ts.createSourceFile(path, readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
}

it('preserves the frozen turn protocol bytes at the runtime owner', () => {
  const bytes = readFileSync(new URL('../../packages/support-engine-runtime/src/turn-protocol.ts', import.meta.url));
  // Frozen from the pre-extraction Git object 26c026356.
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('1dd85a16c13c118435512ce2abab7bec9433982c4ec6fe6fa72251b6b1164034');
});

it('preserves the complete legacy contract as explicit public re-exports', () => {
  const ast = source('packages/core/src/sessions/turn-protocol.ts');
  expect(ast.statements.length).toBeGreaterThan(0);
  expect(ast.statements.every(node => ts.isExportDeclaration(node)
    && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
    && node.moduleSpecifier.text === '@kernlang/agon-support-engine-runtime')).toBe(true);
  const exports = ast.statements.filter(ts.isExportDeclaration);
  const names = (typeOnly: boolean) => exports.filter(node => node.isTypeOnly === typeOnly)
    .flatMap(node => node.exportClause && ts.isNamedExports(node.exportClause)
      ? node.exportClause.elements.map(item => item.name.text) : []).sort();
  expect(names(false)).toEqual([...values].sort());
  expect(names(true)).toEqual([...types].sort());
});

it('uses one public function instance for every legacy protocol export', () => {
  expect(Object.keys(legacy).sort()).toEqual([...values].sort());
  for (const name of values) {
    const value = (owner as Record<string, unknown>)[name];
    expect(value, name).toBeTypeOf('function');
    expect((legacy as Record<string, unknown>)[name], name).toBe(value);
  }
});

it('routes CLI protocol imports through the public runtime owner', () => {
  const ast = source('packages/cli/src/cesar/turn-runtime.ts');
  const used = new Set<string>();
  for (const node of ast.statements.filter(ts.isImportDeclaration)) {
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    for (const item of bindings.elements) {
      const name = item.propertyName?.text ?? item.name.text;
      if (![...values, ...types].includes(name)) continue;
      expect(node.moduleSpecifier.text, name).toBe('@kernlang/agon-support-engine-runtime');
      used.add(name);
    }
  }
  expect([...used].sort()).toEqual([
    'ControlPlaneEnvelopeV1', 'TurnLifecycleState', 'TurnLifecycleTransition',
    'isCurrentCesarResponse', 'isCurrentControlPlaneEnvelope',
    'isTerminalTurnState', 'reduceTurnLifecycle',
  ].sort());
});
