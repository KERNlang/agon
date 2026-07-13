import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { dedupBrainstormDrafts } from '../../packages/forge/src/generated/dedup-bridge.js';

const originalPython = process.env.AGON_PYTHON;
const tempDirs: string[] = [];

afterEach(() => {
  if (originalPython === undefined) delete process.env.AGON_PYTHON;
  else process.env.AGON_PYTHON = originalPython;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('brainstorm deduplication', () => {
  it('times out a hung optional sidecar without blocking the brainstorm', async () => {
    const dir = join(tmpdir(), `agon-dedup-timeout-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(dir);
    mkdirSync(dir, { recursive: true });
    const slowPython = join(dir, 'slow-python');
    writeFileSync(slowPython, '#!/bin/sh\nsleep 5\n');
    chmodSync(slowPython, 0o755);
    process.env.AGON_PYTHON = slowPython;

    const started = Date.now();
    const result = await dedupBrainstormDrafts([
      { engineId: 'a', text: 'first approach' },
      { engineId: 'b', text: 'second approach' },
    ], { timeoutMs: 40 });

    expect(result).toMatchObject({
      groups: null,
      status: { status: 'timed-out' },
    });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
