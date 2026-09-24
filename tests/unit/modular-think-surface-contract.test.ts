import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { assertContributionInput } from '../../packages/mod-kernel/src/index.js';
import { createMod } from '../../packages/mod-think/src/implementation.js';

describe('Think TUI domain contract', () => {
  it('passes the parsed problem and flags through schema validation to the engine', async () => {
    let command!: CommandContribution;
    const dispatch = vi.fn(async () => ({ engineId: 'fixture', exitCode: 0, timedOut: false,
      stdout: JSON.stringify({ thoughts: [], summary: 'fixture answer', openQuestions: [] }) }));
    const services = { engines: { dispatch }, receipts: { record: async () => 'fixture' } } as unknown as ModServices;
    const mod = await createMod(services);
    await mod.activate({ command: (surface, value) => { if (surface === 'tui') command = value; return () => {}; } } as Registrar);
    const input = JSON.parse(JSON.stringify(command.parse!('/think inspect the architecture --steps 4 --strategy linear')));
    expect(() => assertContributionInput(command.inputSchema!, input)).not.toThrow();
    const result = await command.run(input, { cwd: process.cwd(), invocationId: 'fixture', platform: 'darwin-arm64', signal: new AbortController().signal, config: {} });
    expect(result).toMatchObject({ exitCode: 0 });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]?.[1]).toContain('inspect the architecture');
    expect(input).toMatchObject({ input: 'inspect the architecture', steps: 4, strategy: 'linear' });
  });
});
