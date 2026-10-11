import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, configSet, invalidateConfigCache } from '@kernlang/agon-core';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { rollbackGeneration } from '../../packages/mod-kernel/src/host-rollback.js';
import { artifact, request } from '../helpers/modular-lifecycle.js';
import { resolveRegisteredModSettings } from '../../packages/mod-kernel/src/mod-settings.js';

afterEach(() => { vi.unstubAllEnvs(); invalidateConfigCache(); });

describe('selected generation settings in the normal Core reader', () => {
  it.each(['legacy-sibling', 'deep-owner'] as const)('keeps configuration interpretation scoped: %s', async scenario => {
    const home = await mkdtemp(join(tmpdir(), 'agon-generation-config-scope-'));
    vi.stubEnv('AGON_HOME', home);
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', join(home, 'host'));
    const sourcePath = join(home, 'config.json');
    let nestedSchema: Record<string, unknown> = { type: 'number' };
    let nestedValue: unknown = 1;
    for (let index = 0; index < 34; index++) {
      nestedSchema = { type: 'object', properties: { next: nestedSchema } };
      nestedValue = { next: nestedValue };
    }
    const schema = scenario === 'deep-owner' ? { type: 'object', properties: { value: nestedSchema } }
      : { type: 'object', required: ['forgeFitnessTimeout'], properties: {
        forgeFitnessTimeout: { type: 'number' }, autoReviewAfterForge: { type: 'boolean', default: true },
      }, 'x-agon-config': { version: 1, legacyAliases: ['forgeFitnessTimeout', 'autoReviewAfterForge'] } };
    const data = scenario === 'deep-owner' ? { timeout: 432, mods: { 'agon.forge': { value: nestedValue } } }
      : { forgeFitnessTimeout: 77, autoReviewAfterForge: true };
    const source = JSON.stringify(data);
    await writeFile(sourcePath, source);
    const host = new DurableModHost(join(home, 'host'), { kernelVersion: '1.0.0' });
    const input = request([artifact('@kernlang/agon-mod-forge')]);
    const hash = (bytes: string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    await host.commitGeneration({ operation: 'install', lock: input.lock, desiredState: input.desiredState, installedIndex: {}, files: {
      'config/index.json': JSON.stringify({ schemaVersion: 1, source: { path: sourcePath, contentHash: hash(source) }, selectedHash: hash(source), ownerCount: 1 }),
      'config/source-global.json': source, 'config/selected-global.json': source,
      'config/owners.json': JSON.stringify([{ ownerId: 'agon.forge', version: 1, schema, assetHash: hash(JSON.stringify(schema)) }]),
      'config/migration-receipts.json': '[]',
    } });
    if (scenario === 'legacy-sibling') {
      configSet('autoReviewAfterForge', false);
      expect(loadConfig().forgeFitnessTimeout).toBe(77);
      expect(loadConfig().autoReviewAfterForge).toBe(false);
      expect(JSON.parse(await readFile(sourcePath, 'utf8')).mods['agon.forge']).toEqual({ autoReviewAfterForge: false });
    } else {
      expect(loadConfig().timeout).toBe(432);
      expect(loadConfig().mods).toEqual(data.mods);
      expect(() => resolveRegisteredModSettings('agon.forge', { value: nestedValue }, [schema])).toThrow();
      expect(await readFile(sourcePath, 'utf8')).toBe(source);
    }
  });

  it.each([false, true])('uses selected schema defaults without replacing explicit edits (explicit=%s)', async explicit => {
    const home = await mkdtemp(join(tmpdir(), 'agon-generation-settings-'));
    const hostRoot = join(home, 'modular-host');
    vi.stubEnv('AGON_HOME', home);
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', hostRoot);
    const sourcePath = join(home, 'config.json');
    const source = JSON.stringify(explicit ? { forgeFitnessTimeout: 77, retained: true } : { retained: true }) + '\n';
    await writeFile(sourcePath, source);
    const host = new DurableModHost(hostRoot, { kernelVersion: '1.0.0' });
    const input = request([artifact('@kernlang/agon-mod-forge')]);
    const hash = (bytes: string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    for (const timeout of [91, 137]) {
      const schema = { type: 'object', properties: { forgeFitnessTimeout: { type: 'number', default: timeout } },
        'x-agon-config': { version: 1, legacyAliases: ['forgeFitnessTimeout'] } };
      const selected = JSON.stringify({ ...JSON.parse(source), ...(explicit ? { mods: { 'agon.forge': { forgeFitnessTimeout: 77 } } } : {}) });
      await host.commitGeneration({ operation: timeout === 91 ? 'install' : 'update', lock: input.lock,
        desiredState: input.desiredState, installedIndex: {}, files: {
          'config/index.json': JSON.stringify({ schemaVersion: 1, source: { path: sourcePath, contentHash: hash(source) },
            selectedHash: hash(selected), ownerCount: 1 }),
          'config/source-global.json': source,
          'config/selected-global.json': selected,
          'config/owners.json': JSON.stringify([{ ownerId: 'agon.forge', version: 1, schema, assetHash: hash(JSON.stringify(schema)) }]),
          'config/migration-receipts.json': '[]',
        } });
      expect(loadConfig().forgeFitnessTimeout).toBe(explicit ? 77 : timeout);
      expect(await readFile(sourcePath, 'utf8')).toBe(source);
    }
    await rollbackGeneration(host, 1);
    expect(loadConfig().forgeFitnessTimeout).toBe(explicit ? 77 : 91);
    expect(await readFile(sourcePath, 'utf8')).toBe(source);
    expect(() => configSet('forgeFitnessTimeout', 'invalid')).toThrow();
    expect(await readFile(sourcePath, 'utf8')).toBe(source);
    configSet('forgeFitnessTimeout', 53);
    expect(loadConfig().forgeFitnessTimeout).toBe(53);
    expect(JSON.parse(await readFile(sourcePath, 'utf8'))).toMatchObject({ retained: true, forgeFitnessTimeout: 53 });
    await writeFile(sourcePath, source);
    await writeFile(join(hostRoot, 'current-generation.json'), '{broken');
    expect(() => loadConfig()).toThrow();
    vi.stubEnv('AGON_MOD_SAFE_MODE', '1');
    expect(loadConfig().forgeFitnessTimeout).toBe(explicit ? 77 : 120);
  });
});
