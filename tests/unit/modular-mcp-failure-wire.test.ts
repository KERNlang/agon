import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@kernlang/agon-mod-api';

const { input } = vi.hoisted(() => ({ input: { current: undefined as EventEmitter | undefined } }));
vi.mock('node:readline', () => ({ createInterface: () => input.current }));
import { startMcpServer } from '../../packages/mcp/src/agon-orchestration.js';

afterEach(() => vi.restoreAllMocks());

describe('generated MCP failure wire contract', () => {
  it('does not start work cancelled before dispatch and ignores unknown cancellation', async () => {
    input.current = new EventEmitter();
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => { writes.push(String(chunk)); return true; });
    const invoke = vi.fn(async () => 'must not run');
    startMcpServer(new Set(['Fixture']), () => {}, () => [{ name: 'Fixture', ownerId: 'agon.brainstorm', description: 'fixture', inputSchema: {} }], invoke);
    input.current.emit('line', JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/call', params: { name: 'Fixture' } }));
    for (const requestId of ['unknown', 0]) input.current.emit('line', JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId } }));
    await new Promise(resolve => setImmediate(resolve));
    expect(invoke).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
  it('cancels only the matching invocation and suppresses its late reply', async () => {
    input.current = new EventEmitter();
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => { writes.push(String(chunk)); return true; });
    const calls: Array<{ signal?: AbortSignal; finish: (value: unknown) => void }> = [];
    startMcpServer(new Set(['Fixture']), () => {}, () => [{ name: 'Fixture', ownerId: 'agon.brainstorm', description: 'fixture', inputSchema: {} }],
      (_name, _args, signal?: AbortSignal) => new Promise(resolve => calls.push({ signal, finish: resolve })));
    for (const id of [1, 2]) input.current.emit('line', JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'Fixture' } }));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    input.current.emit('line', JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }));
    // A numeric request ID and a string request ID are distinct.
    input.current.emit('line', JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: '2' } }));
    expect(calls[0].signal?.aborted).toBe(true);
    expect(calls[1].signal?.aborted).toBe(false);
    calls[0].finish('late cancelled output');
    calls[1].finish('other output');
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(JSON.parse(writes[0])).toEqual({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'other output' }] } });
  });
  it('reports an executed command failure as isError, not protocol success or an internal RPC error', async () => {
    input.current = new EventEmitter();
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => { writes.push(String(chunk)); return true; });
    startMcpServer(new Set(['Fixture']), () => {}, () => [{ name: 'Fixture', ownerId: 'agon.brainstorm', description: 'fixture', inputSchema: {} }], async () => {
      throw new CommandExecutionError({ exitCode: 1, stderr: 'fixture command failed' });
    });
    input.current.emit('line', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'Fixture', arguments: {} } }));
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(JSON.parse(writes[0])).toEqual({ jsonrpc: '2.0', id: 1, result: {
      isError: true, content: [{ type: 'text', text: 'fixture command failed' }],
    } });
  });
});
