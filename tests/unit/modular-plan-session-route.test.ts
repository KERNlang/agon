import { describe, expect, it, vi } from 'vitest';
import type { IntentContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from '../../packages/mod-plan/src/implementation.js';

async function routes(services: unknown) {
  const intents: IntentContribution[] = [];
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (method === 'intent') intents.push(args[0] as IntentContribution);
    return () => {};
  } }) as Registrar;
  await (await createMod(services as ModServices)).activate(registrar);
  return intents;
}
const context = { cwd: '/fixture', invocationId: 'fixture', platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };

describe('physical Plan session routing', () => {
  it.each([
    ['/plan build a parser', { type: 'plan-task', task: 'build a parser' }],
    ['/plan resume cplan-123', { type: 'plan-resume', planId: 'cplan-123' }],
    ['/plan resume', { type: 'plan-resume' }],
    ['/plan resumeDatabase', { type: 'plan-task', task: 'resumeDatabase' }],
    ['/plan', { type: 'plan' }],
    ['/plans', { type: 'plans' }],
    ['/approve', { type: 'approve' }],
    ['/cancel', { type: 'cancel' }],
    ['/retry', { type: 'retry' }],
    ['/auto build a parser', { type: 'auto', input: 'build a parser', autoMode: true }],
  ])('%s invokes the interactive workflow', async (input, expected) => {
    const run = vi.fn(async () => ({ exitCode: 0 }));
    const intents = await routes({ planSession: { run } });
    const intent = intents.find((entry) => entry.parse(input) !== undefined)!;
    await expect(intent.run(JSON.parse(JSON.stringify(intent.parse(input))), context)).resolves.toEqual({ exitCode: 0 });
    expect(run).toHaveBeenCalledWith(expected, context);
  });
  it('refuses a headless approval instead of selecting the latest persisted plan', async () => {
    const intents = await routes({});
    const intent = intents.find((entry) => entry.parse('/approve') !== undefined)!;
    await expect(intent.run({}, context)).resolves.toMatchObject({ exitCode: 2 });
  });
});
