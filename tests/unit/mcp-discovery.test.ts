import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Import the internal extraction function straight from its module
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
    const testHome = join('/tmp', `mcp-test-${Date.now()}`);

    beforeEach(() => {
      mkdirSync(join(testHome, '.claude'), { recursive: true });
      vi.stubEnv('HOME', testHome);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      rmSync(testHome, { recursive: true, force: true });
    });

    it('returns empty array when no config files exist', async () => {
      const { discoverMcpServers } = await import('@kernlang/agon-core');
      expect(discoverMcpServers()).toEqual([]);
    });

    it('reads Claude Code mcpServers format from global settings', async () => {
      const { discoverMcpServers } = await import('@kernlang/agon-core');
      writeFileSync(join(testHome, '.claude', 'settings.json'), JSON.stringify({
        mcpServers: {
          github: { command: 'npx', args: ['-y', '@mcp/github'] },
          fs: { command: 'npx', args: ['-y', '@mcp/fs', '/tmp'], env: { HOME: '/tmp' } },
          disabled: { command: 'skip-me', disabled: true },
        },
      }));
      const servers = discoverMcpServers();
      const names = servers.map(s => s.name);
      expect(names).toContain('github');
      expect(names).toContain('fs');
      expect(names).not.toContain('disabled');
      const gh = servers.find(s => s.name === 'github')!;
      expect(gh.command).toBe('npx');
      expect(gh.args).toEqual(['-y', '@mcp/github']);
    });

    it('settings.local.json overrides settings.json by name', async () => {
      const { discoverMcpServers } = await import('@kernlang/agon-core');
      writeFileSync(join(testHome, '.claude', 'settings.json'), JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['global'] } } }));
      writeFileSync(join(testHome, '.claude', 'settings.local.json'), JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['local'] } } }));
      expect(discoverMcpServers().find(s => s.name === 'github')!.args).toEqual(['local']);
    });

    it('fingerprint changes when a global settings file appears', async () => {
      const { mcpDiscoveryFingerprint } = await import('@kernlang/agon-core');
      const before = mcpDiscoveryFingerprint();
      expect(mcpDiscoveryFingerprint()).toBe(before);
      writeFileSync(join(testHome, '.claude', 'settings.json'), '{}');
      expect(mcpDiscoveryFingerprint()).not.toBe(before);
    });
  });
});
