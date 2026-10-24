import { expect, it } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

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
