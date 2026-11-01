import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import ts from 'typescript';

// Frozen from both declarations on main26c026356.
const legacy = `export interface BrainstormBid {
  engineId: string;
  confidence: number;
  reasoning: string;
  approach: string;
  score?: number;
}`;

function source(path: string) {
  return ts.createSourceFile(path, readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
}

function bidDeclaration(file: ts.SourceFile) {
  return file.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === 'BrainstormBid');
}

it('preserves the exact owned bid and removes the duplicate Core declaration', () => {
  const owner = source('packages/mod-brainstorm/src/workflow.ts');
  const core = source('packages/core/src/models/types.ts');
  const frozen = ts.createSourceFile('legacy.ts', legacy, ts.ScriptTarget.Latest, true);
  const printer = ts.createPrinter({ removeComments: true });
  expect(bidDeclaration(owner)).toBeDefined();
  expect(printer.printNode(ts.EmitHint.Unspecified, bidDeclaration(owner)!, owner))
    .toBe(printer.printNode(ts.EmitHint.Unspecified, bidDeclaration(frozen)!, frozen));
  expect(bidDeclaration(core) === undefined, 'Core must not declare a second bid').toBe(true);
  const forwards = core.statements.filter(ts.isExportDeclaration).flatMap(node =>
    node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
    && node.moduleSpecifier.text === '@kernlang/agon-mod-brainstorm'
    && node.exportClause && ts.isNamedExports(node.exportClause)
      ? node.exportClause.elements.map(element => element.name.text) : []);
  expect(forwards).toContain('BrainstormBid');
});

it('uses the public bid owner in the CLI', () => {
  const cli = source('packages/cli/src/commands/brainstorm.ts');
  const origins = cli.statements.filter(ts.isImportDeclaration).flatMap(node => {
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || !ts.isStringLiteral(node.moduleSpecifier)) return [];
    const origin = node.moduleSpecifier.text;
    return bindings.elements.filter(element => element.name.text === 'BrainstormBid')
      .map(() => origin);
  });
  expect(origins).toEqual(['@kernlang/agon-mod-brainstorm']);
});

it('compiles historical consumers with one declaration identity and unchanged shape', () => {
  const path = fileURLToPath(new URL('../brainstorm-bid-compile-only.ts', import.meta.url));
  const code = `
    import type { BrainstormBid as OldBid } from '@kernlang/agon-core';
    import type { BrainstormBid as OwnedBid } from '@kernlang/agon-mod-brainstorm';
    ${legacy.replace('export interface BrainstormBid', 'interface FrozenBid')}
    declare const owned: OwnedBid;
    declare const frozen: FrozenBid;
    const toFrozen: FrozenBid = owned;
    const fromFrozen: OwnedBid = frozen;
    const old: OldBid = fromFrozen;
    const returned: OwnedBid = old;
    const unscored: OwnedBid = {engineId:'fixture', confidence:0.5, reasoning:'r', approach:'a'};
    const scored: OwnedBid = {...unscored, score:1};
    // @ts-expect-error Score remains numeric.
    const badScore: OwnedBid = {...unscored, score:'high'};
    declare const missingApproach: Omit<OwnedBid, 'approach'>;
    // @ts-expect-error Approach remains required.
    const incomplete: OwnedBid = missingApproach;
  `;
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: true, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, onError, fresh) => name === path
    ? ts.createSourceFile(name, code, version, true)
    : original(name, version, onError, fresh);
  const program = ts.createProgram([path], options, host);
  expect(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
  const checker = program.getTypeChecker();
  const symbols = new Map<string, ts.Symbol>();
  for (const node of program.getSourceFile(path)!.statements) {
    if (!ts.isImportDeclaration(node)) continue;
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      symbols.set(element.name.text, checker.getAliasedSymbol(checker.getSymbolAtLocation(element.name)!));
    }
  }
  const owned = symbols.get('OwnedBid')!;
  expect(symbols.get('OldBid') === owned, 'Core must export the owned symbol').toBe(true);
  expect(owned.declarations?.map(node => node.getSourceFile().fileName))
    .toEqual([expect.stringMatching(/packages\/mod-brainstorm\/dist\/workflow\.d\.ts$/)]);
});
