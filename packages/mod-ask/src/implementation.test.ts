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
    expect(result).toEqual({ exitCode: 0, stdout: 'OK\n' });
    expect(dispatch).toHaveBeenCalledWith('codex', 'hello', expect.anything(), { timeoutSeconds: 10, systemPrompt: undefined });
    expect(receipt).toHaveBeenCalledWith('ask', expect.objectContaining({ engineId: 'codex', ok: true }));
  });
});
