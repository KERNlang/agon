import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, InvocationContext, ModServices } from '@kernlang/agon-mod-api';
import { bootstrapFirstPartySurfaceGeneration } from '../../packages/mod-kernel/src/first-party-surface-bootstrap.js';

describe('first-party semantic receipts', () => {
  it.each([false, true])('keeps physical invocation separate from kernel runtime (safe mode: %s)', async safeMode => {
    const root = await mkdtemp(join(tmpdir(), 'agon-owned-dispatch-'));
    const command = vi.fn(() => {
      if (!safeMode) throw new Error('physical commands must not call the legacy runtime');
      return { exitCode: 0, stdout: 'kernel-management-result' };
    });
    const boot = await bootstrapFirstPartySurfaceGeneration({ hostRoot: root, safeMode,
      runtime: { command, tool: () => { throw new Error('unexpected tool'); }, parseIntent: () => undefined, renderDocs: () => ({ text: '' }) },
    });
    try {
      const context: InvocationContext = { invocationId: 'bridge-retirement', cwd: root,
        platform: 'darwin-arm64', signal: new AbortController().signal, config: {} };
      const name = safeMode ? 'mod' : 'agent-guide';
      const input = safeMode ? {} : { json: true };
      const record = boot.activated.generation.assertAvailable('cli', name);
      const result = await (record.payload as CommandContribution).run(input, context);
      if (safeMode) {
        expect(result).toEqual({ exitCode: 0, stdout: 'kernel-management-result' });
        expect(command).toHaveBeenCalledExactlyOnceWith('cli', 'mod', input, context);
        expect(() => boot.activated.generation.assertAvailable('cli', 'agent-guide')).toThrow(/unavailable/);
      } else {
        expect(result).toMatchObject({ exitCode: 0, result: { format: 'json', modeCount: 10 } });
        expect(command).not.toHaveBeenCalled();
      }
    } finally { await boot.activated.dispose(); }
  });

  it('retains unique owner-attributed redacted receipts and logs returned by the actual bootstrap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-owned-receipts-'));
    let services!: ModServices;
    const boot = await bootstrapFirstPartySurfaceGeneration({ hostRoot: root,
      runtime: { command: () => { throw new Error('unexpected command'); }, tool: () => { throw new Error('unexpected tool'); }, parseIntent: () => undefined, renderDocs: () => ({ text: '' }) },
      decorateFirstPartyServices: (manifest, base) => { if (manifest.id === 'agon.think') services = base; return base; },
    });
    try {
      expect(services).not.toHaveProperty('firstPartyCompatibility');
      const first = await services.receipts.record('fixture-result', { token: 'fixture-secret', result: 'safe' });
      const second = await services.receipts.record('fixture-result', { token: 'fixture-secret', result: 'safe' });
      expect(first).not.toBe(second);
      await services.logger.info('fixture-log', { password: 'fixture-secret' });
      const paths = (await readdir(root, { recursive: true })).filter((path) => path.endsWith('.json'));
      const documents = await Promise.all(paths.map(async (path) => JSON.parse(await readFile(join(root, path), 'utf8'))));
      expect(documents.find((doc) => doc.receiptId === first)).toMatchObject({ owner: 'agon.think', kind: 'fixture-result', payload: { token: '[redacted]', result: 'safe' } });
      expect(documents.some((doc) => doc.kind === 'log' && doc.payload.message === 'fixture-log')).toBe(true);
      expect(JSON.stringify(documents)).not.toContain('fixture-secret');
    } finally { await boot.activated.dispose(); }
  });
});
