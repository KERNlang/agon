import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod, resolveAskInput } from './implementation.js';

describe('physical ask mod', () => {
  it('preserves one- and two-positional semantics', () => {
    expect(resolveAskInput({ engine: 'hello', _: ['world'] })).toEqual({ engineId: '', prompt: 'hello world' });
    expect(resolveAskInput({ engine: 'codex', prompt: 'hello', _: ['world'] })).toEqual({ engineId: 'codex', prompt: 'hello world' });
  });
  it('dispatches through the injected public engine capability without legacy compatibility', async () => {
    const dispatch = vi.fn(async () => ({ engineId: 'codex', exitCode: 0, stdout: 'OK\n', stderr: '', durationMs: 4, timedOut: false }));
    const receipt = vi.fn(async () => 'receipt');
    const services = { identity: { id: 'agon.ask', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` }, source: 'bundled',
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record: receipt }, permissions: { check: vi.fn(async () => 'allow') },
      state: { read: vi.fn(), write: vi.fn() }, engines: { dispatch } } as unknown as ModServices;
    let command: CommandContribution | undefined;
    const registrar = { command: (_surface: string, value: CommandContribution) => { command = value; return () => {}; } } as unknown as Registrar;
    const mod = await createMod(services); await mod.activate(registrar, services);
    expect(command).toBeDefined();
    const result = await command!.run({ engine: 'codex', prompt: 'hello', timeout: '10' }, { invocationId: 'i', cwd: '/tmp', platform: 'darwin-arm64', signal: new AbortController().signal, config: {} });
    expect(result).toEqual({ exitCode: 0, stdout: 'OK\n', stderr: 'AGON_SUMMARY: 1/1 succeeded\n' });
    const quiet = await command!.run({ engine: 'codex', prompt: 'hello', quiet: true }, { invocationId: 'i', cwd: '/tmp', platform: 'darwin-arm64', signal: new AbortController().signal, config: {} });
    expect(quiet).toEqual({ exitCode: 0, stdout: 'OK\n' });
    expect(dispatch).toHaveBeenCalledWith('codex', 'hello', expect.anything(), { timeoutSeconds: 10, systemPrompt: undefined });
    expect(receipt).toHaveBeenCalledWith('ask', expect.objectContaining({ engineId: 'codex', ok: true }));
  });
  it('still reports AGON_SUMMARY with a real engine name when the dispatch fails or throws', async () => {
    const dispatch = vi.fn();
    const services = { identity: { id: 'agon.ask', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` }, source: 'bundled',
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record: vi.fn(async () => 'receipt') }, permissions: { check: vi.fn(async () => 'allow') },
      state: { read: vi.fn(), write: vi.fn() }, engines: { dispatch } } as unknown as ModServices;
    let command: CommandContribution | undefined;
    const registrar = { command: (_surface: string, value: CommandContribution) => { command = value; return () => {}; } } as unknown as Registrar;
    const mod = await createMod(services); await mod.activate(registrar, services);
    const context = { invocationId: 'i', cwd: '/tmp', platform: 'darwin-arm64', signal: new AbortController().signal, config: {} };

    dispatch.mockRejectedValueOnce(new Error('seat died'));
    const thrown = await command!.run({ engine: 'codex', prompt: 'hello' }, context);
    expect(thrown).toEqual({ exitCode: 1, stderr: 'seat died\nAGON_SUMMARY: 0/1 succeeded; codex: error\n' });

    dispatch.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: false });
    const unnamed = await command!.run({ engine: 'hello' }, context);
    expect(unnamed).toEqual({ exitCode: 1, stderr: 'default exited 1 with no answer\nAGON_SUMMARY: 0/1 succeeded; default: error\n' });

    dispatch.mockRejectedValueOnce(new Error('seat died'));
    const quiet = await command!.run({ engine: 'codex', prompt: 'hello', quiet: true }, context);
    expect(quiet).toEqual({ exitCode: 1, stderr: 'seat died\n' });
  });
});
