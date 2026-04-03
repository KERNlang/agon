import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const spawnMock = vi.fn();

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return { ...actual, spawn: spawnMock };
});

function createMockProcess(onLine: (line: string, stdout: PassThrough) => void) {
  const proc = new EventEmitter() as any;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  let buffer = '';
  stdin.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString();
    while (buffer.includes('\n')) {
      const idx = buffer.indexOf('\n');
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.trim()) onLine(line, stdout);
    }
  });

  proc.stdin = stdin;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.pid = 4242;
  proc.kill = vi.fn();

  return proc;
}

async function collectTextChunks(gen: AsyncGenerator<{ type: string; content: string }>) {
  const parts: string[] = [];
  for await (const chunk of gen) {
    if (chunk.type === 'text') parts.push(chunk.content);
  }
  return parts;
}

afterEach(() => {
  spawnMock.mockReset();
});

describe('persistent session streaming dedupe', () => {
  it('dedupes Codex companion completed messages after deltas', async () => {
    spawnMock.mockImplementationOnce(() => createMockProcess((line, stdout) => {
      const msg = JSON.parse(line);

      if (msg.id && msg.method === 'initialize') {
        stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
        return;
      }

      if (msg.id && msg.method === 'thread/start') {
        stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { thread: { id: 'thread-1' } } }) + '\n');
        return;
      }

      if (msg.id && msg.method === 'turn/start') {
        stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
        stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'item/agentMessage/delta',
          params: { delta: 'Hey. ' },
        }) + '\n');
        stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'item/agentMessage/delta',
          params: { delta: 'What do you need help with in Agon-AI?' },
        }) + '\n');
        stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'item/completed',
          params: {
            item: {
              type: 'agentMessage',
              text: 'Hey. What do you need help with in Agon-AI?',
            },
          },
        }) + '\n');
        stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'turn/completed', params: {} }) + '\n');
      }
    }));

    const { createCompanionSession } = await import('../../packages/core/src/generated/persistent-session.js');
    const session = createCompanionSession({
      engine: {
        id: 'codex',
        binary: 'codex',
        companion: { protocol: 'jsonrpc', serverCmd: ['app-server'] },
      } as any,
      binaryPath: '/usr/local/bin/codex',
      cwd: process.cwd(),
      systemPrompt: 'You are helpful.',
    });

    await session.start();
    const text = (await collectTextChunks(session.send({ message: 'hey' }))).join('');

    expect(text).toBe('Hey. What do you need help with in Agon-AI?');
  });

  it('dedupes Claude result text after streamed deltas and assistant snapshot', async () => {
    spawnMock.mockImplementationOnce(() => {
      const proc = createMockProcess((line, stdout) => {
        const msg = JSON.parse(line);
        if (msg.type !== 'user') return;

        stdout.write(JSON.stringify({
          type: 'content_block_delta',
          delta: { text: 'Hey. ' },
        }) + '\n');
        stdout.write(JSON.stringify({
          type: 'content_block_delta',
          delta: { text: 'What do you need help with in Agon-AI?' },
        }) + '\n');
        stdout.write(JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Hey. What do you need help with in Agon-AI?' }],
            stop_reason: 'end_turn',
          },
        }) + '\n');
        stdout.write(JSON.stringify({
          type: 'result',
          result: 'Hey. What do you need help with in Agon-AI?',
        }) + '\n');
      });

      setTimeout(() => {
        proc.stdout.write(JSON.stringify({
          type: 'system',
          session_id: 'claude-session-1',
          message: 'ready',
        }) + '\n');
      }, 0);

      return proc;
    });

    const { createStreamJsonSession } = await import('../../packages/core/src/generated/persistent-session.js');
    const session = createStreamJsonSession({
      engine: { id: 'claude', binary: 'claude' } as any,
      binaryPath: '/usr/local/bin/claude',
      cwd: process.cwd(),
      systemPrompt: 'You are helpful.',
    });

    await session.start();
    const text = (await collectTextChunks(session.send({ message: 'hey' }))).join('');

    expect(text).toBe('Hey. What do you need help with in Agon-AI?');
  });
});
