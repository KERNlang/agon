import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertContainedPackagePath, inspectStaticManifest } from '../../packages/mod-kernel/src/discovery.js';
import { manifest } from '../helpers/modular-agon.js';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'agon-static-mod-'));
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist/index.js'), 'export default {}');
  writeFileSync(join(root, 'dist/index.d.ts'), 'declare const value: unknown; export default value;');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(root, 'agon.mod.json'), JSON.stringify(manifest('example.static')));
  return root;
}

describe('static mod discovery', () => {
  it('validates a contained package without importing its entrypoint', async () => {
    const root = fixture();
    writeFileSync(join(root, 'dist/index.js'), 'throw new Error("must never execute during discovery")');
    const inspection = await inspectStaticManifest(root);
    expect(inspection.manifest.id).toBe('example.static');
    expect(inspection.manifestHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(inspection.containedPaths.size).toBe(4);
    expect((inspection.containedPaths as Map<string, string>).set).toBeUndefined();
  });

  it('rejects lexical traversal, absolute paths, and symlink escape', async () => {
    const root = fixture();
    const outside = join(root, '..', `outside-${Date.now()}.js`);
    writeFileSync(outside, 'outside');
    symlinkSync(outside, join(root, 'dist/escape.js'));
    await expect(assertContainedPackagePath(root, '../escape.js')).rejects.toThrow(/escapes|forbidden/);
    await expect(assertContainedPackagePath(root, outside)).rejects.toThrow(/absolute/);
    await expect(assertContainedPackagePath(root, 'dist/escape.js')).rejects.toThrow(/escapes/);
  });

  it('bounds manifest input before parsing', async () => {
    const root = fixture();
    await expect(inspectStaticManifest(root, { maxManifestBytes: 8 })).rejects.toThrow(/byte limit/);
    writeFileSync(join(root, 'agon.mod.json'), 'x'.repeat(256 * 1024 + 1));
    await expect(inspectStaticManifest(root, { maxManifestBytes: Number.MAX_SAFE_INTEGER })).rejects.toThrow(/byte limit/);
  });

  it('rejects duplicate manifest keys', async () => {
    const root = fixture();
    const raw = JSON.stringify(manifest('example.static')).replace(
      '"id":"example.static"',
      '"id":"evil.mod","id":"example.static"',
    );
    writeFileSync(join(root, 'agon.mod.json'), raw);
    await expect(inspectStaticManifest(root)).rejects.toThrow(/duplicate JSON key/i);
  });

  it('rejects nested escaped duplicate keys and malformed UTF-8', async () => {
    const root = fixture();
    const escapedDuplicate = JSON.stringify(manifest('example.static')).replace(
      '"display":{"group":"test"',
      '"display":{"gr\\u006fup":"evil","group":"test"',
    );
    writeFileSync(join(root, 'agon.mod.json'), escapedDuplicate);
    await expect(inspectStaticManifest(root)).rejects.toThrow(/duplicate JSON key/i);

    const valid = Buffer.from(JSON.stringify(manifest('example.static')));
    const marker = Buffer.from('"name":"example.static"');
    const markerIndex = valid.indexOf(marker);
    const malformed = Buffer.concat([
      valid.subarray(0, markerIndex + '"name":"'.length), Buffer.from([0xc3, 0x28]),
      valid.subarray(markerIndex + marker.length - 1),
    ]);
    writeFileSync(join(root, 'agon.mod.json'), malformed);
    await expect(inspectStaticManifest(root)).rejects.toThrow(/valid JSON/i);
  });

  it('requires every referenced package path to be a regular file', async () => {
    const root = fixture();
    mkdirSync(join(root, 'dist/runtime'));
    writeFileSync(join(root, 'agon.mod.json'), JSON.stringify(manifest('example.static', '1.0.0', {
      entrypoints: { runtime: 'dist/runtime', types: 'dist/index.d.ts' },
      pack: { include: ['dist/runtime', 'dist/index.d.ts', 'agon.mod.json'], executable: [] },
    })));
    await expect(inspectStaticManifest(root)).rejects.toThrow(/regular file/i);
  });

  it('verifies declared asset bytes and hashes', async () => {
    const root = fixture();
    writeFileSync(join(root, 'asset.txt'), 'actual bytes');
    writeFileSync(join(root, 'agon.mod.json'), JSON.stringify(manifest('example.static', '1.0.0', {
      assets: [{
        path: 'asset.txt', kind: 'static', mediaType: 'text/plain',
        contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        bytes: 12, executable: false, platforms: ['darwin-arm64'],
      }],
      pack: { include: ['dist/index.js', 'dist/index.d.ts', 'agon.mod.json', 'package.json', 'asset.txt'], executable: [] },
    })));
    await expect(inspectStaticManifest(root)).rejects.toThrow(/asset (?:hash|bytes)/i);
  });
});
