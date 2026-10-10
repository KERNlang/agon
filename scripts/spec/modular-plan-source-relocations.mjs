import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const legacyPath = 'packages/core/src/cesar/plan.ts';
const definitionPath = 'packages/mod-plan/src/execution-model.ts';
const evidencePath = 'tests/unit/modular-plan-facade-retirement.test.ts';
const runtimeBindings = [
  'packages/cli/src/handlers/plan-mode.ts',
  'packages/cli/src/signals/dispatch/plan-execution.ts',
];
const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

// These inventory rows were collected from type declarations, not dispatchers.
// Relocating a declaration does not prove that its execution owner is retired.
export function collectPlanSourceRelocations(root, assignments) {
  const rows = assignments.filter(({ source }) => source.replace(/:\d+(?::\d+)?$/, '') === legacyPath);
  if (!rows.length || existsSync(resolve(root, legacyPath))) return [];
  const definition = readFileSync(resolve(root, definitionPath), 'utf8');
  const file = ts.createSourceFile(definitionPath, definition, ts.ScriptTarget.Latest, true);
  if (file.parseDiagnostics.length) throw new Error('Plan relocation: invalid definition syntax');
  const exported = file.statements.filter(statement => statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
  const stepType = exported.find(statement => ts.isTypeAliasDeclaration(statement) && statement.name.text === 'CesarStepType');
  if (!stepType || !ts.isUnionTypeNode(stepType.type)
    || !stepType.type.types.every(node => ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal))) {
    throw new Error('Plan relocation: expected exported literal CesarStepType union');
  }
  const steps = new Set(stepType.type.types.map(node => node.literal.text));
  const interfaces = new Set(exported.filter(ts.isInterfaceDeclaration).map(statement => statement.name.text));
  const evidenceHash = sha256(readFileSync(resolve(root, evidencePath)));
  const bindingHashes = Object.fromEntries(runtimeBindings.map(path => [path, sha256(readFileSync(resolve(root, path)))]));
  return rows.map(row => {
    const route = row.category === 'cesarRoutes';
    if (!(route ? steps.has(row.id) : row.category === 'resultAndEnvelopeTypes' && interfaces.has(row.id))) {
      throw new Error(`Plan relocation: missing declaration ${row.category}/${row.id}`);
    }
    return {
      ...row,
      legacyPath,
      legacyPresent: false,
      definitionOwner: '@kernlang/agon-mod-plan',
      implementationPaths: [definitionPath],
      definitionHash: sha256(definition),
      removalEvidence: evidencePath,
      removalEvidenceHash: evidenceHash,
      evidenceScope: 'declaration-relocation-only',
      remainingRuntimeBindings: route ? runtimeBindings : [],
      runtimeBindingHashes: route ? bindingHashes : {},
    };
  });
}
