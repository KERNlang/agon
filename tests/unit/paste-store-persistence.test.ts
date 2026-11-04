import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PasteStore } from '@kernlang/agon-support-persistence';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agon-paste-'));
  vi.stubEnv('AGON_HOME', home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

it('reads a paste back from disk in a new store, or expanding its placeholder loses the user text', () => {
  const text = 'first line\nsecond line';
  const stored = new PasteStore().store(text);
  expect(new PasteStore().retrieve(stored.hash)).toBe(text);
  expect(stored.lineCount).toBe(2);
});
