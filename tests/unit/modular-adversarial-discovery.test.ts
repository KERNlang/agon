import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectStaticManifest } from '../../packages/mod-kernel/src/discovery.js';
import { manifest } from '../helpers/modular-agon.js';

async function packageRoot(rawManifest: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agon-s8-adversarial-'));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/index.js'), 'export default {};');
  await writeFile(join(root, 'dist/index.d.ts'), 'export {};');
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(join(root, 'agon.mod.json'), rawManifest);
  return root;
}

describe('S8 adversarial static discovery', () => {
  it.each(['__proto__', 'prototype', 'constructor'])('rejects dangerous object key %s before schema validation', async (key) => {
    const raw = JSON.stringify(manifest('example.hostile')).replace(/}$/, `,"${key}":{}}`);
    await expect(inspectStaticManifest(await packageRoot(raw))).rejects.toThrow(/dangerous JSON key/);
  });

  it('rejects structures beyond the manifest depth budget', async () => {
    let nested: unknown = 'leaf';
    for (let index = 0; index < 40; index += 1) nested = { nested };
    const raw = JSON.stringify({ ...manifest('example.deep'), hostile: nested });
    await expect(inspectStaticManifest(await packageRoot(raw))).rejects.toThrow(/depth limit/);
  });

  it('rejects structures beyond the manifest key budget', async () => {
    const hostile = Object.fromEntries(Array.from({ length: 4_100 }, (_, index) => [`k${index}`, index]));
    const raw = JSON.stringify({ ...manifest('example.wide'), hostile });
    await expect(inspectStaticManifest(await packageRoot(raw))).rejects.toThrow(/key limit/);
  });
});
