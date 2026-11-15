import { randomUUID } from 'node:crypto';
import { closeSync, fchmodSync, fchownSync, fstatSync, fsyncSync, lstatSync, openSync, realpathSync, renameSync, rmSync, writeSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export type Identity = Pick<Stats, 'dev' | 'ino' | 'size' | 'mtimeMs' | 'mode'>;

export function assertStillValidated(realPath: string, validated: Identity): void {
  const now = lstatSync(realPath);
  if (now.dev !== validated.dev || now.ino !== validated.ino || now.size !== validated.size || now.mtimeMs !== validated.mtimeMs || now.mode !== validated.mode) {
    throw new Error('file changed during undo');
  }
}

export function restoreBytes(realPath: string, bytes: Buffer, pre: { mode: number; uid: number; gid: number }, validated: Identity): void {
  const parent = dirname(realPath);
  const temp = join(parent, `.${basename(realPath)}.agon-undo-${randomUUID().slice(0, 8)}`);
  const fd = openSync(temp, 'wx', 0o600);
  try {
    try {
      writeSync(fd, bytes);
      const created = fstatSync(fd);
      if (created.uid !== pre.uid || created.gid !== pre.gid) fchownSync(fd, pre.uid, pre.gid);
      fchmodSync(fd, pre.mode);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (realpathSync(parent) !== parent) throw new Error('parent directory changed during undo');
    assertStillValidated(realPath, validated);
    renameSync(temp, realPath);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
