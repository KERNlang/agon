// @kern-source: manifest:1
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// @kern-source: manifest:2
import { join } from 'node:path';

// @kern-source: manifest:3
import type { ForgeManifest } from '@agon/core';

// @kern-source: manifest:4
import { RUNS_DIR } from '@agon/core';

// @kern-source: manifest:6
export function writeManifest(manifest: ForgeManifest): string {
  const manifestPath = join(manifest.forgeDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  
  mkdirSync(RUNS_DIR, { recursive: true });
  const historyPath = join(RUNS_DIR, `${manifest.forgeId}.json`);
  writeFileSync(historyPath, JSON.stringify(manifest, null, 2) + '\n');
  
  return manifestPath;
}

// @kern-source: manifest:18
export function readManifest(forgeDir: string): ForgeManifest {
  const manifestPath = join(forgeDir, 'manifest.json');
  return JSON.parse(readFileSync(manifestPath, 'utf-8')) as ForgeManifest;
}

// @kern-source: manifest:24
export function updateManifest(forgeDir: string, updates: Partial<ForgeManifest>): ForgeManifest {
  const existing = readManifest(forgeDir);
  const merged = { ...existing, ...updates };
  writeManifest(merged);
  return merged;
}

