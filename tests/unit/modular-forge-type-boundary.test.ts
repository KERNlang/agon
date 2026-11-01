import { expect, it } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

it('records precise Forge declaration destinations without rewriting historical authority', () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const ledger = JSON.parse(read('docs/specs/evidence/modular-agon-slice5-migration-ledger.json'));
  const schemaPath = 'packages/mod-forge/schemas/config.schema.json';
  const schema = JSON.parse(read(schemaPath));
  const rows = ledger.assignments.filter((row: { package: string; legacyPath: string }) =>
    row.package === '@kernlang/agon-mod-forge' && row.legacyPath === 'packages/core/src/models/types.ts');
  expect(rows).toHaveLength(11);
  for (const row of rows) {
    const expected = row.category === 'configKeys' ? schemaPath
      : row.id === 'FitnessResult' ? 'packages/mod-forge/src/scoring.ts' : 'packages/mod-forge/src/types.ts';
    expect(row.implementationPaths, row.id).toEqual([expected]);
    expect(row.compatibilityAdapter).toBe('packages/core/src/models/types.ts');
    expect(row.authority).toBe('legacy-runtime-until-s6');
    if (row.category === 'configKeys') {
      expect(Object.hasOwn(schema.properties, row.id), row.id).toBe(true);
      expect(schema['x-agon-config'].legacyAliases).toContain(row.id);
    } else {
      const source = ts.createSourceFile(expected, read(expected), ts.ScriptTarget.Latest, true);
      const declarations = source.statements.filter(statement =>
        ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement));
      expect(declarations.some(declaration => declaration.name.text === row.id), row.id).toBe(true);
    }
  }
});

const names = [
  'ForgeOptions', 'EngineResult', 'SkippedEngine', 'DispatchMetric', 'ForgeManifest',
  'ConvergenceEntry', 'ForgeJudgment', 'ForgeEventType', 'ForgeEvent', 'ForgeEventMap',
  'ForgeEventCallback', 'BreakerArtifact', 'GauntletResult', 'CorpusEntry', 'GapPattern',
];

it('resolves old Core and public Forge imports to the same owned declarations', () => {
  const path = fileURLToPath(new URL('../forge-compile-only.ts', import.meta.url));
  const source = `
    import type { ${names.map(name => `${name} as Old${name}`).join(', ')} } from '@kernlang/agon-core';
    import type { ${names.map(name => `${name} as Owned${name}`).join(', ')} } from '@kernlang/agon-mod-forge';
    declare const manifest: OwnedForgeManifest;
    const oldManifest: OldForgeManifest = manifest;
    const newManifest: OwnedForgeManifest = oldManifest;
    const event: OwnedForgeEvent = { type: 'gauntlet:done' };
    const callback: OldForgeEventCallback = (_event: OwnedForgeEvent) => {};
    callback(event);
    // @ts-expect-error The event discriminator stays closed.
    const invalid: OwnedForgeEvent = { type: 'unknown:event' };
    // @ts-expect-error A manifest still requires its persisted fields.
    const incomplete: OwnedForgeManifest = { forgeId: 'fixture' };
    // @ts-expect-error Mode is not an arbitrary string.
    const mode: OwnedForgeOptions['mode'] = 'unknown';
    // @ts-expect-error The gauntlet completion payload requires repairPass.
    const payload: OwnedForgeEventMap['gauntlet:done'] = { attacksLanded: 1 };
  `;
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, types: [],
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, onError, fresh) => name === path
    ? ts.createSourceFile(name, source, version, true)
    : original(name, version, onError, fresh);
  const program = ts.createProgram([path], options, host);
  expect(ts.getPreEmitDiagnostics(program).map(diagnostic =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
  const checker = program.getTypeChecker();
  const imported = new Map<string, ts.Symbol>();
  for (const statement of program.getSourceFile(path)!.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      imported.set(element.name.text, checker.getAliasedSymbol(checker.getSymbolAtLocation(element.name)!));
    }
  }
  for (const name of names) {
    const owned = imported.get(`Owned${name}`)!;
    expect(imported.get(`Old${name}`), name).toBe(owned);
    expect(owned.declarations?.map(declaration => declaration.getSourceFile().fileName), name)
      .toEqual([expect.stringMatching(/packages\/mod-forge\/dist\/types\.d\.ts$/)]);
  }
});
