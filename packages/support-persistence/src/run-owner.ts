import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { constants, openSync, closeSync, fstatSync, readSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hostInstance = randomUUID();
let bootId: string | null | undefined;

function currentBootId(): string | null {
  if (bootId !== undefined) return bootId;
  try {
    const value = process.platform === 'linux'
      ? readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
      : process.platform === 'darwin'
        ? execFileSync('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], {
          encoding: 'utf8', timeout: 1000, maxBuffer: 1024, stdio: ['ignore', 'pipe', 'pipe'],
        }).trim() : '';
    bootId = uuid.test(value) ? value.toLowerCase() : null;
  } catch { bootId = null; } // Restricted platforms remain unknown, never presumed dead.
  return bootId;
}

export interface RunOwnerProbe {
  bootId(): string | null;
  pidNamespace(): string | null;
  pidState(pid: number): 'present' | 'absent' | 'unknown';
}

const localProbe: RunOwnerProbe = {
  bootId: currentBootId,
  pidNamespace() {
    if (process.platform === 'darwin') return 'darwin-host';
    try { return process.platform === 'linux' ? readlinkSync('/proc/self/ns/pid') : null; }
    catch { return null; }
  },
  pidState(pid) {
    try { process.kill(pid, 0); return 'present'; }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'absent' : 'unknown'; }
  },
};

/** Diagnostic evidence only. This record is neither a lease nor recovery authority. */
export function writeRunOwner(runPath: string): void {
  writeFileSync(join(runPath, 'owner.json'), JSON.stringify({
    schemaVersion: 1, runId: basename(runPath), pid: process.pid,
    hostInstance, bootId: currentBootId(), pidNamespace: localProbe.pidNamespace(),
  }) + '\n', { flag: 'wx', mode: 0o600 });
}

export type RunOwnerObservation = {
  state: 'process-absent' | 'unknown';
  reason: 'same-boot-pid-absent' | 'missing-owner' | 'invalid-owner' | 'boot-unverified'
    | 'pid-present-ownership-unverified' | 'pid-probe-unavailable' | 'namespace-unverified';
};

/** Read-only observation, never a reason to replay effects or overwrite status.json.
 * A present PID may have been reused. A different boot may belong to another machine.
 */
export function inspectRunOwner(runPath: string, probe: RunOwnerProbe = localProbe): RunOwnerObservation {
  let fd: number | undefined;
  let record: Record<string, unknown>;
  try {
    fd = openSync(join(runPath, 'owner.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 4096) return { state: 'unknown', reason: 'invalid-owner' };
    const buffer = Buffer.alloc(4097);
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    if (length > 4096) return { state: 'unknown', reason: 'invalid-owner' };
    record = JSON.parse(buffer.subarray(0, length).toString('utf8'));
    if (!record || Array.isArray(record) || record.schemaVersion !== 1 || record.runId !== basename(runPath)
      || !Number.isInteger(record.pid) || (record.pid as number) <= 0 || (record.pid as number) > 2147483647
      || typeof record.hostInstance !== 'string' || !uuid.test(record.hostInstance)
      || (record.bootId !== null && (typeof record.bootId !== 'string' || !uuid.test(record.bootId)))) {
      return { state: 'unknown', reason: 'invalid-owner' };
    }
  } catch (error) {
    return { state: 'unknown', reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing-owner' : 'invalid-owner' };
  } finally { if (fd !== undefined) closeSync(fd); }
  try {
    const current = probe.bootId();
    if (!current || typeof record.bootId !== 'string' || current.toLowerCase() !== record.bootId.toLowerCase()) {
      return { state: 'unknown', reason: 'boot-unverified' };
    }
    const namespace = probe.pidNamespace();
    if (!namespace || typeof record.pidNamespace !== 'string' || namespace !== record.pidNamespace) {
      return { state: 'unknown', reason: 'namespace-unverified' };
    }
    const state = probe.pidState(record.pid as number);
    if (state === 'absent') return { state: 'process-absent', reason: 'same-boot-pid-absent' };
    return { state: 'unknown', reason: state === 'present' ? 'pid-present-ownership-unverified' : 'pid-probe-unavailable' };
  } catch { return { state: 'unknown', reason: 'pid-probe-unavailable' }; }
}

export function describeRunOwner(runPath: string): string {
  const observation = inspectRunOwner(runPath);
  return `Owner observation: ${observation.state} (${observation.reason}). This is not permission to replay the run.`;
}
