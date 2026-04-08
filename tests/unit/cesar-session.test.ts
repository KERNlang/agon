import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { canUseCesarMcp, loadCesarMcpServers, normalizeCesarMcpServers } from '../../packages/cli/src/generated/cesar-session.js';

const testDirs: string[] = [];

afterEach(() => {
  for (const dir of testDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(name: string): string {
  const dir = join(tmpdir(), `agon-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  testDirs.push(dir);
  return dir;
}

describe('cesar MCP session config', () => {
  it('normalizes named mcpServers objects into an array with names', () => {
    const servers = normalizeCesarMcpServers({
      mcpServers: {
        github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
      },
    });

    expect(servers).toEqual([
      { name: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
    ]);
  });

  it('normalizes servers objects from vscode-style config', () => {
    const servers = normalizeCesarMcpServers({
      servers: {
        linear: { url: 'https://example.com/mcp' },
      },
    });

    expect(servers).toEqual([
      { name: 'linear', url: 'https://example.com/mcp' },
    ]);
  });

  it('returns undefined when Cesar MCP is disabled', () => {
    const dir = makeTempDir('mcp-disabled');
    const servers = loadCesarMcpServers({
      cesarMcpEnabled: false,
      cesarMcpConfigPath: join(dir, 'missing.json'),
    }, dir);

    expect(servers).toBeUndefined();
  });

  it('loads MCP config from a relative JSON path', () => {
    const dir = makeTempDir('mcp-relative');
    const configPath = join(dir, '.vscode');
    mkdirSync(configPath, { recursive: true });
    writeFileSync(join(configPath, 'mcp.json'), JSON.stringify({
      mcpServers: {
        github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
      },
    }));

    const servers = loadCesarMcpServers({
      cesarMcpEnabled: true,
      cesarMcpConfigPath: '.vscode/mcp.json',
    }, dir);

    expect(servers).toEqual([
      { name: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
    ]);
  });

  it('throws when enabled config contains no servers', () => {
    const dir = makeTempDir('mcp-empty');
    const file = join(dir, 'mcp.json');
    writeFileSync(file, JSON.stringify({ mcpServers: {} }));

    expect(() => loadCesarMcpServers({
      cesarMcpEnabled: true,
      cesarMcpConfigPath: file,
    }, dir)).toThrow(/No MCP servers found/);
  });

  it('allows MCP for companion CLI protocols including Codex jsonrpc', () => {
    expect(canUseCesarMcp({ companion: { protocol: 'acp' } }, '/usr/local/bin/gemini')).toBe(true);
    expect(canUseCesarMcp({ companion: { protocol: 'jsonrpc' } }, '/usr/local/bin/codex')).toBe(true);
    expect(canUseCesarMcp({ companion: { protocol: 'structured-cli' } }, '/usr/local/bin/other')).toBe(false);
    expect(canUseCesarMcp({ companion: { protocol: 'jsonrpc' } }, '')).toBe(false);
  });
});
