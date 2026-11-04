import { chmod, mkdtemp, readFile, readdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { readSelectedGenerationConfigurationSync } from '../../packages/mod-kernel/src/configuration-migration.js';
import { hostLock } from '../helpers/modular-host.js';

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agon-host-corruption-'));
}

describe('durable host corrupt-artifact containment', () => {
  it.each(['contents', 'extra', '__proto__', 'missing', 'symlink', 'pointer', 'manifest', 'kernel'] as const)
    ('refuses %s corruption in the synchronous configuration reader', async fault => {
    const root = await fixture();
    const host = new DurableModHost(root, { kernelVersion: fault === 'kernel' ? '2.0.0' : '1.0.0' });
    const { pointer } = await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    if (fault !== 'kernel') expect(readSelectedGenerationConfigurationSync(root)).toBeUndefined();
    const generation = host.generationPath(pointer.generation);
    if (fault === 'contents') {
      await chmod(join(generation, 'desired-state.json'), 0o600);
      await writeFile(join(generation, 'desired-state.json'), '{"changed":true}');
    } else if (fault === 'extra' || fault === '__proto__' || fault === 'missing' || fault === 'symlink') {
      await chmod(generation, 0o700);
      if (fault === 'extra') await writeFile(join(generation, 'unlisted.json'), '{}');
      if (fault === '__proto__') await writeFile(join(generation, '__proto__'), '{}');
      if (fault === 'missing') await unlink(join(generation, 'desired-state.json'));
      if (fault === 'symlink') await symlink(join(generation, 'desired-state.json'), join(generation, 'linked.json'));
    } else if (fault === 'pointer') {
      await writeFile(host.paths.current, JSON.stringify({ ...pointer, graphHash: `sha256:${'0'.repeat(64)}` }));
    } else if (fault === 'manifest') {
      const path = join(generation, 'generation.json');
      const manifest = JSON.parse(await readFile(path, 'utf8'));
      await chmod(path, 0o600);
      await writeFile(path, JSON.stringify({ ...manifest, injected: true }));
    }
    expect(() => readSelectedGenerationConfigurationSync(root)).toThrow(expect.objectContaining({ code: 'MOD_GENERATION_CORRUPT' }));
    if (!['pointer', 'kernel'].includes(fault)) await expect(host.validateGeneration(pointer.generation)).rejects.toMatchObject({ code: 'MOD_GENERATION_CORRUPT' });
  });

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
