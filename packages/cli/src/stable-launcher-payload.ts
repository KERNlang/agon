import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

export interface StableBootstrap {
  hostPath: string;
  prefix: string;
  generation: number;
  kernelVersion: string;
  payloadHash: string;
  leaseId: string;
  artifactHash: string;
}

/** Bind the retained executable and its dependencies without importing them. */
export function hashBootstrapPayload(root: string): string {
  if (realpathSync(root) !== resolve(root)) throw new Error('recovery prefix has a symbolic-link alias');
  const inventory: Array<[string, string]> = [];
  const pending = [''];
  let bytesRead = 0;
  let entries = 1;
  while (pending.length) {
    const name = pending.pop()!;
    if (name.split('/').length > 64) throw new Error('recovery payload exceeds the verification depth limit');
    const path = join(root, name);
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink()) throw new Error('recovery payload contains a symbolic link');
    if (metadata.isDirectory()) {
      inventory.push([name, 'directory']);
      const directory = opendirSync(path);
      try {
        let child;
        while ((child = directory.readSync()) !== null) {
          if (++entries > 100_000) throw new Error('recovery payload exceeds the verification entry limit');
          pending.push(join(name, child.name));
        }
      } finally { directory.closeSync(); }
    } else if (metadata.isFile()) {
      const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const opened = fstatSync(descriptor);
        if (!opened.isFile() || opened.ino !== metadata.ino || opened.dev !== metadata.dev) throw new Error('recovery payload changed during inspection');
        const hash = createHash('sha256');
        const buffer = Buffer.allocUnsafe(64 * 1024);
        let count: number;
        while ((count = readSync(descriptor, buffer, 0, buffer.length, null)) !== 0) {
          bytesRead += count;
          if (bytesRead > 512 * 1024 * 1024) throw new Error('recovery payload exceeds the verification byte limit');
          hash.update(buffer.subarray(0, count));
        }
        inventory.push([name, hash.digest('hex')]);
      } finally { closeSync(descriptor); }
    } else throw new Error('recovery payload contains a non-regular entry');
  }
  inventory.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `sha256:${createHash('sha256').update(JSON.stringify(inventory)).digest('hex')}`;
}

export function containedBootstrapPrefix(host: string, prefix: string): string {
  const target = resolve(host, prefix);
  const path = relative(host, target);
  if (!prefix || isAbsolute(prefix) || !path || path === '..' || path.startsWith('../') || isAbsolute(path)) {
    throw new Error('managed installation prefix escapes host');
  }
  return target;
}
