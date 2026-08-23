import { chmod, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { hostLock } from '../helpers/modular-host.js';

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agon-host-corruption-'));
}

describe('durable host corrupt-artifact containment', () => {
  it('reports but does not execute a syntactically valid malformed unselected journal', async () => {
    const root = await fixture();
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    await writeFile(join(host.paths.transactions, 'malformed.json'), '{"schemaVersion":1,"steps":null}\n');
    const report = await host.doctor();
    expect(report.status).toBe('degraded');
    expect(report.failures.some(({ event }) => event === 'journal.corrupt')).toBe(true);
  });

  it('fails closed on a malformed writer lock and keeps Doctor usable', async () => {
    const root = await fixture();
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.initialize();
    await writeFile(host.paths.writerLock, '{broken');
    await expect(host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} }))
      .rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
    const report = await host.doctor();
    expect(report.status).toBe('degraded');
    expect(report.reason).toContain('malformed');
    expect(await readFile(host.paths.writerLock, 'utf8')).toBe('{broken');
  });

  it('rejects unknown pointer and manifest fields rather than normalizing them away', async () => {
    const root = await fixture();
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    const result = await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const pointer = JSON.parse(await readFile(host.paths.current, 'utf8'));
    await writeFile(host.paths.current, JSON.stringify({ ...pointer, injected: true }));
    await expect(host.readCurrentPointer()).rejects.toMatchObject({ code: 'MOD_POINTER_CORRUPT' });

    const manifestPath = join(host.generationPath(result.pointer.generation), 'generation.json');
    await chmod(manifestPath, 0o600);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, injected: true }));
    await expect(host.validateGeneration(result.pointer.generation)).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
  });

  it('preserves structural fencing UUIDs while redacting credential-shaped journal values', async () => {
    const root = await fixture();
    const host = new DurableModHost(root, {
      kernelVersion: '1.0.0', secrets: ['swordfish'],
      fault: (point) => { if (point === 'after-staging') throw new Error('password swordfish'); },
    });
    await expect(host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} }))
      .rejects.toMatchObject({ code: 'MOD_TRANSACTION_FAILED' });
    const files = await readdir(host.paths.transactions);
    const journal = JSON.parse(await readFile(join(host.paths.transactions, files[0]!), 'utf8'));
    expect(journal.fenceToken).toMatch(/^[0-9a-f-]{36}$/i);
    expect(JSON.stringify(journal)).not.toContain('swordfish');
  });
});
