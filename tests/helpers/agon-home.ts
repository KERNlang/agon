import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function setupTestAgonHome(label: string): string {
  const dir = join(tmpdir(), `agon-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.AGON_HOME = dir;
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function cleanupTestAgonHome(dir?: string): void {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.AGON_HOME;
}

export function agonHomePath(...parts: string[]): string {
  if (!process.env.AGON_HOME) {
    throw new Error('AGON_HOME is not set');
  }
  return join(process.env.AGON_HOME, ...parts);
}
