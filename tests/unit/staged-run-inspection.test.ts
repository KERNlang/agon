import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { describeStagedRunStatus as inspect } from '../../packages/support-persistence/src/index.js';

it('inspects staged results without promoting, exposing their text, or accepting partial shapes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agon-stage-inspect-'));
  const path = join(dir, '.status.json.tmp');
  const valid = { mode: 'review', startedAt: '2026-09-17T00:00:00Z', endedAt: '2026-09-17T00:00:01Z', engines: [{ id: 'fixture', status: 'ok' }], ok: true, summary: 'PRIVATE_RESULT_DO_NOT_PRINT' };
  try {
    expect(inspect(dir)).toContain('no staged candidate');
    writeFileSync(path, JSON.stringify(valid));
    const bytes = readFileSync(path, 'utf8');
    const description = inspect(dir);
    expect(description).toContain('unpublished candidate');
    expect(description).toMatch(/sha256:[a-f0-9]{64}/);
    expect(description).toContain('not verified or authorized for recovery');
    expect(description).not.toContain(valid.summary);
    expect(readFileSync(path, 'utf8')).toBe(bytes);
    expect(existsSync(join(dir, 'status.json'))).toBe(false);
    for (const invalid of [null, [], {}, { ...valid, ok: 'true' }, { ...valid, engines: [{ id: 'x', status: 'invented' }] },
      { ...valid, startedAt: 'yesterday' }, { ...valid, endedAt: '2025-01-01T00:00:00Z' }]) {
      writeFileSync(path, JSON.stringify(invalid));
      expect(inspect(dir)).toContain('invalid or incomplete');
    }
    writeFileSync(path, '{"partial":');
    expect(inspect(dir)).toContain('invalid or incomplete');
    writeFileSync(path, Buffer.from([0xff, 0xfe]));
    expect(inspect(dir)).toContain('invalid or incomplete');
    writeFileSync(path, ' '.repeat(1024 * 1024 + 1));
    expect(inspect(dir)).toContain('cannot safely inspect');
    rmSync(path);
    const foreign = join(dir, 'foreign');
    writeFileSync(foreign, JSON.stringify(valid));
    symlinkSync(foreign, path);
    expect(inspect(dir)).toContain('cannot safely inspect');
    expect(readFileSync(foreign, 'utf8')).toBe(JSON.stringify(valid));
    rmSync(path);
    mkdirSync(path);
    expect(inspect(dir)).toContain('cannot safely inspect');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
