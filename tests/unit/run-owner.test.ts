import { mkdtempSync, writeFileSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { expect, it } from 'vitest';
import { inspectRunOwner as inspect, writeRunOwner } from '../../packages/support-persistence/src/index.js';

const bootId = '11111111-1111-4111-8111-111111111111';
const hostInstance = '22222222-2222-4222-8222-222222222222';
type Probe = { bootId: () => string | null; pidNamespace: () => string | null; pidState: (pid: number) => 'present' | 'absent' | 'unknown' };

it('requires matching boot evidence and an absent PID, never inferring ownership from PID presence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agon-owner-'));
  const path = join(dir, 'owner.json');
  const owner = { schemaVersion: 1, runId: basename(dir), pid: 1234, bootId, hostInstance, pidNamespace: 'pid:[12345]' };
  let probes = 0;
  const probe: Probe = { bootId: () => bootId, pidNamespace: () => 'pid:[12345]', pidState: () => { probes++; return 'absent'; } };
  try {
    expect(inspect(dir, probe)).toMatchObject({ state: 'unknown', reason: 'missing-owner' });
    writeFileSync(path, JSON.stringify(owner));
    const bytes = readFileSync(path, 'utf8');
    expect(inspect(dir, probe)).toMatchObject({ state: 'process-absent' });
    expect(inspect(dir, { ...probe, pidState: () => 'present' })).toMatchObject({ state: 'unknown', reason: 'pid-present-ownership-unverified' });
    expect(inspect(dir, { ...probe, pidState: () => 'unknown' })).toMatchObject({ state: 'unknown', reason: 'pid-probe-unavailable' });
    expect(inspect(dir, { ...probe, pidState: () => { throw new Error('permission denied'); } }).state).toBe('unknown');
    expect(readFileSync(path, 'utf8')).toBe(bytes);
    probes = 0;
    expect(inspect(dir, { ...probe, pidNamespace: () => 'pid:[54321]' }).state).toBe('unknown');
    expect(inspect(dir, { ...probe, pidNamespace: () => null }).state).toBe('unknown');
    expect(inspect(dir, { ...probe, bootId: () => null }).state).toBe('unknown');
    expect(inspect(dir, { ...probe, bootId: () => hostInstance }).state).toBe('unknown');
    expect(probes).toBe(0);
    for (const invalid of [null, {}, { ...owner, pid: 0 }, { ...owner, pid: -1 }, { ...owner, pid: 1.5 },
      { ...owner, pid: Number.MAX_SAFE_INTEGER }, { ...owner, runId: 'another-run' },
      { ...owner, schemaVersion: 2 }, { ...owner, bootId: 'not-a-boot' }, { ...owner, hostInstance: '' }]) {
      writeFileSync(path, JSON.stringify(invalid));
      expect(inspect(dir, probe).state).toBe('unknown');
    }
    writeFileSync(path, '{broken');
    expect(inspect(dir, probe).state).toBe('unknown');
    writeFileSync(path, ' '.repeat(8192));
    expect(inspect(dir, probe).state).toBe('unknown');
    expect(probes).toBe(0);
    rmSync(path);
    const target = join(dir, 'foreign.json');
    writeFileSync(target, JSON.stringify(owner));
    symlinkSync(target, path);
    expect(inspect(dir, probe)).toMatchObject({ state: 'unknown', reason: 'invalid-owner' });
    expect(probes).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('refuses to replace an existing ownership record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agon-owner-exclusive-'));
  try {
    writeRunOwner(dir);
    const bytes = readFileSync(join(dir, 'owner.json'), 'utf8');
    expect(() => writeRunOwner(dir)).toThrow(expect.objectContaining({ code: 'EEXIST' }));
    expect(readFileSync(join(dir, 'owner.json'), 'utf8')).toBe(bytes);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
