import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { readPatchFromManifest, readPatchFromPath, undoPatch } from '../../packages/support-worktree/src/patch-apply.js';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-patch-encoding-'));
  roots.push(cwd);
  const path = join(cwd, 'change.patch');
  const manifest = join(cwd, 'manifest.json');
  writeFileSync(manifest, JSON.stringify({ winner: 'fixture', patches: { fixture: path } }));
  return { cwd, path, manifest };
}
function patch(bytes: Buffer) {
  return Buffer.concat([Buffer.from('diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-before\n+'), bytes, Buffer.from('\n')]);
}
const malformed = [[0xff], [0xc0, 0x80], [0xed, 0xa0, 0x80], [0xe2, 0x82]];

it.each(malformed)('rejects malformed patch bytes %j through both artifact readers', (...bytes) => {
  const { path, manifest } = fixture();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  writeFileSync(path, patch(Buffer.from(bytes)));
  expect(readPatchFromPath(path)).toBeNull();
  expect(readPatchFromManifest(manifest)).toBeNull();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('UTF-8'));
});

it('rejects malformed manifest bytes even inside unused metadata', () => {
  const { path, manifest } = fixture();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  writeFileSync(path, patch(Buffer.from('after')));
  const json = JSON.stringify({ winner: 'fixture', patches: { fixture: path }, note: 'MARKER' });
  const [before, after] = json.split('MARKER');
  writeFileSync(manifest, Buffer.concat([Buffer.from(before), Buffer.from([0xff]), Buffer.from(after)]));
  expect(readPatchFromManifest(manifest)).toBeNull();
});

it.each(malformed)('refuses malformed undo bytes %j without changing the workspace', (...bytes) => {
  const { cwd } = fixture();
  execFileSync('git', ['init', '--quiet'], { cwd });
  writeFileSync(join(cwd, 'file.txt'), 'before\n');
  const undoDir = join(cwd, 'undo');
  mkdirSync(undoDir);
  const record = join(undoDir, 'fixture.patch');
  const saved = patch(Buffer.from(bytes));
  writeFileSync(record, saved);
  expect(undoPatch(cwd, 'fixture', undoDir)).toMatchObject({ ok: false, error: expect.stringContaining('UTF-8') });
  expect(readFileSync(join(cwd, 'file.txt'), 'utf8')).toBe('before\n');
  expect(readFileSync(record)).toEqual(saved);
});

it.each(['Grüezi 🦒', 'valid replacement character: �'])('preserves valid UTF-8 %s', value => {
  const { path, manifest } = fixture();
  const content = patch(Buffer.from(value)).toString('utf8');
  writeFileSync(path, content);
  expect(readPatchFromPath(path)?.content).toBe(content);
  expect(readPatchFromManifest(manifest)?.content).toBe(content);
});
