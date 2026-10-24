import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { ForgeManifest } from './types.js';

export interface ForgeManifestRuntime {
  runsDir: string;
  withFileLock(path: string, write: () => void): void;
}

export function readManifest(forgeDir: string): ForgeManifest {
  const manifestPath = join(forgeDir, 'manifest.json');
  return JSON.parse(readFileSync(manifestPath, 'utf-8')) as ForgeManifest;
}

/** Bind history publication without reading or writing stored runs. */
export function createForgeManifestStore(runtime: ForgeManifestRuntime) {
  const { runsDir, withFileLock } = runtime;

  /**
   * Atomic manifest write. Writing to .tmp then renameSync avoids leaving a half-written manifest.json if the process is killed (SIGINT) mid-write — a real risk because forge writes the manifest incrementally on every engine settle.
   */
  function writeManifest(manifest: ForgeManifest): string {
    const manifestPath = join(manifest.forgeDir, 'manifest.json');
    const body = JSON.stringify(manifest, null, 2) + '\n';
    const tmpPath = manifestPath + '.tmp';
    writeFileSync(tmpPath, body);
    renameSync(tmpPath, manifestPath);
    mkdirSync(runsDir, { recursive: true });
    const historyPath = join(runsDir, `${manifest.forgeId}.json`);
    const historyTmp = historyPath + '.tmp';
    // Serialize history replacement with ratings-maintenance eligibility checks.
    withFileLock(historyPath + '.lock', () => {
      writeFileSync(historyTmp, body);
      renameSync(historyTmp, historyPath);
    });
    return manifestPath;
  }

  function updateManifest(forgeDir: string, updates: Partial<ForgeManifest>): ForgeManifest {
    const existing = readManifest(forgeDir);
    const merged = { ...existing, ...updates };
    writeManifest(merged);
    return merged;
  }
  return { writeManifest, updateManifest };
}
