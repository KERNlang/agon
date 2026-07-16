import { describe, expect, it } from 'vitest';

import { companionDispatch } from '../../packages/core/src/generated/sessions/companion-dispatch.js';

describe('companionDispatch', () => {
  it('returns an error result instead of crashing when companion stdin closes early', async () => {
    const result = await companionDispatch({
      binaryPath: process.execPath,
      config: {
        protocol: 'stream-json',
        serverCmd: ['-e', 'process.exit(0)'],
      },
      prompt: 'hello',
      cwd: process.cwd(),
      timeout: 1,
      mode: 'exec',
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/Companion stdin closed|Turn timed out|stdin|EPIPE/i);
  });

  it('kills a companion process that returns a result but ignores SIGTERM', async () => {
    const startedAt = Date.now();
    const script = [
      "process.on('SIGTERM', () => {});",
      "process.stdout.write(JSON.stringify({ type: 'result', result: 'ok' }) + '\\n');",
      'setInterval(() => {}, 1000);',
    ].join('');

    const result = await companionDispatch({
      binaryPath: process.execPath,
      config: {
        protocol: 'stream-json',
        serverCmd: ['-e', script],
      },
      prompt: 'hello',
      cwd: process.cwd(),
      timeout: 1,
      mode: 'exec',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ok');
    expect(Date.now() - startedAt).toBeLessThan(3000);
  });

  it('concatenates token-level ACP agent_message_chunk deltas instead of one word per paragraph', async () => {
    // Fake ACP server: answers initialize/session/new, then streams the agent
    // message as per-word chunks (kimi style) with a tool_call in the middle,
    // then resolves session/prompt.
    const script = [
      "const rl = require('node:readline').createInterface({ input: process.stdin });",
      "const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');",
      "const chunk = (text) => w({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });",
      "rl.on('line', (line) => {",
      "  const msg = JSON.parse(line);",
      "  if (msg.method === 'initialize') w({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1 } });",
      "  if (msg.method === 'session/new') w({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 's1' } });",
      "  if (msg.method === 'session/prompt') {",
      "    chunk('I\\'ll'); chunk(' start'); chunk(' by');",
      "    w({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'ls', status: 'completed' } } });",
      "    chunk(' Done'); chunk('.');",
      "    w({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } });",
      "  }",
      "});",
    ].join('');

    const result = await companionDispatch({
      binaryPath: process.execPath,
      config: {
        protocol: 'acp',
        serverCmd: ['-e', script],
      },
      prompt: 'hello',
      cwd: process.cwd(),
      timeout: 5,
      mode: 'exec',
    });

    expect(result.exitCode).toBe(0);
    // Chunks within a run concatenate verbatim; the tool_call splits the runs
    // into two '\n\n'-joined paragraphs.
    expect(result.stdout).toBe("I'll start by\n\n Done.");
  });
});
