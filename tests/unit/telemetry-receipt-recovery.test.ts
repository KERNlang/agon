import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, hostname } from 'node:os';
import { TelemetryLedger, type RunRecord } from '../../packages/cli/src/telemetry/index.js';
import { createBrainstormSessionRecord } from '../../packages/mod-brainstorm/src/session-record.js';

vi.mock('@kernlang/agon-support-persistence', async original => ({
  ...await original<typeof import('@kernlang/agon-support-persistence')>(),
  runsStore: { scheduleRefresh: vi.fn() },
}));

const fault = vi.hoisted(() => ({ phase: '', target: '' }));
vi.mock('node:fs', async original => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs,
    readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
      if (fault.phase === 'read' && args[0] === fault.target) {
        fault.phase = '';
        throw Object.assign(new Error('fixture unreadable ledger'), { code: 'EACCES' });
      }
      return fs.readFileSync(...args);
    },
    fsyncSync: (fd: number) => {
      const phase = fs.fstatSync(fd).isDirectory() ? 'directory-sync' : 'file-sync';
      if (fault.phase === phase) {
        fault.phase = '';
        throw new Error(`fixture ${phase}`);
      }
      fs.fsyncSync(fd);
    },
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      if (fault.phase === 'write' && (typeof args[0] === 'number' || args[0] === fault.target)) {
        fault.phase = '';
        fs.writeFileSync(args[0], '{');
        throw new Error('fixture interrupted write');
      }
      return fs.writeFileSync(...args);
    },
    renameSync: (...args: Parameters<typeof fs.renameSync>) => {
      fs.renameSync(...args);
      if (fault.phase === 'published' && args[1] === fault.target) {
        fault.phase = '';
        throw new Error('fixture post-publication failure');
      }
    },
  };
});
const roots: string[] = [];
afterEach(() => {
  fault.phase = '';
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'agon-telemetry-recovery-'));
  roots.push(root);
  const path = join(root, 'telemetry.json');
  fault.target = path;
  return { path, ledger: new TelemetryLedger(path) };
}
const record = (id: string, success = true): RunRecord => ({ id, timestamp: 1000,
  mode: 'brainstorm', taskType: 'question', winner: success ? 'fixture' : undefined,
  success, durationMs: 10, engineIds: ['fixture'], completionState: success ? 'completed' : 'crashed' });

it('retains the first terminal receipt when a failure retries its ID', () => {
  const { path, ledger } = fixture();
  ledger.append(record('stable'));
  new TelemetryLedger(path).append(record('stable', false));
  expect(new TelemetryLedger(path).read().runs).toEqual([record('stable')]);
});

it('preserves the previous ledger after a partial write', () => {
  const { path, ledger } = fixture();
  ledger.append(record('prior'));
  const before = readFileSync(path);
  fault.phase = 'write';
  expect(() => ledger.append(record('next'))).toThrow('fixture interrupted write');
  expect(readFileSync(path)).toEqual(before);
  ledger.append(record('next'));
  expect(new TelemetryLedger(path).read().runs.map(item => item.id)).toEqual(['prior', 'next']);
});

it('recovers the published receipt after an ambiguous write error', () => {
  const { path, ledger } = fixture();
  fault.phase = 'published';
  expect(() => ledger.append(record('stable'))).toThrow('fixture post-publication failure');
  new TelemetryLedger(path).append(record('stable', false));
  expect(new TelemetryLedger(path).read().runs).toEqual([record('stable')]);
});

it('does not overwrite a corrupt ledger during append', () => {
  const { path, ledger } = fixture();
  writeFileSync(path, '{operator evidence');
  expect(ledger.read()).toEqual({ version: 1, runs: [] });
  expect(() => ledger.append(record('next'))).toThrow();
  expect(readFileSync(path, 'utf8')).toBe('{operator evidence');
});

it.each([{ version: 2, runs: [] }, { version: 1, runs: 'invalid' }])('preserves unsupported ledger shape %j', value => {
  const { path, ledger } = fixture();
  const bytes = JSON.stringify(value);
  writeFileSync(path, bytes);
  expect(() => ledger.append(record('next'))).toThrow('Invalid telemetry');
  expect(readFileSync(path, 'utf8')).toBe(bytes);
});

it('bounds retention and permits a previously evicted ID', () => {
  const { ledger } = fixture();
  ledger.write({ version: 1, runs: Array.from({ length: 2000 }, (_, index) => record(`prior-${index}`)) });
  ledger.append(record('new'));
  expect(ledger.read().runs).toHaveLength(2000);
  expect(ledger.read().runs[0].id).toBe('prior-1');
  ledger.append(record('prior-0', false));
  expect(ledger.read().runs).toHaveLength(2000);
  expect(ledger.read().runs.at(-1)).toEqual(record('prior-0', false));
});

it.each(['file-sync', 'directory-sync', 'read'])('preserves receipts after %s failure', phase => {
  const { path, ledger } = fixture();
  ledger.append(record('prior'));
  const before = readFileSync(path);
  fault.phase = phase;
  expect(() => ledger.append(record('next'))).toThrow('fixture');
  if (phase !== 'directory-sync') expect(readFileSync(path)).toEqual(before);
  new TelemetryLedger(path).append(record('next'));
  expect(new TelemetryLedger(path).read().runs).toEqual([record('prior'), record('next')]);
});

it('returns the retained terminal receipt without requiring optional historical fields', () => {
  const { ledger } = fixture();
  const first = record('stable', false);
  expect(ledger.append(first)).toEqual(first);
  expect(ledger.append(record('stable', true))).toEqual(first);
});

it.each(['stable', 'different'])('refuses an incomplete retained receipt with ID %s', id => {
  const { path, ledger } = fixture();
  const bytes = JSON.stringify({ version: 1, runs: [{ id }] });
  writeFileSync(path, bytes);
  expect(() => ledger.append(record('stable'))).toThrow('Invalid telemetry');
  expect(readFileSync(path, 'utf8')).toBe(bytes);
});

it('does not reclaim an aged lock while its writer is alive', () => {
  const { path, ledger } = fixture();
  const lock = JSON.stringify({ pid: process.pid, uuid: 'live-owner', hostname: hostname(), acquiredAt: new Date(0).toISOString() });
  writeFileSync(`${path}.lock`, lock);
  let now = 100000;
  vi.spyOn(Date, 'now').mockImplementation(() => { now += 1000; return now; });
  expect(() => ledger.append(record('next'))).toThrow('file lock timeout');
  expect(readFileSync(`${path}.lock`, 'utf8')).toBe(lock);
});

it('keeps one real telemetry receipt when Brainstorm retries after publication', async () => {
  const { path } = fixture();
  vi.stubEnv('AGON_HOME', join(path, '..'));
  vi.resetModules();
  const { recordRun } = await import('../../packages/cli/src/telemetry/index.js');
  const checkpoint = vi.fn();
  const session = createBrainstormSessionRecord({ question: 'fixture', engines: ['fixture'], signal: new AbortController().signal }, {
    now: () => 1000, checkpoint, appendMessage: () => {}, track: () => {}, addResult: () => {},
    recordRun: result => {
      const stored = recordRun(result);
      if (result.success) throw new Error('host failed after recording');
      return stored;
    },
    formatSummary: () => 'summary',
  });
  expect(() => session.complete({ winner: 'fixture', response: 'answer', bids: [] })).toThrow('host failed after recording');
  session.fail();
  session.fail();
  const stored = JSON.parse(readFileSync(path, 'utf8')).runs;
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ id: checkpoint.mock.calls[0][0], success: true, completionState: 'completed' });
});

it('keeps distinct generated IDs when callers do not provide one', async () => {
  const { path } = fixture();
  vi.stubEnv('AGON_HOME', join(path, '..'));
  vi.resetModules();
  const { recordRun } = await import('../../packages/cli/src/telemetry/index.js');
  const input = { mode: 'brainstorm', success: true, durationMs: 10, completionState: 'completed' as const };
  const first = recordRun(input);
  const second = recordRun(input);
  expect(first.id).not.toBe(second.id);
  expect(JSON.parse(readFileSync(path, 'utf8')).runs).toHaveLength(2);
});
