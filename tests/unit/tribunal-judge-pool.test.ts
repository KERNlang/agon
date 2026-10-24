import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from '../../packages/mod-tribunal/src/implementation.js';
import { runTribunalSession } from '../../packages/mod-tribunal/src/session-workflow.js';
import type { TribunalSessionHost } from '../../packages/mod-tribunal/src/session-workflow.js';
import type { TribunalInvocationContext } from '../../packages/mod-tribunal/src/host.js';
import { withTribunalFixtureHost } from '../fixtures/modular-tribunal-host.js';

const ROSTER = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];

async function setup() {
  const context: TribunalInvocationContext = {
    invocationId: 'judge-pool', cwd: process.cwd(), platform: 'darwin-arm64',
    signal: new AbortController().signal, config: {},
  };
  const dispatch = vi.fn(async (engineId: string) => ({
    engineId, exitCode: 0, stdout: `${engineId} argument`, stderr: '', timedOut: false,
  }));
  const services = withTribunalFixtureHost({
    identity: { id: 'agon.tribunal', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` },
    source: 'bundled', logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    receipts: { record: vi.fn(async () => 'receipt') }, permissions: { check: vi.fn(async () => 'allow') },
    state: { read: vi.fn(), write: vi.fn() },
    engines: { listActive: async () => [...ROSTER], dispatch },
  } as unknown as ModServices);
  const session = await services.tribunal!.open(context);
  const judge = vi.fn(async () => []);
  session.effects.judgeForRating = judge;
  services.tribunal!.open = () => session;
  let command: CommandContribution | undefined;
  const registrar = {
    command: (surface: string, value: CommandContribution) => {
      if (surface === 'cli') command = value;
      return () => {};
    },
    intent: () => () => {}, tool: () => () => {}, planStep: () => () => {}, resultType: () => () => {},
  } as unknown as Registrar;
  const mod = await createMod(services);
  await mod.activate(registrar, services);
  const run = (input: Record<string, Json>, extra: Partial<TribunalInvocationContext> = {}) =>
    command!.run({ question: 'Ship it?', rounds: '1', quiet: true, ...input }, { ...context, ...extra });
  const host: TribunalSessionHost = {
    cwd: () => context.cwd, hasSession: () => true,
    defaultEngines: () => ({ active: [...ROSTER], excluded: [] }), scanContext: () => '',
    now: () => 0, dispatch: vi.fn(), scheduleEvery: () => () => {}, checkpoint: vi.fn(),
    createScoreboard: () => ({ finish: vi.fn(), render: () => '' }),
    createRecord: () => ({ complete: vi.fn() }),
  };
  return { run, judge, host, context };
}

describe('tribunal entry points hand the run roster to the judge pool', () => {
  it('B2 explicit CLI engines allow only those two engines as judges', async () => {
    const h = await setup();
    expect(await h.run({ engines: 'alpha,beta' })).toMatchObject({ exitCode: 0 });
    expect(h.judge).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      judgePool: ['alpha', 'beta'], positions: [
        expect.objectContaining({ engineId: 'alpha' }), expect.objectContaining({ engineId: 'beta' }),
      ],
    }));
  });

  it('B2 default CLI seats four engines and allows the whole roster as judges', async () => {
    const h = await setup();
    expect(await h.run({})).toMatchObject({ exitCode: 0 });
    expect(h.judge).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      judgePool: ROSTER, positions: ROSTER.slice(0, 4).map(engineId => expect.objectContaining({ engineId })),
    }));
  });

  it.each([true, false])('B2 default session permits its full active judge roster (session=%s)', async hasSession => {
    const h = await setup();
    h.host.hasSession = () => hasSession;
    await runTribunalSession({ question: 'Ship it?' }, h.context.signal, h.host,
      (input, context) => h.run(input as Record<string, Json>, context));
    expect(h.judge).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      judgePool: ROSTER, positions: ROSTER.slice(0, 4).map(engineId => expect.objectContaining({ engineId })),
    }));
  });

  it('keeps explicit session engines instead of replacing them with the default seats', async () => {
    const h = await setup();
    await runTribunalSession({ question: 'Ship it?', engines: ['delta', 'epsilon'] }, h.context.signal, h.host,
      (input, context) => h.run(input as Record<string, Json>, context));
    expect(h.judge).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      judgePool: ['delta', 'epsilon'], positions: [
        expect.objectContaining({ engineId: 'delta' }), expect.objectContaining({ engineId: 'epsilon' }),
      ],
    }));
  });
});
