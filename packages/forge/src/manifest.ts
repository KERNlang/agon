import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ForgeManifest } from '@agon/core';
import { RUNS_DIR } from '@agon/core';

/**
 * Write a forge manifest to the forge dir and to the global runs history.
 */
export function writeManifest(manifest: ForgeManifest): string {
  const manifestPath = join(manifest.forgeDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  // Also persist to ~/.agon/runs/
  mkdirSync(RUNS_DIR, { recursive: true });
  const historyPath = join(RUNS_DIR, `${manifest.forgeId}.json`);
  writeFileSync(historyPath, JSON.stringify(manifest, null, 2) + '\n');

  return manifestPath;
}

/**
 * Read a manifest from a forge dir.
 */
export function readManifest(forgeDir: string): ForgeManifest {
  const manifestPath = join(forgeDir, 'manifest.json');
  return JSON.parse(readFileSync(manifestPath, 'utf-8')) as ForgeManifest;
}

/**
 * Update specific fields in an existing manifest.
 */
export function updateManifest(
  forgeDir: string,
  updates: Partial<ForgeManifest>,
): ForgeManifest {
  const existing = readManifest(forgeDir);
  const merged = { ...existing, ...updates };
  writeManifest(merged);
  return merged;
}
