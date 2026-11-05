import { readFileSync, existsSync, statSync } from 'node:fs';

import { join } from 'node:path';

import { homedir } from 'node:os';

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string,string>;
  url?: string;
}

function _readJsonSafe(path: string): unknown|null {
  try {
    if (!existsSync(path)) {
      return null;
    }
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    return null;
  }
}

/**
 * Extract MCP server definitions from a JSON config. Supports Claude Code format (mcpServers: {name: {command, args, env}}) and array format.
 */
function _extractMcpServers(data: unknown): McpServerConfig[] {
  if (!data || typeof data !== 'object') {
    return [];
  }
  const record = data as Record<string, unknown>;
  // Claude Code / Cursor format: { mcpServers: { serverName: { command, args, env } } }
  const serversObj = record.mcpServers ?? record.mcp_servers ?? record.servers;
  if (serversObj && typeof serversObj === 'object' && !Array.isArray(serversObj)) {
    const result: McpServerConfig[] = [];
    for (const [name, def] of Object.entries(serversObj as Record<string, unknown>)) {
      if (!def || typeof def !== 'object') {
        continue;
      }
      const d = def as Record<string, unknown>;
      // Skip disabled servers
      if (d.disabled === true) {
        continue;
      }
      result.push({ name: name, command: String(d.command ?? ''), args: Array.isArray(d.args) ? d.args.map(String) : undefined, env: (d.env && typeof d.env === 'object') ? (d.env as Record<string, string>) : undefined, url: (typeof d.url === 'string') ? d.url : undefined });
    }
    return result.filter(s => s.command || s.url);
  }
  // Array format: [{ name, command, args, env }]
  if (Array.isArray(serversObj)) {
    return serversObj.filter((s: unknown) => s && typeof s === 'object').map((s: any) => Object.assign({}, { name: String(s.name ?? ''), command: String(s.command ?? ''), args: Array.isArray(s.args) ? s.args.map(String) : undefined, env: (s.env && typeof s.env === 'object') ? s.env : undefined, url: (typeof s.url === 'string') ? s.url : undefined })).filter((s: McpServerConfig) => (s.command || s.url) && s.name);
  }
  return [];
}

/**
 * Auto-discover MCP server configs from the user's global settings. Repository files (.vscode/mcp.json, .cursor/mcp.json, .agon.json) are never read: engines launch discovered servers with no approval, so a cloned repo must not be able to name one. Returns deduplicated list by server name.
 */
export function discoverMcpServers(): McpServerConfig[] {
  const home = homedir();
  const servers = new Map<string, McpServerConfig>();
  // 1. ~/.claude/settings.json
  const claudeSettings = _readJsonSafe(join(home, '.claude', 'settings.json'));
  if (claudeSettings) {
    for (const s of _extractMcpServers(claudeSettings)) {
      servers.set(s.name, s);
    }
  }
  // 2. ~/.claude/settings.local.json (overrides global)
  const claudeLocal = _readJsonSafe(join(home, '.claude', 'settings.local.json'));
  if (claudeLocal) {
    for (const s of _extractMcpServers(claudeLocal)) {
      servers.set(s.name, s);
    }
  }
  return Array.from(servers.values());
}

/**
 * Compute a fingerprint of all MCP config source files. Changes when any config file is modified.
 */
export function mcpDiscoveryFingerprint(): string {
  const home = homedir();
  const paths = [join(home, '.claude', 'settings.json'), join(home, '.claude', 'settings.local.json')];
  const parts: string[] = [];
  for (const p of paths) {
    try {
      if (existsSync(p)) {
        parts.push(`${p}:${statSync(p).mtimeMs}`);
      }
    } catch (e) {
    }
  }
  return parts.join('|');
}

/**
 * Convert discovered McpServerConfig[] to the wire format expected by PersistentSessionConfig.mcpServers.
 */
export function mcpServersToWireFormat(servers: McpServerConfig[]): Array<Record<string,unknown>> {
  return servers.map(s => {
    const wire: Record<string, unknown> = { name: s.name, command: s.command };
    if (s.args) wire.args = s.args;
    if (s.env) wire.env = s.env;
    if (s.url) wire.url = s.url;
    return wire;
  });
}
