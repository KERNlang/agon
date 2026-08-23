import { open, readFile, rename, rm, mkdir, writeFile, stat, readdir, chmod, copyFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface HostIo {
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<unknown>;
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: string | Uint8Array, options?: { flag?: string; mode?: number }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean }>;
  readdir(path: string, options?: { withFileTypes?: boolean }): Promise<readonly any[]>;
  chmod(path: string, mode: number): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  syncFile(path: string): Promise<void>;
  syncDirectory(path: string): Promise<void>;
}

async function syncPath(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export const nodeHostIo: HostIo = {
  mkdir,
  readFile,
  writeFile: async (path, data, options) => { await writeFile(path, data, options); },
  rename,
  rm,
  stat,
  readdir,
  chmod,
  copyFile,
  syncFile: syncPath,
  syncDirectory: syncPath,
};

export async function pathExists(io: HostIo, path: string): Promise<boolean> {
  try {
    await io.stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function atomicWrite(io: HostIo, destination: string, bytes: string | Uint8Array, mode = 0o600): Promise<void> {
  const parent = dirname(destination);
  await io.mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = join(parent, `.${basename(destination)}.${randomUUID()}.tmp`);
  try {
    await io.writeFile(temporary, bytes, { flag: 'wx', mode });
    await io.syncFile(temporary);
    await io.rename(temporary, destination);
    await io.syncDirectory(parent);
  } catch (error) {
    await io.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeNewImmutableFile(io: HostIo, destination: string, bytes: string | Uint8Array): Promise<void> {
  const parent = dirname(destination);
  await io.mkdir(parent, { recursive: true, mode: 0o700 });
  await io.writeFile(destination, bytes, { flag: 'wx', mode: 0o400 });
  await io.syncFile(destination);
  await io.syncDirectory(parent);
}

export async function readJson<T>(io: HostIo, path: string): Promise<T> {
  return JSON.parse((await io.readFile(path)).toString('utf8')) as T;
}
