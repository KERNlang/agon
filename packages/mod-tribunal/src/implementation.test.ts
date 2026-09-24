import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from './implementation.js';

const context = { invocationId: 'tribunal-test', cwd: process.cwd(), platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };

async function setup(failing = new Set<string>()) {
  const dispatch = vi.fn(async (engineId: string, prompt: string) => ({ engineId, exitCode: failing.has(engineId) ? 1 : 0, stdout: failing.has(engineId) ? '' : prompt.includes('TASK:') ? 'verdict' : `${engineId} argument`, stderr: failing.has(engineId) ? 'failed' : '', timedOut: false }));
  const record = vi.fn(async () => 'receipt');
  const services = { identity: { id: 'agon.tribunal', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` }, source: 'bundled', logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record }, permissions: { check: vi.fn(async () => 'allow') }, state: { read: vi.fn(), write: vi.fn() }, engines: { listActive: vi.fn(async () => ['alpha', 'beta']), dispatch } } as unknown as ModServices;
  let command: CommandContribution | undefined; const registrar = { command: (surface: string, value: CommandContribution) => { if (surface === 'cli') command = value; return () => {}; }, intent: () => () => {}, tool: () => () => {}, planStep: () => () => {}, resultType: () => () => {} } as unknown as Registrar;
  const mod = await createMod(services); await mod.activate(registrar, services); return { command: command!, dispatch, record };
}

describe('physical tribunal mod', () => {
  it('runs the configured rounds and synthesizes a verdict', async () => {
    const h = await setup(); const result = await h.command.run({ question: 'Ship it?', rounds: '2', protocol: 'parallel' }, context); const parsed = JSON.parse((result as { stdout: string }).stdout);
    expect(parsed).toMatchObject({ mode: 'adversarial', protocol: 'parallel', summary: 'verdict', panelHealth: { requested: 4, responded: 4, degraded: false } });
    expect(parsed.rounds).toHaveLength(2); expect(h.dispatch).toHaveBeenCalledTimes(5); expect(h.record).toHaveBeenCalled();
  });
  it('rejects invalid modes and too-small panels before dispatch', async () => {
    const h = await setup(); await expect(h.command.run({ question: 'Q', mode: 'magic' }, context)).resolves.toMatchObject({ exitCode: 1 }); expect(h.dispatch).not.toHaveBeenCalled();
  });
  it('preserves partial evidence and marks a degraded panel', async () => {
    const h = await setup(new Set(['beta'])); const result = await h.command.run({ question: 'Q', rounds: '1' }, context); const parsed = JSON.parse((result as { stdout: string }).stdout);
    expect(parsed.panelHealth).toMatchObject({ requested: 2, responded: 1, degraded: true }); expect(parsed.panelHealth.failures[0]).toMatchObject({ engineId: 'beta' });
  });
});
