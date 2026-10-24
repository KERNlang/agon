import { describe, expect, it, vi } from 'vitest';
import type { IntentContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from './implementation.js';

async function setup() {
  const calls: any[] = [];
  const services = {
    identity: { id: 'agon.agent', version: '1', contentHash: `sha256:${'a'.repeat(64)}` }, source: 'bundled',
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record: vi.fn(async () => 'agent-r') },
    permissions: { check: vi.fn() }, state: { read: vi.fn(), write: vi.fn() },
    engines: { listActive: vi.fn(async () => ['builder', 'reviewer']), dispatch: vi.fn(async (id: string, prompt: string, _context: any, options: any) => {
      calls.push({ id, p: prompt, o: options });
      return { id, exitCode: 0, stdout: options.mode === 'review' ? 'fix concrete issue' : 'done', stderr: '', timedOut: false };
    }) },
  } as unknown as ModServices;
  const intents = new Map<string, IntentContribution>();
  const registrar = {
    intent: (value: IntentContribution) => { intents.set(value.id, value); return () => {}; },
    command: () => () => {}, tool: () => () => {}, planStep: () => () => {}, resultType: () => () => {}, config: () => () => {}, docs: () => () => {},
  } as unknown as Registrar;
  const mod = await createMod(services); await mod.activate(registrar, services);
  return { intents, calls, context: { invocationId: 'a', cwd: process.cwd(), platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} } };
}

describe('physical agent mod', () => {
  it('keeps team-agent control flow sequential: build, review, revision', async () => {
    const h = await setup(); const out = await h.intents.get('intentVariants:0058')!.run({ task: 'change it' }, h.context) as any;
    expect(out.exitCode).toBe(0); expect(h.calls.map((entry) => entry.o.mode)).toEqual(['agent', 'review', 'agent']); expect(out.result.completed).toBe(true);
  });
  it('makes speculate read-only', async () => {
    const h = await setup(); await h.intents.get('intentVariants:0054')!.run({ task: 'inspect' }, h.context);
    expect(h.calls[0].o.mode).toBe('exec'); expect(h.calls[0].o.systemPrompt).toContain('read-only');
  });
});
