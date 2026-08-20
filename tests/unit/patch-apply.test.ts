import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readPatchFromPath, readPatchFromManifest } from '../../packages/core/src/blocks/patch-apply.js';

// lineCount is the "how big is this patch" number the apply preflight and the
// forge summary show the user. It counts CHANGED lines — additions AND
// deletions — while excluding the `+++`/`---` file headers. Counting only one
// side silently halves every reported patch size.

const dirs: string[] = [];

const PATCH = [
  'diff --git a/src/auth.ts b/src/auth.ts',
  'index abc1234..def5678 100644',
  '--- a/src/auth.ts',
  '+++ b/src/auth.ts',
  '@@ -10,6 +10,8 @@ function login(user: string) {',
  '   const token = generateToken(user);',
  '+  validateInput(user);',
  '+  logAttempt(user);',
  '+  audit(user);',
  '-  legacyCheck(user);',
  '   return token;',
  '',
].join('\n');

// 3 added + 1 removed; the ---/+++ headers must NOT be counted.
const EXPECTED_LINE_COUNT = 4;

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agon-patch-apply-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('readPatchFromPath', () => {
  it('counts added AND removed lines, excluding the file headers', () => {
    const dir = tempDir();
    const patchPath = join(dir, 'winner.patch');
    writeFileSync(patchPath, PATCH);

    const info = readPatchFromPath(patchPath);
    expect(info).not.toBeNull();
    expect(info!.lineCount).toBe(EXPECTED_LINE_COUNT);
    expect(info!.engineId).toBe('unknown');
    expect(info!.path).toBe(patchPath);
  });

  it('returns null for an empty patch file', () => {
    const dir = tempDir();
    const patchPath = join(dir, 'empty.patch');
    writeFileSync(patchPath, '   \n');
    expect(readPatchFromPath(patchPath)).toBeNull();
  });
});

describe('readPatchFromManifest', () => {
  it('counts added AND removed lines of the winning patch', () => {
    const dir = tempDir();
    const patchPath = join(dir, 'claude.patch');
    writeFileSync(patchPath, PATCH);
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify({ winner: 'claude', patches: { claude: patchPath } }));

    const info = readPatchFromManifest(manifestPath);
    expect(info).not.toBeNull();
    expect(info!.lineCount).toBe(EXPECTED_LINE_COUNT);
    expect(info!.engineId).toBe('claude');
  });

  it('returns null when the manifest has no winner', () => {
    const dir = tempDir();
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify({ patches: {} }));
    expect(readPatchFromManifest(manifestPath)).toBeNull();
  });
});
