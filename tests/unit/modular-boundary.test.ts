import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('public Mod API boundary', () => {
  it('contains no kernel singleton or private Agon imports', () => {
    const files = sourceFiles('packages/mod-api/src');
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(/from ['"]@kernlang\/agon-(?:core|kernel|cli|forge|mcp|adapter)/);
    expect(source).not.toMatch(/from ['"][.]{2}\//);
    expect(source).not.toMatch(/new ModRegistry|globalThis|singleton/i);
  });

  it('allows the kernel to consume only public Mod API entrypoints', () => {
    const files = sourceFiles('packages/mod-kernel/src');
    const imports = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/from ['"](@kernlang\/agon-mod-api[^'"]*)['"]/g)].map((match) => match[1]));
    expect(imports.length).toBeGreaterThan(0);
    expect(new Set(imports)).toEqual(new Set(['@kernlang/agon-mod-api']));
  });

  it('declares exactly one workspace kernel package instance', () => {
    const rootPackage = JSON.parse(readFileSync('package.json', 'utf8')) as { workspaces: string[] };
    const kernelPackages = rootPackage.workspaces.filter((workspace) => {
      const packageJson = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8')) as { name: string };
      return packageJson.name === '@kernlang/agon-kernel';
    });
    expect(kernelPackages).toEqual(['packages/mod-kernel']);
  });
});
