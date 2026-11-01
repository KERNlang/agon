import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
import * as core from '../../packages/core/src/index.js';
import * as builtCore from '@kernlang/agon-core';
import * as owner from '@kernlang/agon-support-persistence';
import { pasteStore, PasteStore } from '../../packages/core/src/paste-store.js';

const root = fileURLToPath(new URL('../../packages/core/src/', import.meta.url));
// These paths remain compatibility entrypoints, not internal dependencies.
const adapters = [
  'blocks/file-history.ts', 'blocks/file-lock.ts', 'models/session-result-types.ts',
  'sessions/brain-client.ts', 'sessions/event-log.ts', 'sessions/history-search-bridge.ts',
  'signals/chat-store.ts', 'signals/delegate-ledger.ts', 'signals/flow.ts',
  'signals/paste-store.ts', 'signals/run-dir.ts', 'signals/session-store.ts',
];
const targets = new Set(adapters.map(path => resolve(root, path)));

function adapterImports(path: string, source: string): string[] {
  return ts.preProcessFile(source, true, true).importedFiles
    .map(item => item.fileName)
    .filter(name => name.startsWith('.') && targets.has(resolve(dirname(path), name).replace(/\.js$/, '.ts')));
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

it('uses the persistence owner directly inside Core', () => {
  const violations = sourceFiles(root).flatMap(path =>
    adapterImports(path, readFileSync(path, 'utf8')).map(name => `${relative(root, path)}: ${name}`));
  expect(violations).toEqual([]);
});

it.each(adapters)('detects a restored dependency on %s', path => {
  const specifier = `./${path.replace(/\.ts$/, '.js')}`;
  for (const source of [
    `import { value } from '${specifier}';`,
    `import type { Value } from '${specifier}';`,
    `export { value as alias } from '${specifier}';`,
    `export type { Value } from '${specifier}';`,
    `type Value = import('${specifier}').Value;`,
    `const mod = import('${specifier}');`,
    `const mod = import(\`${specifier}\`);`,
  ]) expect(adapterImports(join(root, 'index.ts'), source), source).toEqual([specifier]);
});

it('allows the public owner and ignores comments and unrelated bindings', () => {
  expect(adapterImports(join(root, 'index.ts'), [
    "export { takeSnapshot } from '@kernlang/agon-support-persistence';",
    "// import { takeSnapshot } from './blocks/file-history.js';",
    "const text = \"import('./blocks/file-history.js')\";",
    "import { pasteStore } from './paste-store.js';",
    "import { createPtySession } from './sessions/session-pty.js';",
  ].join('\n'))).toEqual([]);
});

it('preserves public aliases and physical persistence function identity', () => {
  for (const value of [
    owner.takeSnapshot, owner.withFileLock, owner.saveToolResultToDisk,
    owner.recordApiLoopDispatch, owner.searchHistorySemantic, owner.createRunDir,
    owner.startChatSession, owner.canonicalCapabilityInputDigest, owner.logFlow,
    owner.append, owner.flush, owner.replay,
  ]) expect(value).toBeTypeOf('function');
  expect(core.takeSnapshot).toBe(owner.takeSnapshot);
  expect(core.withFileLock).toBe(owner.withFileLock);
  expect(core.saveToolResultToDisk).toBe(owner.saveToolResultToDisk);
  expect(core.recordApiLoopDispatch).toBe(owner.recordApiLoopDispatch);
  expect(core.searchHistorySemantic).toBe(owner.searchHistorySemantic);
  expect(core.createRunDir).toBe(owner.createRunDir);
  expect(core.startChatSession).toBe(owner.startChatSession);
  expect(core.canonicalCapabilityInputDigest).toBe(owner.canonicalCapabilityInputDigest);
  expect(core.logFlow).toBe(owner.logFlow);
  expect(core.eventLogAppend).toBe(owner.append);
  expect(core.eventLogFlush).toBe(owner.flush);
  expect(core.eventLogReplay).toBe(owner.replay);
});

it('keeps one Core paste store with the owner class and shared disk behavior', () => {
  expect(PasteStore).toBe(owner.PasteStore);
  expect(core.pasteStore).toBe(pasteStore);
  expect(pasteStore).toBeInstanceOf(owner.PasteStore);
  expect(core.PASTE_MAX_AGE).toBe(owner.PASTE_MAX_AGE);
  const stored = core.pasteStore.store('Core persistence ownership\nshared paste');
  expect(pasteStore.retrieve(stored.hash)).toBe('Core persistence ownership\nshared paste');
  expect(new owner.PasteStore().retrieve(stored.hash)).toBe('Core persistence ownership\nshared paste');
});

it('preserves persistence identities through the built public package entrypoint', async () => {
  expect(builtCore.takeSnapshot).toBeTypeOf('function');
  expect(builtCore.takeSnapshot).toBe(owner.takeSnapshot);
  expect(builtCore.eventLogAppend).toBeTypeOf('function');
  expect(builtCore.eventLogAppend).toBe(owner.append);
  expect(builtCore.pasteStore).toBeInstanceOf(owner.PasteStore);
  const secondConsumer = await import('@kernlang/agon-core');
  expect(secondConsumer.pasteStore).toBe(builtCore.pasteStore);
  const stored = builtCore.pasteStore.store('Built Core persistence ownership');
  expect(secondConsumer.pasteStore.retrieve(stored.hash)).toBe('Built Core persistence ownership');
  expect(new owner.PasteStore().retrieve(stored.hash)).toBe('Built Core persistence ownership');
});
