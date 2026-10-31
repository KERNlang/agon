import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import ts from 'typescript';

const names = ['ControlPlaneEnvelopeV1', 'SessionChunk', 'SessionSendOptions', 'PersistentSession'];
const fixtureUrl = new URL('../fixtures/modular-persistent-session-contract-legacy.ts', import.meta.url);
const ownerUrl = new URL('../../packages/support-persistence/src/session-contracts.ts', import.meta.url);

function declarations(text: string): Map<string, string> {
  const source = ts.createSourceFile('contract.ts', text, ts.ScriptTarget.Latest, true);
  const printer = ts.createPrinter({ removeComments: true });
  return new Map(source.statements.filter(ts.isInterfaceDeclaration)
    .map(node => [node.name.text, printer.printNode(ts.EmitHint.Unspecified, node, source)]));
}

it('keeps the exact legacy contract under one physical Persistence owner', () => {
  const frozen = declarations(readFileSync(fixtureUrl, 'utf8'));
  const owned = declarations(readFileSync(ownerUrl, 'utf8'));
  expect([...frozen.keys()]).toEqual(names);
  expect(owned).toEqual(frozen);
  for (const path of ['persistent-session.ts', 'turn-protocol.ts']) {
    const text = readFileSync(new URL(`../../packages/core/src/sessions/${path}`, import.meta.url), 'utf8');
    const legacy = declarations(text);
    for (const name of names) expect(legacy.has(name), `${path}: ${name}`).toBe(false);
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const forwarded = source.statements.filter(ts.isExportDeclaration).flatMap(statement =>
      statement.isTypeOnly && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.moduleSpecifier.text === '@kernlang/agon-support-persistence'
      && statement.exportClause && ts.isNamedExports(statement.exportClause)
        ? statement.exportClause.elements.map(element => element.name.text) : []);
    expect(forwarded.sort()).toEqual((path === 'turn-protocol.ts' ? names.slice(0, 1) : names.slice(1)).sort());
  }
});

it.each(['acp', 'companion', 'pty', 'resume', 'streamjson'])('imports %s transport contracts from the public owner', transport => {
  const path = `../../packages/core/src/sessions/session-${transport}.ts`;
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const imports = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) imports.set(element.name.text, statement.moduleSpecifier.text);
  }
  const required = transport === 'pty' ? ['PersistentSession'] : names.slice(1);
  for (const name of required) {
    expect(imports.get(name), name).toBe('@kernlang/agon-support-persistence');
  }
  expect(imports.get('PersistentSessionConfig')).toBe('./persistent-session.js');
});

it('detects missing fields, missing methods and changed send semantics', () => {
  const source = readFileSync(fixtureUrl, 'utf8');
  const frozen = declarations(source);
  for (const [before, after] of [
    ['controlPlane?: ControlPlaneEnvelopeV1;', ''],
    ['start: () => Promise<void>;', ''],
    ['AsyncGenerator<SessionChunk, void, void>', 'Promise<SessionChunk>'],
  ]) {
    const mutated = source.replace(before, after);
    expect(mutated).not.toBe(source);
    expect(declarations(mutated)).not.toEqual(frozen);
  }
});

it('compiles public consumers and resolves compatibility exports to the owned declarations', () => {
  const path = fileURLToPath(new URL('../persistent-session-compile-only.ts', import.meta.url));
  const source = `
    import type { ${names.map(name => `${name} as Owned${name}`).join(', ')} } from '@kernlang/agon-support-persistence';
    import type { ${names.slice(1).map(name => `${name} as Old${name}`).join(', ')} } from '@kernlang/agon-core';
    import type { ControlPlaneEnvelopeV1 as OldControlPlaneEnvelopeV1 } from '../packages/core/dist/sessions/turn-protocol.js';
    import type { ${names.slice(1).map(name => `${name} as LegacyFile${name}`).join(', ')} } from '../packages/core/dist/sessions/persistent-session.js';
    import type { ${names.map(name => `${name} as Frozen${name}`).join(', ')} } from './fixtures/modular-persistent-session-contract-legacy.js';
    ${names.map(name => `
      declare const owned${name}: Owned${name};
      const frozen${name}: Frozen${name} = owned${name};
      const restored${name}: Owned${name} = frozen${name};
      const old${name}: Old${name} = restored${name};
      const roundTrip${name}: Owned${name} = old${name};
    `).join('\n')}
    declare const session: OwnedPersistentSession;
    const chunks: AsyncGenerator<OwnedSessionChunk, void, void> = session.send({
      message: 'go', controlPlane: { schemaVersion: 1, sessionId: 's', turnId: 't',
        leaseEpoch: 1, attempt: 1, producerId: 'fixture', responseSeq: 1,
        stepId: 'step', toolCallId: 'tool' },
    });
    // @ts-expect-error The chunk discriminator stays closed.
    const badChunk: OwnedSessionChunk = { type: 'unknown', content: '' };
    // @ts-expect-error The message remains required.
    session.send({});
    // @ts-expect-error A string cannot replace the message options.
    session.send('go');
    // @ts-expect-error The control envelope remains version one.
    const version: OwnedControlPlaneEnvelopeV1['schemaVersion'] = 2;
    declare const withoutStart: Omit<OwnedPersistentSession, 'start'>;
    // @ts-expect-error The start method remains required.
    const missing: OwnedPersistentSession = withoutStart;
  `;
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: true, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
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
    if (name !== 'ControlPlaneEnvelopeV1') expect(imported.get(`LegacyFile${name}`), name).toBe(owned);
    expect(owned.declarations?.map(declaration => declaration.getSourceFile().fileName), name)
      .toEqual([expect.stringMatching(/packages\/support-persistence\/dist\/session-contracts\.d\.ts$/)]);
  }
});
