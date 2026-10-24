import { describe, expect, it, vi } from 'vitest';
import type { AgonModFactory, CommandContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { assertContributionInput } from '../../packages/mod-kernel/src/index.js';
import { createMod as browser } from '../../packages/mod-browser/src/implementation.js';
import { createMod as synthesis } from '../../packages/mod-synthesis/src/implementation.js';

async function tui(factory: AgonModFactory, services: ModServices): Promise<CommandContribution> {
  let contribution!: CommandContribution;
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (method === 'command' && args[0] === 'tui') contribution = args[1] as CommandContribution;
    return () => {};
  } }) as Registrar;
  await (await factory(services)).activate(registrar);
  return contribution;
}
const context = { cwd: process.cwd(), invocationId: 'fixture', platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };

describe('additional TUI composition contracts', () => {
  it('accepts the Chrome parser payload and delivers the task to the browser host', async () => {
    const runCommand = vi.fn(async () => ({ exitCode: 0 }));
    const command = await tui(browser, { browser: { runCommand } } as unknown as ModServices);
    const input = JSON.parse(JSON.stringify(command.parse!('/chrome inspect the fixture page')));
    expect(() => assertContributionInput(command.inputSchema!, input)).not.toThrow();
    await expect(command.run(input, context)).resolves.toMatchObject({ exitCode: 0 });
    expect(runCommand).toHaveBeenCalledWith('chrome', expect.objectContaining({ task: 'inspect the fixture page' }), context);
  });
  it('normalizes the legacy synthesis input and numeric swaps for the domain handler', async () => {
    const dispatch = vi.fn(async () => ({ engineId: 'fixture', exitCode: 0, timedOut: false, stdout: 'WINNER: fixture\nREASONING: fixture evidence' }));
    const command = await tui(synthesis, { engines: { listActive: async () => ['fixture'], dispatch }, receipts: { record: async () => 'fixture' } } as unknown as ModServices);
    const input = JSON.parse(JSON.stringify(command.parse!('/synthesis --swaps 2 build a fixture')));
    expect(input).toMatchObject({ input: 'build a fixture', swaps: 2 });
    expect(() => assertContributionInput(command.inputSchema!, input)).not.toThrow();
    await expect(command.run(input, context)).resolves.toMatchObject({ exitCode: 0, result: { prompt: 'build a fixture' } });
    expect(dispatch).toHaveBeenCalled();
  });
});
