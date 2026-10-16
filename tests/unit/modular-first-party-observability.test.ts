import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, InvocationContext, ModServices, ResultContribution } from '@kernlang/agon-mod-api';
import { bootstrapFirstPartySurfaceGeneration } from '../../packages/mod-kernel/src/first-party-surface-bootstrap.js';

describe('first-party semantic receipts', () => {
  it('keeps migrated result readers with their workflow owners and disposes their registrations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-owned-results-'));
    const boot = await bootstrapFirstPartySurfaceGeneration({ hostRoot: root,
      runtime: { command: () => { throw new Error('unexpected command'); }, tool: () => { throw new Error('unexpected tool'); }, parseIntent: () => undefined, renderDocs: () => { throw new Error('legacy result renderer must not run'); } },
    });
    const owners = {
      goal: ['0016', '0064', '0144'], campfire: ['0022'], conquer: ['0037', '0055'],
      council: ['0039'], mutate: ['0083', '0114'], naturalize: ['0085'],
      nero: ['0086'], research: ['0106'], synthesis: ['0126'],
    };
    const payload = { historical: true, nested: { value: 42 }, entries: ['one', 'two'] };
    const registry = boot.activated.generation.registry;
    try {
      for (const [owner, ids] of Object.entries(owners)) {
        for (const id of ids) {
          const record = registry.resolve('result-type', `resultAndEnvelopeTypes:${id}`);
          expect(record?.owner.id).toBe(`agon.${owner}`);
          const reader = record!.payload as ResultContribution;
          expect(reader.schema).toEqual({ type: 'object', additionalProperties: true });
          expect(reader.readableVersions).toBe('>=0.2.0');
          expect(await reader.render(payload)).toEqual({ text: JSON.stringify(payload, null, 2) });
        }
      }
      expect(registry.resolve('result-type', 'resultAndEnvelopeTypes:0127')?.owner.id).toBe('agon.forge');
      expect((registry.resolve('result-type', 'resultAndEnvelopeTypes:0034')?.payload as ResultContribution).readableVersions).toBe('>=1');
    } finally { await boot.activated.dispose(); }
    for (const id of Object.values(owners).flat()) {
      expect(registry.resolve('result-type', `resultAndEnvelopeTypes:${id}`)).toBeUndefined();
    }
  });

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
