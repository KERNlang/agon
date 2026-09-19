import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModServices } from '@kernlang/agon-mod-api';
import { bootstrapFirstPartySurfaceGeneration } from '../../packages/mod-kernel/src/first-party-surface-bootstrap.js';

describe('first-party semantic receipts', () => {
  it('retains unique owner-attributed redacted receipts and logs returned by the actual bootstrap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-owned-receipts-'));
    let services!: ModServices;
    const boot = await bootstrapFirstPartySurfaceGeneration({ hostRoot: root,
      runtime: { command: () => { throw new Error('unexpected command'); }, tool: () => { throw new Error('unexpected tool'); }, parseIntent: () => undefined, renderDocs: () => ({ text: '' }) },
      decorateFirstPartyServices: (manifest, base) => { if (manifest.id === 'agon.think') services = base; return base; },
    });
    try {
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
