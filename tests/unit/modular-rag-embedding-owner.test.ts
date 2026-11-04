import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandContribution, InvocationContext, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from '../../packages/mod-rag/src/implementation.js';
import { loadRagIndex } from '../../packages/mod-rag/src/store.js';
import { embedTexts, embedForWorkflow } from '../../packages/mod-rag/src/embedding.js';

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'agon-rag-embedding-'));
  roots.push(root);
  const executable = join(root, 'embedder-fixture.cjs');
  writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(__filename + '.calls', 'called\\n');
if (fs.existsSync(__filename + '.fail')) {
  process.stderr.write('fixture embedding failure');
  process.exit(2);
}
if (fs.existsSync(__filename + '.wait')) {
  setInterval(() => {}, 1000);
} else {
  const rows = fs.readFileSync(0, 'utf8').trim().split('\\n').map(JSON.parse);
  process.stdout.write(JSON.stringify({ model: 'fixture', dims: 2,
    vectors: rows.map(row => ({ id: row.id, vector: [1, 0] })) }));
}
`);
  chmodSync(executable, 0o755);
  vi.stubEnv('AGON_PYTHON', executable);
  writeFileSync(join(root, 'README.md'), '# Evidence\nOne bounded document.\n');
  return { root, executable };
}

async function registered(root: string, allowed: boolean) {
  let command: CommandContribution | undefined;
  const cleanup = vi.fn();
  const permission = vi.fn(async () => allowed ? 'allow' : 'deny');
  const receipts = vi.fn(async () => 'fixture-receipt');
  const services = { permissions: { check: permission }, receipts: { record: receipts } } as unknown as ModServices;
  const registrar = {
    command: (_surface, value) => { command = value; return cleanup; },
    tool: () => cleanup,
    resultType: () => cleanup,
  } as Registrar;
  const mod = await createMod(services);
  const dispose = await mod.activate(registrar);
  if (!command) throw new Error('RAG did not register its CLI command');
  const context: InvocationContext = {
    invocationId: 'embedding-fixture', cwd: root, platform: 'darwin-arm64',
    signal: new AbortController().signal, config: {},
  };
  return { command, context, dispose, cleanup, permission, receipts };
}

describe('RAG embedding ownership at execution boundaries', () => {
  it('indexes and queries through the registered command and keeps prior data after a failed rebuild', async () => {
    const { root, executable } = fixture();
    const host = await registered(root, true);
    try {
      const indexed = await host.command.run({ action: 'index' }, host.context);
      expect(indexed).toMatchObject({ exitCode: 0, result: { chunkCount: 1, reused: false } });
      const before = loadRagIndex(root);
      expect(before?.manifest.model).toBe('fixture');
      const queried = await host.command.run({ action: 'query', text: 'Evidence' }, host.context);
      expect(queried).toMatchObject({ exitCode: 0, result: { grounded: true, hits: [{ source: 'README.md', score: 1 }] } });
      expect(readFileSync(executable + '.calls', 'utf8').trim().split('\n')).toHaveLength(2);
      writeFileSync(executable + '.fail', '');
      const failed = await host.command.run({ action: 'index', force: true }, host.context);
      expect(failed).toMatchObject({ exitCode: 1, stderr: 'RAG embedder failed: fixture embedding failure\n' });
      expect(loadRagIndex(root)).toEqual(before);
      expect(host.receipts).toHaveBeenCalledTimes(2);
    } finally { await host.dispose(); }
    expect(host.cleanup).toHaveBeenCalledTimes(5);
  });

  it('does not launch or publish when indexing permission is denied', async () => {
    const { root, executable } = fixture();
    const host = await registered(root, false);
    try {
      expect(await host.command.run({ action: 'index' }, host.context)).toMatchObject({ exitCode: 1 });
      expect(await host.command.run({ action: 'query', text: 'Evidence' }, host.context)).toMatchObject({ exitCode: 1 });
      expect(existsSync(executable + '.calls')).toBe(false);
      expect(loadRagIndex(root)).toBeNull();
      expect(host.receipts).not.toHaveBeenCalled();
    } finally { await host.dispose(); }
  });

  it('terminates a stalled sidecar under both caller policies', () => {
    const { executable } = fixture();
    writeFileSync(executable + '.wait', '');
    vi.stubEnv('AGON_RAG_EMBED_TIMEOUT_MS', '1000');
    expect(embedTexts(['a'])).toBeNull();
    expect(() => embedForWorkflow(['a'])).toThrow('RAG embedder failed:');
    expect(readFileSync(executable + '.calls', 'utf8').trim().split('\n')).toHaveLength(2);
  });
});
