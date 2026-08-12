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

  it('forwards the system prompt via systemPromptFlag on the stream-json path', async () => {
    // Fake server echoes its argv back as the result — proves the flag+prompt
    // landed on the command line (stream-json has no in-band system-prompt channel).
    // The '--' keeps node from eating the appended flags as node options; the
    // interval keeps stdin writable until dispatch teardown kills the process.
    const script = "process.stdout.write(JSON.stringify({ type: 'result', result: process.argv.slice(1).join(' ') }) + '\\n'); setInterval(() => {}, 1000);";
    const result = await companionDispatch({
      binaryPath: process.execPath,
      config: {
        protocol: 'stream-json',
        serverCmd: ['-e', script, '--'],
        systemPromptFlag: '--system-prompt',
      },
      prompt: 'hello',
      cwd: process.cwd(),
      timeout: 5,
      mode: 'exec',
      systemPrompt: 'SEAT_STANCE_MARKER do not use tools',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--system-prompt');
    expect(result.stdout).toContain('SEAT_STANCE_MARKER');
  });

  it('appends textOnlyArgs only when the dispatch sets textOnly', async () => {
    const script = "process.stdout.write(JSON.stringify({ type: 'result', result: process.argv.slice(1).join(' ') }) + '\\n'); setInterval(() => {}, 1000);";
    const config = {
      protocol: 'stream-json' as const,
      serverCmd: ['-e', script, '--'],
      textOnlyArgs: ['--tools', ''],
    };
    const base = { binaryPath: process.execPath, config, prompt: 'hello', cwd: process.cwd(), timeout: 5, mode: 'exec' as const };

    const withTextOnly = await companionDispatch({ ...base, textOnly: true });
    expect(withTextOnly.stdout).toContain('--tools');

    const withoutTextOnly = await companionDispatch({ ...base });
    expect(withoutTextOnly.stdout).not.toContain('--tools');
  });

  it('returns empty stdout when a stream-json exec turn ends on tool_use, so the adapter falls through to CLI spawn', async () => {
    const script = [
      "process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'I will quickly verify the file paths.' }, { type: 'tool_use', name: 'Read', input: {} }] } }) + '\\n');",
      "process.stdout.write(JSON.stringify({ type: 'result', result: 'I will quickly verify the file paths.' }) + '\\n');",
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
      timeout: 5,
      mode: 'exec',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('tool_use');
    expect(result.stderr).toContain('quickly verify');
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

  it.each([
    { mode: 'exec', options: "[{ optionId: 'allow', kind: 'allow_once' }, { optionId: 'deny', kind: 'reject_once' }]", approve: false, expected: 'deny' },
    { mode: 'review', options: "[{ optionId: 'allow', kind: 'allow_once' }, { optionId: 'deny', kind: 'reject_once' }]", approve: false, expected: 'deny' },
    { mode: 'exec', options: "[{ optionId: 'allow', kind: 'allow_once' }]", approve: false, expected: 'error' },
    { mode: 'exec', options: "[{ optionId: 'allow', kind: 'allow_once' }, { optionId: 'deny', kind: 'reject_once' }]", approve: true, expected: 'deny' },
    { mode: 'agent', options: "[{ optionId: 'allow', kind: 'allow_once' }, { optionId: 'deny', kind: 'reject_once' }]", approve: true, expected: 'allow' },
  ] as const)('enforces ACP write policy in $mode mode', async ({ mode, options, approve, expected }) => {
    const script = [
      "const rl = require('node:readline').createInterface({ input: process.stdin });",
      "const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');",
      'let promptId = 0;',
      "rl.on('line', (line) => {",
      '  const msg = JSON.parse(line);',
      "  if (msg.method === 'initialize') w({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1 } });",
      "  if (msg.method === 'session/new') w({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 's1' } });",
      "  if (msg.method === 'session/prompt') {",
      '    promptId = msg.id;',
      `    w({ jsonrpc: '2.0', id: 99, method: 'session/request_permission', params: { options: ${options}, toolCall: { name: 'write_file', args: { file_path: 'unsafe.txt' } } } });`,
      '  }',
      '  if (msg.id === 99 && !msg.method) {',
      "    const text = msg.error ? 'error' : msg.result.optionId;",
      "    w({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });",
      "    w({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } });",
      '  }',
      '});',
    ].join('');

    const result = await companionDispatch({
      binaryPath: process.execPath,
      config: {
        protocol: 'acp',
        serverCmd: ['-e', script],
      },
      prompt: 'do not write',
      cwd: process.cwd(),
      timeout: 5,
      mode,
      onApproval: approve ? async () => true : undefined,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(expected);
  });

  it('rejects non-agent approval callbacks for vendor approval requests', async () => {
    const script = [
      "const rl = require('node:readline').createInterface({ input: process.stdin });",
      "const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');",
      'let promptId = 0;',
      "rl.on('line', (line) => {",
      '  const msg = JSON.parse(line);',
      "  if (msg.method === 'initialize') w({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1 } });",
      "  if (msg.method === 'session/new') w({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 's1' } });",
      "  if (msg.method === 'session/prompt') {",
      '    promptId = msg.id;',
      "    w({ jsonrpc: '2.0', id: 99, method: 'item/fileChange/requestApproval', params: { path: 'unsafe.txt' } });",
      '  }',
      "  if (msg.id === 99 && !msg.method) {",
      "    w({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: msg.result.decision } } } });",
      "    w({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } });",
      '  }',
      '});',
    ].join('');

    const result = await companionDispatch({
      binaryPath: process.execPath,
      config: { protocol: 'acp', serverCmd: ['-e', script] },
      prompt: 'do not write',
      cwd: process.cwd(),
      timeout: 5,
      mode: 'review',
      onApproval: async () => true,
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe('decline');
  });
});
