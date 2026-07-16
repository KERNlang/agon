import { describe, expect, it } from 'vitest';

import { createAcpSession } from '../../packages/core/src/generated/sessions/session-acp.js';

// Strict ACP agents (kimi) validate session/new params against the spec:
// stdio mcpServers entries REQUIRE args/env with env as EnvVariable[]
// ({name,value} pairs), and http entries require headers the same way.
// Agon's internal wire shape uses Record<string,string> env — sending it
// verbatim produced "ACP error -32602: Invalid params" and killed the
// Cesar session. createAcpSession must normalize before session/new.
describe('createAcpSession mcpServers normalization', () => {
  // Fake strict server: rejects session/new with -32602 unless every entry is
  // spec-shaped — stdio needs array args/env ({name,value} pairs) and a
  // command; http/sse needs a url and array headers.
  const strictServerScript = [
    "const rl = require('node:readline').createInterface({ input: process.stdin });",
    "const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');",
    "const pairs = (a) => Array.isArray(a) && a.every((e) => typeof e.name === 'string' && typeof e.value === 'string');",
    "rl.on('line', (line) => {",
    "  const msg = JSON.parse(line);",
    "  if (msg.method === 'initialize') w({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1 } });",
    "  if (msg.method === 'session/new') {",
    "    const servers = msg.params.mcpServers ?? [];",
    "    const ok = servers.every((s) => (s.type === 'http' || s.type === 'sse')",
    "      ? (typeof s.url === 'string' && pairs(s.headers))",
    "      : (typeof s.command === 'string' && Array.isArray(s.args) && pairs(s.env)));",
    "    if (ok) w({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 's1', received: servers } });",
    "    else w({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Invalid params' } });",
    "  }",
    "});",
  ].join('');

  function makeSession(mcpServers: Array<Record<string, unknown>>) {
    return createAcpSession({
      engine: { id: 'fake-acp', companion: { protocol: 'acp', serverCmd: ['-e', strictServerScript] } },
      binaryPath: process.execPath,
      cwd: process.cwd(),
      mcpServers,
    } as never);
  }

  it('boots against a strict ACP server when config.mcpServers uses Record env', async () => {
    const session = makeSession([
      {
        name: 'agon-orchestration',
        command: 'node',
        args: ['/tmp/server.js'],
        env: { AGON_SIGNAL_DIR: '/tmp', AGON_SESSION_ID: 'test' },
      },
    ]);

    try {
      await session.start();
      expect(session.alive).toBe(true);
      expect(session.sessionId).toBe('s1');
    } finally {
      session.close();
    }
  });

  it('normalizes http entries (Record headers) and skips malformed entries', async () => {
    const session = makeSession([
      // http entry with Record headers → headers must become {name,value}[]
      { name: 'remote', type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer x' } },
      // http-typed entry WITHOUT url → must be skipped, not fall through to
      // the stdio shape with command: undefined
      { name: 'broken-http', type: 'http' },
      // stdio entry without command → must be skipped
      { name: 'broken-stdio', env: { A: 'b' } },
    ]);

    try {
      await session.start();
      expect(session.alive).toBe(true);
      expect(session.sessionId).toBe('s1');
    } finally {
      session.close();
    }
  });
});
