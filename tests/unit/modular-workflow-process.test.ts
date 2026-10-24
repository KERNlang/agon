import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { emitChunks, runWorkflowCommand } from '../../packages/mod-jobs/src/workflow-process.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

describe('Jobs subprocess output boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([NaN, Infinity, 0, -1, 0.5, 2 ** 31])('rejects invalid admission timeout %s before spawning', async timeoutMs => {
    await expect(runWorkflowCommand({ signal: new AbortController().signal, emit: vi.fn() },
      'fixture.mjs', [], process.cwd(), 32, 20,
      { generation: 'generation-one', assertCurrent: vi.fn(), timeoutMs })).rejects.toThrow(/timeout/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses a child from another generation before granting execution', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(),
      send: vi.fn(), kill: vi.fn(),
    });
    vi.mocked(spawn).mockReturnValue(child as ReturnType<typeof spawn>);
    const pending = runWorkflowCommand({ signal: new AbortController().signal, emit: vi.fn() },
      'fixture.mjs', [], process.cwd(), 32, 20,
      { generation: 'parent-generation', assertCurrent: vi.fn() });
    const result = expect(pending).rejects.toThrow(/generation/i);
    child.emit('message', { event: 'agon-job-ready', protocolVersion: 1, generation: 'other-generation' });
    child.emit('close', 0, null);
    await result;
    expect(child.send).not.toHaveBeenCalled();
  });

  it('decodes split UTF-8 independently on stdout and stderr, including a final partial character', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(),
    });
    vi.mocked(spawn).mockReturnValue(child as ReturnType<typeof spawn>);
    const events: Array<{ type: string; data?: unknown }> = [];
    const pending = runWorkflowCommand({ signal: new AbortController().signal, emit: (type, data) => {
      events.push({ type, data });
    } }, 'fixture.mjs', ['fixture'], process.cwd(), 3, 20);
    const stdout = Buffer.from('é🦒');
    const stderr = Buffer.from('漢字');
    for (let index = 0; index < Math.max(stdout.length, stderr.length); index++) {
      if (index < stdout.length) child.stdout.emit('data', stdout.subarray(index, index + 1));
      if (index < stderr.length) child.stderr.emit('data', stderr.subarray(index, index + 1));
    }
    child.stderr.emit('data', Buffer.from([0xe2]));
    child.stdout.emit('data', Buffer.from([0xe2]));
    child.emit('close', 0, null);
    expect(await pending).toBe(0);
    const text = (type: string) => events.filter(event => event.type === type)
      .map(event => (event.data as { text: string }).text).join('');
    expect(text('stdout')).toBe('é🦒�');
    expect(text('stderr')).toBe('漢字�');
    expect(events.at(-1)?.type).toBe('command-finished');
  });

  it.each([NaN, Infinity, 0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid chunk limit %s before emitting', (limit) => {
    const emit = vi.fn();
    expect(() => emitChunks({ signal: new AbortController().signal, emit }, 'stdout', 'text', limit))
      .toThrow(/positive safe integer/i);
    expect(emit).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, 0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid chunk limit %s before spawning', async (limit) => {
    await expect(runWorkflowCommand({ signal: new AbortController().signal, emit: vi.fn() },
      'fixture.mjs', [], process.cwd(), limit, 20)).rejects.toThrow(/positive safe integer/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([1, Number.MAX_SAFE_INTEGER])('accepts chunk boundary %s and preserves text', (limit) => {
    const emit = vi.fn();
    emitChunks({ signal: new AbortController().signal, emit }, 'stdout', 'abc', limit);
    expect(emit.mock.calls.map(call => call[1].text).join('')).toBe('abc');
    expect(emit.mock.calls.every(call => call[1].text.length <= limit)).toBe(true);
  });

  it('rejects invalid limits even when there is no output', () => {
    const emit = vi.fn();
    expect(() => emitChunks({ signal: new AbortController().signal, emit }, 'stdout', '', 0))
      .toThrow(/positive safe integer/i);
    expect(emit).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3, 4, 5])('keeps surrogate pairs intact with a bounded limit of %s', limit => {
    const chunks: string[] = [];
    const text = '🦒a🦒🦒éz🦒';
    emitChunks({ signal: new AbortController().signal, emit: (_type, data) => {
      chunks.push((data as { text: string }).text);
    } }, 'stdout', text, limit);
    expect(chunks.join('')).toBe(text);
    expect(chunks.every(chunk => chunk.length > 0 && chunk.length <= Math.max(2, limit))).toBe(true);
    expect(chunks.every(chunk => Buffer.from(chunk).toString('utf8') === chunk)).toBe(true);
  });
});
