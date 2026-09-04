import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from './implementation.js';

const context = {
  invocationId: 'brainstorm-test',
  cwd: process.cwd(),
  platform: 'darwin-arm64' as const,
  signal: new AbortController().signal,
  config: {},
};

function harness(outputs: Record<string, unknown>) {
  const dispatch = vi.fn(async (engineId: string) => outputs[engineId] ?? {
    engineId,
    exitCode: 1,
    stdout: '',
    stderr: 'failed',
    timedOut: false,
  });
  const record = vi.fn(async () => 'receipt');
  const services = {
    identity: { id: 'agon.brainstorm', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` },
    source: 'bundled',
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    receipts: { record },
    permissions: { check: vi.fn(async () => 'allow') },
    state: { read: vi.fn(), write: vi.fn() },
    engines: { listActive: vi.fn(async () => ['alpha', 'beta']), dispatch },
  } as unknown as ModServices;
  const registered: { surface: string; command: CommandContribution }[] = [];
  const registrar = {
    command: (surface: string, command: CommandContribution) => { registered.push({ surface, command }); return () => {}; },
    intent: () => () => {},
    tool: () => () => {},
    planStep: () => () => {},
    resultType: () => () => {},
  } as unknown as Registrar;
  return { services, registered, dispatch, record, registrar };
}

describe('physical brainstorm mod', () => {
  it('discovers engines, runs seats concurrently, chooses a result, and records evidence', async () => {
    const h = harness({
      alpha: { engineId: 'alpha', exitCode: 0, stdout: JSON.stringify({ approach: 'A', confidence: 55, steps: ['one'], tradeoffs: [] }), stderr: '', timedOut: false },
      beta: { engineId: 'beta', exitCode: 0, stdout: JSON.stringify({ approach: 'B', confidence: 80, steps: ['one', 'two'], tradeoffs: ['cost'] }), stderr: '', timedOut: false },
    });
    const mod = await createMod(h.services);
    await mod.activate(h.registrar, h.services);
    const command = h.registered.find(({ surface }) => surface === 'cli')!.command;
    const result = await command.run({ question: 'What should we build?' }, context);
    const parsed = JSON.parse((result as { stdout: string }).stdout);
    expect(parsed).toMatchObject({ winner: 'beta', response: 'B', panelHealth: { requested: 2, responded: 2, degraded: false } });
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    expect(h.record).toHaveBeenCalledWith('brainstorm', { winner: 'beta', requested: 2, responded: 2 });
  });

  it('reports partial failure without turning a usable panel into a false failure', async () => {
    const h = harness({
      alpha: { engineId: 'alpha', exitCode: 0, stdout: JSON.stringify({ approach: 'usable', confidence: 60 }), stderr: '', timedOut: false },
    });
    const mod = await createMod(h.services);
    await mod.activate(h.registrar, h.services);
    const result = await h.registered[0].command.run({ question: 'Question' }, context);
    const parsed = JSON.parse((result as { stdout: string }).stdout);
    expect(parsed.panelHealth).toMatchObject({ requested: 2, responded: 1, degraded: true });
    expect(parsed.panelHealth.failures[0]).toMatchObject({ engineId: 'beta', error: 'failed' });
  });

  it('fails closed when no seat returns usable output', async () => {
    const h = harness({});
    const mod = await createMod(h.services);
    await mod.activate(h.registrar, h.services);
    await expect(h.registered[0].command.run({ question: 'Question' }, context)).resolves.toMatchObject({ exitCode: 1 });
    expect(h.record).not.toHaveBeenCalled();
  });
});
