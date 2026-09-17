import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { writeRunStatus, type RunStatus } from '../../packages/support-persistence/src/run-dir.js';

const status: RunStatus = { mode: 'review', startedAt: '2026-09-17T00:00:00Z', endedAt: '2026-09-17T00:00:01Z', engines: [], ok: false, summary: 'actual outcome' };

it.each(['file', 'symlink'] as const)('never overwrites or removes staging owned by another writer (%s)', kind => {
  const dir = mkdtempSync(join(tmpdir(), 'agon-staging-'));
  const temp = join(dir, '.status.json.tmp');
  const foreign = join(dir, 'foreign');
  const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    writeFileSync(foreign, 'foreign bytes');
    if (kind === 'symlink') symlinkSync(foreign, temp);
    else writeFileSync(temp, 'other staged outcome');
    expect(writeRunStatus(dir, status)).toBe(false);
    expect(existsSync(join(dir, 'status.json'))).toBe(false);
    expect(readFileSync(foreign, 'utf8')).toBe('foreign bytes');
    expect(readFileSync(temp, 'utf8')).toBe(kind === 'symlink' ? 'foreign bytes' : 'other staged outcome');
    expect(warning).toHaveBeenCalled();
  } finally { warning.mockRestore(); rmSync(dir, { recursive: true, force: true }); }
});

it('retains a complete candidate when publication fails, without replacing the final target', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agon-staging-publish-'));
  const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    mkdirSync(join(dir, 'status.json'));
    writeFileSync(join(dir, 'status.json', 'keep'), 'existing target');
    expect(writeRunStatus(dir, status)).toBe(false);
    expect(existsSync(join(dir, '.status.json.tmp'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, '.status.json.tmp'), 'utf8'))).toEqual(status);
    expect(readFileSync(join(dir, 'status.json', 'keep'), 'utf8')).toBe('existing target');
  } finally { warning.mockRestore(); rmSync(dir, { recursive: true, force: true }); }
});
