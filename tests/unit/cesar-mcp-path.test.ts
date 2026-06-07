import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

// Regression guard for the pre-existing bug (ba4dab57): the agon-orchestration
// MCP server path was a fixed '../../../../mcp/dist/index.js' relative to a tsup
// BUNDLE chunk, which resolved to a NONEXISTENT path — so the MCP server never
// spawned and Cesar saw zero tools. resolveAgonMcpServerPath() must find it
// robustly across layouts.

const { resolveAgonMcpServerPath } = await import('../../packages/cli/src/generated/cesar/session.js');

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'mcp-path-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('resolveAgonMcpServerPath', () => {
  it('resolves the real, existing agon-mcp entry from this module (createRequire / workspace symlink)', () => {
    // Default fromUrl = the cli module; @kernlang/agon-mcp is a workspace dep, so
    // node resolution finds the real dist/index.js — and it must actually exist.
    const p = resolveAgonMcpServerPath();
    expect(p.replace(/\\/g, '/')).toMatch(/mcp\/dist\/index\.js$/);
    expect(existsSync(p)).toBe(true);
  });

  it('walks up to packages/mcp/dist/index.js in a monorepo with no node_modules symlink', () => {
    // Simulate a bundled CLI chunk deep in a repo with no resolvable dependency.
    const cliDist = join(tmp, 'packages', 'cli', 'dist');
    mkdirSync(cliDist, { recursive: true });
    const realMcp = join(tmp, 'packages', 'mcp', 'dist', 'index.js');
    mkdirSync(join(tmp, 'packages', 'mcp', 'dist'), { recursive: true });
    writeFileSync(realMcp, '// stub');
    const fromUrl = pathToFileURL(join(cliDist, 'chunk-abc.js')).href;

    expect(resolveAgonMcpServerPath(fromUrl)).toBe(realMcp);
  });

  it('falls back to the relative last-resort guess when nothing resolves', () => {
    // A location with no node_modules dep and no packages/mcp anywhere above.
    // dirname is tmp/a/b/c/d → ../../../../mcp/dist/index.js resolves to tmp/mcp/dist/index.js.
    const deep = join(tmp, 'a', 'b', 'c', 'd');
    mkdirSync(deep, { recursive: true });
    const fromUrl = pathToFileURL(join(deep, 'x.js')).href;

    expect(resolveAgonMcpServerPath(fromUrl)).toBe(join(tmp, 'mcp', 'dist', 'index.js'));
  });
});
