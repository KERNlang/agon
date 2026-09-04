import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from './implementation.js';

const context = { invocationId: 'campfire-test', cwd: process.cwd(), platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };

async function setup(fail = false) {
  const dispatch = vi.fn(async (engineId: string, prompt: string) => ({ engineId, exitCode: fail ? 1 : 0, stdout: fail ? '' : `${engineId} view of ${prompt}`, stderr: fail ? 'failed' : '', timedOut: false }));
  const record = vi.fn(async () => 'receipt');
  const services = { identity: { id: 'agon.campfire', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` }, source: 'bundled', logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record }, permissions: { check: vi.fn(async () => 'allow') }, state: { read: vi.fn(), write: vi.fn() }, engines: { listActive: vi.fn(async () => ['alpha', 'beta']), dispatch } } as unknown as ModServices;
  let command: CommandContribution | undefined;
  const registrar = { command: (surface: string, value: CommandContribution) => { if (surface === 'cli') command = value; return () => {}; }, intent: () => () => {}, tool: () => () => {}, planStep: () => () => {} } as unknown as Registrar;
  const mod = await createMod(services); await mod.activate(registrar, services);
  return { command: command!, dispatch, record };
}

describe('physical campfire mod', () => {
  it('runs lead-first and exposes the lead response to the remaining seats', async () => {
    const h = await setup();
    const result = await h.command.run({ topic: 'Modularity', strategy: 'lead-first', lead: 'beta' }, context);
    const parsed = JSON.parse((result as { stdout: string }).stdout);
    expect(parsed).toMatchObject({ strategy: 'lead-first', lead: 'beta', panelHealth: { requested: 2, responded: 2, degraded: false } });
    expect(h.dispatch.mock.calls[0][0]).toBe('beta');
    expect(h.dispatch.mock.calls[1][1]).toContain('LEAD (beta)');
    expect(h.record).toHaveBeenCalledWith('campfire', { strategy: 'lead-first', lead: 'beta', requested: 2, responded: 2 });
  });

  it('dispatches all-respond seats independently', async () => {
    const h = await setup();
    const result = await h.command.run({ topic: 'Modularity', strategy: 'all-respond' }, context);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    expect(h.dispatch.mock.calls.every((call) => !String(call[1]).includes('LEAD ('))).toBe(true);
  });

  it('fails closed when every engine fails', async () => {
    const h = await setup(true);
    await expect(h.command.run({ topic: 'Modularity' }, context)).resolves.toMatchObject({ exitCode: 1 });
    expect(h.record).not.toHaveBeenCalled();
  });
});
