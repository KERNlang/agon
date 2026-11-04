import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JournalSchema } from '../../docs/specs/fixtures/modular-agon-contracts/contracts.mjs';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { hostLock } from '../helpers/modular-host.js';

describe('durable host frozen journal contract', () => {
  it('emits a transaction accepted by the executable frozen schema', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-journal-schema-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const result = await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const bytes = JSON.parse(await readFile(host.journalPath(result.journal.transactionId), 'utf8'));
    expect(JournalSchema.parse(bytes).state).toBe('committed');
  });

  it('proves the oracle rejects an impossible state and unknown field', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-journal-schema-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const result = await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    expect(() => JournalSchema.parse({ ...result.journal, state: 'cleanup', hidden: true })).toThrow();
  });
});
