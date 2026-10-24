import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createFrozenNpmInstall, createNpmReleaseCatalog } from '../../packages/mod-kernel/src/npm-lock.js';

const integrity = `sha512-${Buffer.alloc(64).toString('base64')}`;
const registry = (version: string) => ({ version, resolved: `https://registry.npmjs.org/example/-/example-${version}.tgz`, integrity });
function source() {
  return { lockfileVersion: 3, packages: {
    'packages/launcher': { name: '@fixture/launcher', version: '1.0.0', dependencies: { library: '^1.0.0' }, optionalDependencies: { '@fixture/mod': '1.0.0' } },
    'packages/mod': { name: '@fixture/mod', version: '1.0.0', dependencies: { library: '^2.0.0' }, devDependencies: { test: '*' } },
    'node_modules/@fixture/launcher': { link: true, resolved: 'packages/launcher' },
    'node_modules/@fixture/mod': { link: true, resolved: 'packages/mod' },
    'node_modules/library': registry('1.2.3'),
    'packages/mod/node_modules/library': registry('2.3.4'),
    'node_modules/test': registry('9.0.0'),
  } };
}
const artifacts = {
  '@fixture/launcher': { version: '1.0.0', resolved: 'file:/fixture/launcher.tgz', integrity },
  '@fixture/mod': { version: '1.0.0', resolved: 'file:/fixture/mod.tgz', integrity },
};

describe('frozen npm install inputs', () => {
  it('preserves nested versions and omits unselected mods without losing their lock metadata', () => {
    const input = source();
    const before = structuredClone(input);
    const catalog = createNpmReleaseCatalog(input, ['packages/launcher']);
    expect(input).toEqual(before);
    expect(catalog.packages['node_modules/test']).toBeUndefined();
    expect(catalog.packages['node_modules/@fixture/mod']).not.toHaveProperty('devDependencies');
    const minimal = createFrozenNpmInstall(catalog, ['@fixture/launcher'], artifacts);
    expect(minimal.requiredPaths).toEqual(['node_modules/@fixture/launcher', 'node_modules/library']);
    expect(minimal.lock.packages['node_modules/@fixture/mod']).toMatchObject({ optional: true });
    expect(minimal.lock.packages['node_modules/@fixture/mod/node_modules/library']).toMatchObject({ optional: true, version: '2.3.4' });
    const full = createFrozenNpmInstall(catalog, ['@fixture/mod', '@fixture/launcher'], artifacts);
    expect(full.lock.packages['node_modules/@fixture/mod/node_modules/library']).toMatchObject({ optional: false, version: '2.3.4' });
    expect(full.manifest.dependencies).toEqual({ '@fixture/launcher': 'file:/fixture/launcher.tgz', '@fixture/mod': 'file:/fixture/mod.tgz' });
  });

  it('does not pull optional-only peers into the required closure', () => {
    const input = source();
    Object.assign(input.packages['node_modules/library'], { peerDependencies: { test: '*' }, peerDependenciesMeta: { test: { optional: true } } });
    expect(createNpmReleaseCatalog(input, ['packages/launcher']).packages).not.toHaveProperty('node_modules/test');
  });

  it('retains an explicit optional dependency that is also an optional peer', () => {
    const input = source();
    Object.assign(input.packages['packages/launcher'], {
      peerDependencies: { '@fixture/mod': '1.0.0' },
      peerDependenciesMeta: { '@fixture/mod': { optional: true } },
    });
    const catalog = createNpmReleaseCatalog(input, ['packages/launcher']);
    expect(catalog.packages['node_modules/@fixture/mod']).toBeDefined();
    expect(createFrozenNpmInstall(catalog, ['@fixture/launcher'], artifacts).requiredPaths)
      .not.toContain('node_modules/@fixture/mod');
    expect(createFrozenNpmInstall(catalog, ['@fixture/launcher', '@fixture/mod'], artifacts).requiredPaths)
      .toContain('node_modules/@fixture/mod');
  });

  it('uses the ordinary dependency range before an overlapping peer range, as npm does', () => {
    const input = source();
    Object.assign(input.packages['packages/launcher'], { peerDependencies: { library: '^3.0.0' } });
    expect(createNpmReleaseCatalog(input, ['packages/launcher']).packages['node_modules/library']?.version).toBe('1.2.3');
    input.packages['node_modules/library'].version = '3.0.0';
    expect(() => createNpmReleaseCatalog(input, ['packages/launcher'])).toThrow('range does not match');
  });

  it('does not retain another artifact’s integrity when its locator is replaced', () => {
    const catalog = createNpmReleaseCatalog(source(), ['packages/launcher']);
    const launcher = catalog.packages['node_modules/@fixture/launcher']!;
    Object.assign(launcher, registry('1.0.0'));
    const replacement = { version: '1.0.0', resolved: 'file:/fixture/repacked.tgz' };
    const result = createFrozenNpmInstall(catalog, ['@fixture/launcher'], { ...artifacts, '@fixture/launcher': replacement });
    expect(result.lock.packages['node_modules/@fixture/launcher']).not.toHaveProperty('integrity');
    expect(launcher.integrity).toBe(integrity);
  });

  it.each(['node_modules/a/arbitrary/b', 'node_modules/@scope', 'node_modules/a/node_modules/../b'])('rejects malformed physical package location %s', path => {
    const catalog = createNpmReleaseCatalog(source(), ['packages/launcher']);
    const packages = { ...catalog.packages, [path]: registry('1.0.0') };
    expect(() => createFrozenNpmInstall({ ...catalog, packages }, ['@fixture/launcher'], artifacts)).toThrow('invalid frozen npm path');
  });

  it.each(['sha512-A', `sha512-${Buffer.alloc(63).toString('base64')}`, `sha512-${Buffer.alloc(65).toString('base64')}`])('rejects invalid SHA-512 digest %s', invalid => {
    const catalog = createNpmReleaseCatalog(source(), ['packages/launcher']);
    const packages = { ...catalog.packages, 'node_modules/library': { ...registry('1.2.3'), integrity: invalid } };
    expect(() => createFrozenNpmInstall({ ...catalog, packages }, ['@fixture/launcher'], artifacts)).toThrow('invalid npm integrity');
  });

  it('rejects an absolute workspace target instead of hanging in ancestor lookup', () => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { createNpmReleaseCatalog } from './packages/mod-kernel/dist/index.js';
      try {
        createNpmReleaseCatalog({ lockfileVersion: 3, packages: {
          'node_modules/a': { link: true, resolved: '/workspace/a' },
          '/workspace/a': { version: '1.0.0', dependencies: { missing: '*' } }
        } }, ['node_modules/a']);
        process.exitCode = 1;
      } catch (error) {
        if (!String(error).includes('workspace link is invalid')) throw error;
      }
    `], { encoding: 'utf8', timeout: 3000 });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
  });

  it('rejects missing, mismatched and unpinned dependencies', () => {
    const missing = source();
    Reflect.deleteProperty(missing.packages, 'node_modules/library');
    expect(() => createNpmReleaseCatalog(missing, ['packages/launcher'])).toThrow('not locked');
    const mismatch = source();
    mismatch.packages['node_modules/library'].version = '3.0.0';
    expect(() => createNpmReleaseCatalog(mismatch, ['packages/launcher'])).toThrow('range does not match');
    const catalog = createNpmReleaseCatalog(source(), ['packages/launcher']);
    expect(() => createFrozenNpmInstall(catalog, ['@fixture/launcher'], {})).toThrow('no frozen source');
    expect(() => createFrozenNpmInstall(catalog, ['@fixture/launcher'], { ...artifacts, '@fixture/mod': { ...artifacts['@fixture/mod'], version: '2.0.0' } })).toThrow('version differs');
    const corrupt = structuredClone(catalog);
    Reflect.deleteProperty(corrupt.packages['node_modules/library']!, 'integrity');
    expect(() => createFrozenNpmInstall(corrupt, ['@fixture/launcher'], artifacts)).toThrow('no frozen source');
  });

  it('produces the same lock for different input and root orders', () => {
    const input = source();
    const reversed = { ...input, packages: Object.fromEntries(Object.entries(input.packages).reverse()) };
    const a = createNpmReleaseCatalog(input, ['packages/launcher', 'packages/mod']);
    const b = createNpmReleaseCatalog(reversed, ['packages/mod', 'packages/launcher']);
    expect(a).toEqual(b);
    expect(createFrozenNpmInstall(a, ['@fixture/launcher', '@fixture/mod'], artifacts))
      .toEqual(createFrozenNpmInstall(b, ['@fixture/mod', '@fixture/launcher'], artifacts));
  });

  it('rejects a relocated dependency binding even when both versions satisfy its range', () => {
    const input = source();
    const packages = {
      ...input.packages,
      'node_modules/@fixture/other': { ...registry('1.0.0'), dependencies: { library: '^1.0.0' } },
      'node_modules/@fixture/node_modules/library': registry('1.4.0'),
    };
    // The source launcher resolves 1.2.3. Its new scope would resolve 1.4.0.
    expect(() => createNpmReleaseCatalog({ ...input, packages }, ['packages/launcher', 'node_modules/@fixture/other']))
      .toThrow('dependency binding changed');
  });
});
