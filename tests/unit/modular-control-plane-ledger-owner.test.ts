import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import ts from 'typescript';
import * as owner from '@kernlang/agon-support-persistence';
import * as legacy from '../../packages/core/src/sessions/control-plane-ledger.js';
import { resetEventLogState, appendDurable, replay } from '../../packages/core/src/sessions/event-log.js';

function source(path: string) {
  return ts.createSourceFile(path, readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
}

it('moves the frozen recovery policy without changing its semantics', () => {
  const ast = source('packages/support-persistence/src/control-plane-ledger.ts');
  const printer = ts.createPrinter({ removeComments: true });
  const body = ast.statements.filter(node => !ts.isImportDeclaration(node))
    .map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast)).join('\n');
  // Frozen from Git object 26c026356, not from the candidate implementation.
  expect(createHash('sha256').update(body).digest('hex')).toBe('485c0fe16d2bf3ca652a2c9b8bb0b2a59bcdb8bdf0e0e243191130ea23fc1ef7');
  const imports = ast.statements.filter(ts.isImportDeclaration).map(node =>
    ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '');
  expect(imports).toEqual(['./event-log.js', './event-log.js']);
});

it('keeps the old ledger path export-only with its complete contract', () => {
  const ast = source('packages/core/src/sessions/control-plane-ledger.ts');
  expect(ast.statements.length).toBeGreaterThan(0);
  expect(ast.statements.every(node => ts.isExportDeclaration(node)
    && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
    && node.moduleSpecifier.text === '@kernlang/agon-support-persistence')).toBe(true);
  const names = ast.statements.filter(ts.isExportDeclaration).flatMap(node =>
    node.exportClause && ts.isNamedExports(node.exportClause)
      ? node.exportClause.elements.map(item => item.name.text) : []);
  expect(names.sort()).toEqual(['ControlPlaneRecovery', 'appendControlPlaneEvent', 'recoverControlPlane'].sort());
});

it('keeps legacy runtime functions identical to the public owner', () => {
  expect(Object.keys(legacy).sort()).toEqual(['appendControlPlaneEvent', 'recoverControlPlane']);
  const exports = owner as Record<string, unknown>;
  for (const [name, value] of Object.entries(legacy)) {
    expect(exports[name], name).toBeTypeOf('function');
    expect(value, name).toBe(exports[name]);
  }
  expect(resetEventLogState).toBe(owner.resetEventLogState);
  expect(appendDurable).toBe(owner.appendDurable);
  expect(replay).toBe(owner.replay);
});

it('routes Cesar durable recovery directly through Persistence', () => {
  const ast = source('packages/cli/src/cesar/turn-runtime.ts');
  const imports = new Map<string, string>();
  for (const node of ast.statements.filter(ts.isImportDeclaration)) {
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    for (const item of bindings.elements) imports.set(item.propertyName?.text ?? item.name.text, node.moduleSpecifier.text);
  }
  for (const name of ['appendControlPlaneEvent', 'recoverControlPlane']) {
    expect(imports.get(name), name).toBe('@kernlang/agon-support-persistence');
  }
});

it('recovers pending claims through the built owner after a process restart', () => {
  const home = mkdtempSync(join(tmpdir(), 'agon-ledger-owner-'));
  const moduleUrl = new URL('../../packages/support-persistence/dist/index.js', import.meta.url).href;
  const env = { ...process.env, AGON_HOME: home };
  const run = (code: string) => execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    env, encoding: 'utf8', timeout: 10_000,
  });
  try {
    const written = run(`
      import { appendControlPlaneEvent } from ${JSON.stringify(moduleUrl)};
      const envelope = { schemaVersion: 1, sessionId: 'restart', turnId: 't1', leaseEpoch: 7, attempt: 1, producerId: 'fixture' };
      const results = [
        appendControlPlaneEvent('restart', { type: 'tool_claimed', envelope, toolCallId: 'pending-write', effectClass: 'mutation' }),
        appendControlPlaneEvent('restart', { type: 'tool_claimed', envelope, toolCallId: 'pending-read', effectClass: 'read_only' }),
      ];
      console.log(JSON.stringify(results));
    `);
    expect(JSON.parse(written)).toEqual([{ ok: true, seq: 1 }, { ok: true, seq: 2 }]);
    const recovered = run(`
      import { recoverControlPlane, appendControlPlaneEvent } from ${JSON.stringify(moduleUrl)};
      console.log(JSON.stringify({
        recovery: recoverControlPlane('restart'),
        terminal: appendControlPlaneEvent('restart', { type: 'turn_started', envelope: { schemaVersion: 1, leaseEpoch: 8 } }),
      }));
    `);
    expect(JSON.parse(recovered)).toEqual({
      recovery: { nextLeaseEpoch: 8, needsInspection: ['pending-write'], retryableReadOnly: ['pending-read'], unsupportedSchema: false },
      terminal: { ok: true, seq: 3 },
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
