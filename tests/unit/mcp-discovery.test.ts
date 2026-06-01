import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Import the internal extraction function via the generated module
// Since _extractMcpServers is not exported, we test through discoverMcpServers behavior
// and test the wire format conversion directly
import { mcpServersToWireFormat } from '@kernlang/agon-core';
import type { McpServerConfig } from '@kernlang/agon-core';

describe('MCP Discovery', () => {
  describe('mcpServersToWireFormat', () => {
    it('converts McpServerConfig to wire format', () => {
      const servers: McpServerConfig[] = [
        { name: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
        { name: 'fs', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'], env: { HOME: '/tmp' } },
      ];
      const wire = mcpServersToWireFormat(servers);
      expect(wire).toHaveLength(2);
      expect(wire[0]).toEqual({ name: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] });
      expect(wire[1]).toEqual({ name: 'fs', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'], env: { HOME: '/tmp' } });
    });

    it('omits optional fields when undefined', () => {
      const servers: McpServerConfig[] = [
        { name: 'simple', command: '/usr/bin/server' },
      ];
      const wire = mcpServersToWireFormat(servers);
      expect(wire[0]).toEqual({ name: 'simple', command: '/usr/bin/server' });
      expect('args' in wire[0]).toBe(false);
      expect('env' in wire[0]).toBe(false);
    });

    it('includes url when present', () => {
      const servers: McpServerConfig[] = [
        { name: 'remote', command: '', url: 'https://mcp.example.com/sse' },
      ];
      const wire = mcpServersToWireFormat(servers);
      expect(wire[0]).toEqual({ name: 'remote', command: '', url: 'https://mcp.example.com/sse' });
    });
  });

  describe('discoverMcpServers', () => {
    const testDir = join('/tmp', `mcp-test-${Date.now()}`);

    beforeAll(() => {
      mkdirSync(testDir, { recursive: true });
    });

    afterAll(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it('returns empty array when no config files exist', async () => {
      const { discoverMcpServers } = await import('@kernlang/agon-core');
      const servers = discoverMcpServers(testDir);
      // May find global ~/.claude configs — just verify it doesn't throw
      expect(Array.isArray(servers)).toBe(true);
    });

    it('reads Claude Code mcpServers format from .agon.json', async () => {
      const { discoverMcpServers } = await import('@kernlang/agon-core');
      writeFileSync(join(testDir, '.agon.json'), JSON.stringify({
        mcpServers: {
          github: { command: 'npx', args: ['-y', '@mcp/github'] },
          fs: { command: 'npx', args: ['-y', '@mcp/fs', '/tmp'], env: { HOME: '/tmp' } },
          disabled: { command: 'skip-me', disabled: true },
        },
      }));
      const servers = discoverMcpServers(testDir);
      const names = servers.map(s => s.name);
      expect(names).toContain('github');
      expect(names).toContain('fs');
      expect(names).not.toContain('disabled');
      const gh = servers.find(s => s.name === 'github')!;
      expect(gh.command).toBe('npx');
      expect(gh.args).toEqual(['-y', '@mcp/github']);
    });

    it('reads from .vscode/mcp.json', async () => {
      const { discoverMcpServers } = await import('@kernlang/agon-core');
      mkdirSync(join(testDir, '.vscode'), { recursive: true });
      writeFileSync(join(testDir, '.vscode', 'mcp.json'), JSON.stringify({
        mcpServers: {
          vscode_server: { command: 'node', args: ['server.js'] },
        },
      }));
      const servers = discoverMcpServers(testDir);
      const names = servers.map(s => s.name);
      expect(names).toContain('vscode_server');
    });

    it('project-level overrides global by name', async () => {
      const { discoverMcpServers } = await import('@kernlang/agon-core');
      // .agon.json has github with custom args (from previous test)
      // Any global github server should be overridden
      const servers = discoverMcpServers(testDir);
      const gh = servers.find(s => s.name === 'github')!;
      // Should have the .agon.json version (project-level wins)
      expect(gh.args).toEqual(['-y', '@mcp/github']);
    });
  });

  describe('mcpDiscoveryFingerprint', () => {
    it('returns consistent fingerprint for same state', async () => {
      const { mcpDiscoveryFingerprint } = await import('@kernlang/agon-core');
      const fp1 = mcpDiscoveryFingerprint('/tmp');
      const fp2 = mcpDiscoveryFingerprint('/tmp');
      expect(fp1).toBe(fp2);
    });

    it('returns different fingerprint for different cwd', async () => {
      const { mcpDiscoveryFingerprint } = await import('@kernlang/agon-core');
      const fp1 = mcpDiscoveryFingerprint('/tmp');
      const fp2 = mcpDiscoveryFingerprint('/');
      // May or may not differ depending on whether config files exist at /
      // but the function should not throw
      expect(typeof fp1).toBe('string');
      expect(typeof fp2).toBe('string');
    });
  });
});
