import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  describeCandidate,
  enforceStrictCompileArgs,
  readEffectiveKernVersion,
  selectCandidate,
} from '../../scripts/kern-cli-resolver.mjs';

const tempRoots: string[] = [];

function makeTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'agon-kern-resolver-'));
  tempRoots.push(root);
  return root;
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeKernPackage(root: string, name: string, version: string, dependencies: Record<string, string> = {}) {
  const packageRoot = path.join(root, 'node_modules/@kernlang', name);
  writeJson(path.join(packageRoot, 'package.json'), {
    name: `@kernlang/${name}`,
    version,
    type: 'module',
    dependencies,
  });
  return packageRoot;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('kern cli resolver', () => {
  it('forces strict compile diagnostics unless tolerant recovery is explicit', () => {
    expect(enforceStrictCompileArgs(['--target=auto', '--recursive'])).toEqual([
      '--target=auto',
      '--recursive',
      '--strict-parse',
    ]);
    expect(enforceStrictCompileArgs(['--target=auto', '--strict-parse'])).toEqual([
      '--target=auto',
      '--strict-parse',
    ]);
    expect(enforceStrictCompileArgs(['--target=auto', '--tolerant'])).toEqual([
      '--target=auto',
      '--tolerant',
    ]);
  });

  it('uses resolved package family versions instead of the stale spec KERN_VERSION constant', () => {
    const root = makeTempRoot();
    const cliRoot = writeKernPackage(root, 'cli', '3.2.3', {
      '@kernlang/core': '3.2.3',
      '@kernlang/terminal': '3.2.3',
    });
    const coreRoot = writeKernPackage(root, 'core', '3.2.3');
    writeKernPackage(root, 'terminal', '3.2.3');

    mkdirSync(path.join(coreRoot, 'dist'), { recursive: true });
    writeFileSync(path.join(coreRoot, 'dist/spec.js'), "export const KERN_VERSION = '2.0.0';\n");

    expect(readEffectiveKernVersion(cliRoot)).toBe('3.2.3');
  });

  it('reports the lowest resolved Kern family version to catch stale siblings', () => {
    const root = makeTempRoot();
    const cliRoot = writeKernPackage(root, 'cli', '3.2.3', {
      '@kernlang/core': '3.2.3',
      '@kernlang/terminal': '3.2.3',
    });
    writeKernPackage(root, 'core', '3.2.3');
    writeKernPackage(root, 'terminal', '3.1.7');

    expect(readEffectiveKernVersion(cliRoot)).toBe('3.1.7');
  });

  it('rejects candidates whose resolved family is older than the required version', () => {
    const candidate = describeCandidate(
      'workspace @kernlang/cli',
      'kern',
      [],
      '3.2.3',
      '3.1.7',
    );

    const selection = selectCandidate([candidate], '3.2.3');

    expect(selection.candidate).toBeNull();
    expect(selection.rejected).toEqual([
      'workspace @kernlang/cli -> 3.1.7 (declares 3.2.3)',
    ]);
  });

  it('returns unknown when a declared Kern sibling cannot be resolved', () => {
    const root = makeTempRoot();
    const cliRoot = writeKernPackage(root, 'cli', '3.2.3', {
      '@kernlang/core': '3.2.3',
    });

    expect(readEffectiveKernVersion(cliRoot)).toBeNull();
  });
});
