import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { validateManifest } from '@kernlang/agon-mod-api';
import type { ModManifest } from '@kernlang/agon-mod-api';
import { ImmutableMap } from './readonly-map.js';

const MAX_MANIFEST_BYTES = 256 * 1024;

export class StaticDiscoveryError extends Error {
  readonly code = 'INVALID_STATIC_MOD_PACKAGE';

  constructor(message: string, readonly details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = 'StaticDiscoveryError';
  }
}

export interface StaticManifestInspection {
  readonly packageRoot: string;
  readonly manifestPath: string;
  readonly manifestHash: `sha256:${string}`;
  readonly manifest: ModManifest;
  readonly containedPaths: ReadonlyMap<string, string>;
}

async function requiredRealpath(path: string, description: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    throw new StaticDiscoveryError(description + ' does not resolve', { path, cause: String(error) });
  }
}

export async function assertContainedPackagePath(packageRoot: string, packagePath: string): Promise<string> {
  if (isAbsolute(packagePath)) throw new StaticDiscoveryError('absolute package path is forbidden', { packagePath });
  if (packagePath.split(/[\\/]/).some((segment) => segment === '..')) throw new StaticDiscoveryError('package path traversal is forbidden', { packagePath });
  const canonicalRoot = await requiredRealpath(packageRoot, 'package root');
  const candidate = await requiredRealpath(resolve(canonicalRoot, packagePath), 'package path');
  const fromRoot = relative(canonicalRoot, candidate);
  if (fromRoot === '' || fromRoot === '.' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new StaticDiscoveryError('package path escapes the canonical package root', { packagePath, candidate });
  }
  return candidate;
}

function assertNoDuplicateJsonKeys(text: string): void {
  let index = 0;
  const whitespace = () => { while (/\s/.test(text[index] ?? '')) index += 1; };
  const string = (): string => {
    const start = index++;
    while (index < text.length) {
      if (text[index] === '\\') { index += 2; continue; }
      if (text[index++] === '"') return JSON.parse(text.slice(start, index));
    }
    throw new StaticDiscoveryError('manifest is not valid JSON');
  };
  const value = (): void => {
    whitespace();
    if (text[index] === '{') { object(); return; }
    if (text[index] === '[') { array(); return; }
    if (text[index] === '"') { string(); return; }
    while (index < text.length && !/[\s,}\]]/.test(text[index]!)) index += 1;
  };
  const array = (): void => {
    index += 1; whitespace();
    if (text[index] === ']') { index += 1; return; }
    while (index < text.length) {
      value(); whitespace();
      if (text[index] === ']') { index += 1; return; }
      index += 1;
    }
  };
  const object = (): void => {
    index += 1; whitespace();
    if (text[index] === '}') { index += 1; return; }
    const keys = new Set<string>();
    while (index < text.length) {
      whitespace();
      const key = string();
      if (keys.has(key)) throw new StaticDiscoveryError('duplicate JSON key in manifest', { key });
      keys.add(key);
      whitespace(); index += 1;
      value(); whitespace();
      if (text[index] === '}') { index += 1; return; }
      index += 1;
    }
  };
  value();
}

export interface InspectStaticManifestOptions {
  readonly manifestFile?: string;
  readonly maxManifestBytes?: number;
  readonly verifyReferencedFiles?: boolean;
}

export async function inspectStaticManifest(
  packageRoot: string,
  options: InspectStaticManifestOptions = {},
): Promise<StaticManifestInspection> {
  const manifestFile = options.manifestFile ?? 'agon.mod.json';
  const manifestPath = await assertContainedPackagePath(packageRoot, manifestFile);
  const requestedLimit = options.maxManifestBytes ?? MAX_MANIFEST_BYTES;
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit <= 0) {
    throw new StaticDiscoveryError('manifest byte limit must be a positive safe integer', { requestedLimit });
  }
  const byteLimit = Math.min(requestedLimit, MAX_MANIFEST_BYTES);
  let bytes: Buffer;
  let handle;
  try {
    handle = await open(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new StaticDiscoveryError('manifest is not a regular file', { manifestPath });
    if (stat.size > byteLimit) {
      throw new StaticDiscoveryError('manifest exceeds the static discovery byte limit', { bytes: stat.size, byteLimit });
    }
    bytes = await handle.readFile();
    if (bytes.byteLength > byteLimit) {
      throw new StaticDiscoveryError('manifest exceeds the static discovery byte limit', { bytes: bytes.byteLength, byteLimit });
    }
  } catch (error) {
    if (error instanceof StaticDiscoveryError) throw error;
    throw new StaticDiscoveryError('manifest cannot be opened safely', { manifestPath, cause: String(error) });
  } finally {
    await handle?.close();
  }
  let input: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    input = JSON.parse(text);
    assertNoDuplicateJsonKeys(text);
  } catch (error) {
    if (error instanceof StaticDiscoveryError) throw error;
    throw new StaticDiscoveryError('manifest is not valid JSON', { cause: String(error) });
  }
  const manifest = validateManifest(input);
  const referenced = new Set<string>([
    ...(manifest.entrypoints ? [manifest.entrypoints.runtime, manifest.entrypoints.types] : []),
    ...manifest.assets.map(({ path }) => path),
    ...(options.verifyReferencedFiles === false ? [] : manifest.pack.include),
  ]);
  const containedPaths = new Map<string, string>();
  for (const path of [...referenced].sort()) {
    const canonicalPath = await assertContainedPackagePath(packageRoot, path);
    const referencedHandle = await open(canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await referencedHandle.stat();
      if (!stat.isFile()) throw new StaticDiscoveryError('referenced package path is not a regular file', { path });
      const asset = manifest.assets.find((entry) => entry.path === path);
      if (asset) {
        const assetBytes = await referencedHandle.readFile();
        if (assetBytes.byteLength !== asset.bytes) throw new StaticDiscoveryError('asset bytes do not match manifest', { path, expected: asset.bytes, actual: assetBytes.byteLength });
        const actualHash = `sha256:${createHash('sha256').update(assetBytes).digest('hex')}`;
        if (actualHash !== asset.contentHash) throw new StaticDiscoveryError('asset hash does not match manifest', { path, expected: asset.contentHash, actual: actualHash });
      }
    } finally {
      await referencedHandle.close();
    }
    containedPaths.set(path, canonicalPath);
  }
  return Object.freeze({
    packageRoot: await requiredRealpath(packageRoot, 'package root'),
    manifestPath,
    manifestHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    manifest,
    containedPaths: new ImmutableMap(containedPaths),
  });
}
