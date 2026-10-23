import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, IntentContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from './implementation.js';
import { withTribunalFixtureHost } from '../../../tests/fixtures/modular-tribunal-host.js';

const context = { invocationId: 'tribunal-test', cwd: process.cwd(), platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };

async function setup(failing = new Set<string>()) {
  const dispatch = vi.fn(async (engineId: string, prompt: string) => ({ engineId, exitCode: failing.has(engineId) ? 1 : 0, stdout: failing.has(engineId) ? '' : prompt.includes('## TASK\n') ? 'verdict' : `${engineId} argument`, stderr: failing.has(engineId) ? 'failed' : '', timedOut: false }));
  const record = vi.fn(async () => 'receipt');
  const services = { identity: { id: 'agon.tribunal', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` }, source: 'bundled', logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record }, permissions: { check: vi.fn(async () => 'allow') }, state: { read: vi.fn(), write: vi.fn() }, engines: { listActive: vi.fn(async () => ['alpha', 'beta']), dispatch } } as unknown as ModServices;
  const intents: IntentContribution[] = [];
  let command: CommandContribution | undefined; const registrar = { command: (surface: string, value: CommandContribution) => { if (surface === 'cli') command = value; return () => {}; }, intent: (value: IntentContribution) => { intents.push(value); return () => {}; }, tool: () => () => {}, planStep: () => () => {}, resultType: () => () => {} } as unknown as Registrar;
  const hosted = withTribunalFixtureHost(services);
  const mod = await createMod(hosted); await mod.activate(registrar, hosted); return { command: command!, intents, dispatch, record, services: hosted };
}

describe('physical tribunal mod', () => {
  it('publishes completion only after finalization and does not undo it on observer cancellation', async () => {
    const h = await setup();
    const controller = new AbortController();
    const finish = vi.spyOn(h.services.runs!, 'finish');
    const done = vi.fn();
    const result = await h.command.run({ question: 'Q', rounds: '1' }, {
      ...context, signal: controller.signal,
      onWorkflowEvent: (event: { type: string }) => {
        if (event.type !== 'forge:done') return;
        done();
        expect(finish).toHaveBeenCalledOnce();
        expect(h.record).toHaveBeenCalledOnce();
        controller.abort(new Error('after completion'));
      },
    } as typeof context);
    expect(result.exitCode).toBe(0);
    expect(done).toHaveBeenCalledOnce();
    expect(finish.mock.calls[0][1]).toMatchObject({ ok: true });
  });
  it('refuses a missing host without dispatch or a run record', async () => {
    const h = await setup();
    const start = vi.spyOn(h.services.runs!, 'start');
    Object.assign(h.services, { tribunal: undefined });
    expect(await h.command.run({ question: 'Q' }, context)).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('host capabilities') });
    expect(start).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('rejects a pre-aborted invocation before opening its host', async () => {
    const h = await setup();
    const open = vi.spyOn(h.services.tribunal!, 'open');
    await expect(h.command.run({ question: 'Q' }, { ...context, signal: AbortSignal.abort(new Error('already cancelled')) }))
      .rejects.toThrow('already cancelled');
    expect(open).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });

  it('keeps all-failed evidence but does not issue a success receipt', async () => {
    const h = await setup(new Set(['alpha', 'beta']));
    const finish = vi.spyOn(h.services.runs!, 'finish');
    const result = await h.command.run({ question: 'Q', rounds: '1' }, context);
    expect(result).toMatchObject({ exitCode: 1, result: { panelHealth: { responded: 0 } } });
    expect(result.stdout).toContain('AGON_SUMMARY: 0/2 succeeded; alpha: error, beta: error');
    expect(finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: false }), context);
    expect(h.record).not.toHaveBeenCalled();
  });

  it('retains arguments when the summary engine fails', async () => {
    const h = await setup();
    h.dispatch.mockImplementation(async (engineId, prompt) => ({ engineId,
      exitCode: prompt.includes('## TASK\n') ? 1 : 0,
      stdout: prompt.includes('## TASK\n') ? '' : `${engineId} argument`, stderr: 'summary unavailable', timedOut: false }));
    const result = await h.command.run({ question: 'Q', rounds: '1' }, context);
    expect(result.exitCode).toBe(0);
    expect(result.result).toMatchObject({ summary: expect.stringContaining('alpha argument') });
    expect(result.stdout).toContain('Engines that hit errors');
    expect(result.stdout).toContain('tribunal-summary');
  });

  it('does not publish success when run finalization fails', async () => {
    const h = await setup();
    vi.spyOn(h.services.runs!, 'finish').mockRejectedValue(new Error('disk unavailable'));
    await expect(h.command.run({ question: 'Q', rounds: '1' }, context)).rejects.toThrow('disk unavailable');
    expect(h.record).not.toHaveBeenCalled();
  });

  it('rejects a retired generation after a dispatch completes', async () => {
    const h = await setup();
    const session = await h.services.tribunal!.open(context);
    let retired = false;
    const assertCurrent = () => { if (retired) throw new Error('generation retired'); };
    session.assertCurrent = assertCurrent;
    session.effects.assertCurrent = assertCurrent;
    h.services.tribunal!.open = () => session;
    h.dispatch.mockImplementation(async engineId => {
      retired = true;
      return { engineId, exitCode: 0, stdout: 'late argument', stderr: '', timedOut: false };
    });
    const result = await h.command.run({ question: 'Q', protocol: 'chained' }, context);
    expect(result).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('generation retired') });
    expect(h.dispatch).toHaveBeenCalledOnce();
    expect(h.record).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps CLI run markers and human output (quiet=%s)', async quiet => {
    const h = await setup();
    const result = await h.command.run({ question: 'Q', rounds: '1', quiet }, context);
    expect(result.exitCode).toBe(0);
    const lines = result.stdout!.trim().split('\n');
    expect(lines[0]).toMatch(quiet ? /^\/.*agon-tribunal-fixture-/ : /^AGON_RUN: \/.*agon-tribunal-fixture-/);
    expect(lines.at(-1)).toBe('AGON_SUMMARY: 2/2 succeeded');
    if (quiet) expect(lines).toHaveLength(2);
    else {
      expect(result.stdout).toContain('Tribunal: Q\nEngines: alpha, beta\nRounds: 1\nMode: adversarial\nProtocol: hybrid');
      expect(result.stdout).toContain('Round 1: alpha (Argue FOR)...');
      expect(result.stdout).toContain('Verdict\n\nverdict');
      expect(result.stdout).toContain('Full debate saved: ');
    }
  });

  it('streams through the injected CLI renderer without duplicating stdout', async () => {
    const h = await setup();
    const lines: string[] = [];
    const write = (value: string) => { lines.push(value); };
    Object.assign(h.services.tribunal!, { cliOutput: {
      log: write, header: write, info: write, warn: write,
      bold: (value: string) => value, dim: (value: string) => value, red: (value: string) => value,
    } });
    h.dispatch.mockImplementation(async engineId => {
      expect(lines[0]).toMatch(/^AGON_RUN:/);
      return { engineId, exitCode: 0, stdout: 'argument', stderr: '', timedOut: false };
    });
    const result = await h.command.run({ question: 'Q', rounds: '1' }, context);
    expect(result.stdout).toBe('');
    expect(lines.filter(line => line.startsWith('AGON_RUN:'))).toHaveLength(1);
    expect(lines.at(-1)).toBe('AGON_SUMMARY: 2/2 succeeded');
  });

  it('uses the configured outside-panel judge and persists the labelled outcome', async () => {
    const h = await setup();
    const session = await h.services.tribunal!.open(context);
    session.effects.loadConfig = () => ({ cesarEngine: 'judge' });
    h.services.tribunal!.open = () => session;
    const finish = vi.spyOn(h.services.runs!, 'finish');
    const result = await h.command.run({ question: 'Q', rounds: '1', label: 'decision' }, context);
    expect(result.exitCode).toBe(0);
    expect(h.dispatch.mock.calls.map(([id]) => id)).toEqual(['alpha', 'beta', 'judge']);
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ mode: 'tribunal' }),
      expect.objectContaining({ label: 'decision', ok: true, engines: [
        { id: 'alpha', status: 'ok', detail: '1 arguments' },
        { id: 'beta', status: 'ok', detail: '1 arguments' },
      ] }), context);
  });

  it('forwards active cancellation and finalizes failure without a success receipt', async () => {
    const h = await setup();
    const controller = new AbortController();
    const invocation = { ...context, signal: controller.signal };
    const session = await h.services.tribunal!.open(invocation);
    h.services.tribunal!.open = () => session;
    const started = Promise.withResolvers<void>();
    const dispatch = vi.spyOn(session.adapter, 'dispatch').mockImplementation(async options => {
      expect(options.signal).toBe(controller.signal);
      started.resolve();
      await new Promise<void>(resolve => options.signal!.addEventListener('abort', () => resolve(), { once: true }));
      return { engineId: options.engine.id, exitCode: 0, stdout: 'late result', stderr: '', timedOut: false } as never;
    });
    const finish = vi.spyOn(h.services.runs!, 'finish');
    const pending = h.command.run({ question: 'Q', protocol: 'chained' }, invocation);
    const rejected = expect(pending).rejects.toThrow('cancel fixture');
    await started.promise;
    controller.abort(new Error('cancel fixture'));
    await rejected;
    expect(dispatch).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: false, summary: 'cancel fixture' }), invocation);
    expect(h.record).not.toHaveBeenCalled();
  });

  it.each([{ rounds: 'NaN' }, { rounds: '0' }, { rounds: '1.5' }, { timeout: 'Infinity' }])(
    'rejects invalid execution bounds before dispatch: %j', async bounds => {
      const h = await setup();
      expect(await h.command.run({ question: 'Q', ...bounds }, context)).toMatchObject({ exitCode: 1 });
      expect(h.dispatch).not.toHaveBeenCalled();
      expect(h.record).not.toHaveBeenCalled();
    });

  it.each([
    ['/tribunal socratic Q', 'socratic', 'chained'],
    ['/tribunal --mode red-team --protocol parallel Q', 'red-team', 'parallel'],
    ['/tribunal --synthesis --protocol chained Q', 'synthesis', 'chained'],
    ['/tribunal Q', 'adversarial', 'hybrid'],
  ])('executes parsed mode and protocol for %s', async (input, mode, protocol) => {
    const h = await setup();
    expect(h.intents).toHaveLength(2);
    for (const intent of h.intents) {
      const parsed = await intent.parse(input);
      expect(parsed).toBeDefined();
      const output = await intent.run(parsed!, context);
      expect(JSON.parse((output as { stdout: string }).stdout)).toMatchObject({ question: 'Q', mode, protocol });
    }
  });

  it.each([
    { mode: 'adversarial', roles: ['Argue FOR', 'Argue AGAINST', "Play devil's advocate", 'Perspective 4: Find unconventional angles'], instruction: 'Counter opposing arguments directly.', summary: '**Verdict**' },
    { mode: 'socratic', roles: ['Questioner', 'Responder', 'Observer', 'Observer'], instruction: 'Do NOT answer', summary: '**Unresolved assumptions**' },
    { mode: 'red-team', roles: ['Defender', 'Attacker 1', 'Attacker 2', 'Attacker 3'], instruction: 'defend against their critiques', summary: '| Risk | Severity |' },
    { mode: 'steelman', roles: ['Advocate', 'Steelman opponent', 'Judge', 'Participant 4'], instruction: 'STRONGEST possible case', summary: '**The crux**' },
    { mode: 'synthesis', roles: ['Proposer A', 'Proposer B', 'Synthesizer', 'Synthesizer'], instruction: 'propose your complete solution', summary: '| Aspect | Proposal A |' },
    { mode: 'postmortem', roles: ['Timeline analyst', 'Root-cause investigator', 'Prevention designer', 'Participant 4'], instruction: 'Reconstruct a timeline', summary: '**Detection gap**' },
  ])('uses canonical $mode roles and prompts', async ({ mode, roles, instruction, summary }) => {
    const h = await setup();
    const result = await h.command.run({ question: 'Ship it?', rounds: '1', engines: 'a,b,c,d', mode }, context);
    const parsed = (result as { result: any }).result;
    expect(parsed.positions.map((position: { position: string }) => position.position)).toEqual(roles);
    expect(h.dispatch.mock.calls[0][1]).toContain(instruction);
    expect(h.dispatch.mock.calls.at(-1)?.[1]).toContain(summary);
  });

  it('uses investigator roles for a two-engine postmortem', async () => {
    const h = await setup();
    const result = await h.command.run({ question: 'Incident?', rounds: '1', mode: 'postmortem' }, context);
    const parsed = (result as { result: any }).result;
    expect(parsed.positions.map((position: { position: string }) => position.position))
      .toEqual(['Investigator', 'Prevention designer']);
    expect(h.dispatch.mock.calls[0][1]).toContain('Investigate the incident');
    expect(h.dispatch.mock.calls[0][1]).not.toContain('Design prevention measures');
    expect(h.dispatch.mock.calls[1][1]).toContain('Design prevention measures');
  });

  it.each([
    { mode: 'socratic', instructions: ['Do NOT answer', 'Answer each question directly', 'As an observer', 'As an observer'] },
    { mode: 'red-team', instructions: ['Present the proposal/plan', 'Attack the proposal', 'Attack the proposal', 'Attack the proposal'] },
    { mode: 'steelman', instructions: ['case for the proposal', 'case AGAINST', 'As judge', 'As judge'] },
    { mode: 'postmortem', instructions: ['Reconstruct a timeline', 'Dig past the symptoms', 'Design prevention measures', 'Design prevention measures'] },
  ])('dispatches role-specific instructions to every $mode participant', async ({ mode, instructions }) => {
    const h = await setup();
    await h.command.run({ question: 'Q', mode, rounds: '1', engines: 'a,b,c,d' }, context);
    for (const [index, instruction] of instructions.entries()) {
      expect(h.dispatch.mock.calls[index][0]).toBe(['a', 'b', 'c', 'd'][index]);
      expect(h.dispatch.mock.calls[index][1]).toContain(instruction);
    }
  });

  it.each(['parallel', 'chained', 'hybrid'])('enforces pending-response scheduling for %s', async protocol => {
    const h = await setup();
    const gates = Array.from({ length: 4 }, () => Promise.withResolvers<string>());
    const started = Array.from({ length: 4 }, () => Promise.withResolvers<void>());
    let participants = 0;
    h.dispatch.mockImplementation(async (engineId, prompt) => {
      if (prompt.includes('## TASK\n')) return { engineId, exitCode: 0, stdout: 'verdict', stderr: '', timedOut: false };
      const index = participants++;
      started[index].resolve();
      return { engineId, exitCode: 0, stdout: await gates[index].promise, stderr: '', timedOut: false };
    });
    const running = h.command.run({ question: 'Q', protocol, rounds: '2' }, context);
    try {
      for (let round = 0; round < 2; round++) {
        const first = round * 2;
        await started[first].promise;
        const parallel = protocol === 'parallel' || (protocol === 'hybrid' && round === 0);
        if (parallel) {
          await started[first + 1].promise;
          expect(participants).toBe(first + 2);
          gates[first + 1].resolve(`second ${round}`);
          await new Promise<void>(resolve => setImmediate(resolve));
          expect(participants).toBe(first + 2);
          expect(h.dispatch).toHaveBeenCalledTimes(first + 2);
          gates[first].resolve(`first ${round}`);
        } else {
          await new Promise<void>(resolve => setImmediate(resolve));
          expect(participants).toBe(first + 1);
          gates[first].resolve(`first ${round}`);
          await started[first + 1].promise;
          expect(h.dispatch.mock.calls[first + 1][1]).toContain(`**alpha (Argue FOR):**\nfirst ${round}`);
          gates[first + 1].resolve(`second ${round}`);
        }
      }
      const result = await running;
      expect(result).toMatchObject({ exitCode: 0 });
      expect(h.dispatch).toHaveBeenCalledTimes(5);
    } finally {
      for (const gate of gates) gate.resolve('cleanup');
      await running;
    }
  });

  it.each(['parallel', 'chained', 'hybrid'])('keeps round context separate with %s execution', async protocol => {
    const h = await setup();
    let sequence = 0;
    h.dispatch.mockImplementation(async (engineId, prompt) => ({ engineId, exitCode: 0,
      stdout: prompt.includes('## TASK\n') ? 'verdict' : `${engineId} argument ${++sequence}`,
      stderr: '', timedOut: false }));
    await h.command.run({ question: 'Combine?', mode: 'synthesis', protocol, rounds: '2' }, context);
    const prompts = h.dispatch.mock.calls.map(([, prompt]) => prompt);
    expect(prompts).toHaveLength(5);
    expect(prompts[0]).not.toContain('## PREVIOUS ARGUMENTS');
    expect(prompts[0]).not.toContain('## EARLIER ARGUMENTS THIS ROUND');
    expect(prompts[1].includes('## EARLIER ARGUMENTS THIS ROUND')).toBe(protocol === 'chained');
    expect(prompts[2]).toContain('## PREVIOUS ARGUMENTS\n**alpha (Proposer A):**\nalpha argument 1\n\n---\n\n**beta (Proposer B):**\nbeta argument 2');
    expect(prompts[2]).not.toContain('## EARLIER ARGUMENTS THIS ROUND');
    expect(prompts[2]).toContain('create a hybrid');
    expect(prompts[3].includes('## EARLIER ARGUMENTS THIS ROUND')).toBe(protocol !== 'parallel');
    if (protocol !== 'parallel') expect(prompts[3]).toContain('**alpha (Proposer A):**\nalpha argument 3');
    expect(prompts[4]).toContain('alpha argument 1\n\nalpha argument 3');
    expect(prompts[4]).toContain('beta argument 2\n\nbeta argument 4');
  });

  it.each([
    { mode: 'adversarial', cap: 3, protocol: 'hybrid' },
    { mode: 'socratic', cap: 3, protocol: 'chained' },
    { mode: 'red-team', cap: 2, protocol: 'hybrid' },
    { mode: 'steelman', cap: 2, protocol: 'chained' },
    { mode: 'synthesis', cap: 2, protocol: 'parallel' },
    { mode: 'postmortem', cap: 2, protocol: 'chained' },
  ].flatMap(item => [false, true].map(explicitAuto => ({ ...item, explicitAuto }))))(
    'caps $mode rounds and selects its protocol (explicit auto=$explicitAuto)',
    async ({ mode, cap, protocol, explicitAuto }) => {
      const h = await setup();
      const output = await h.command.run({ question: 'Q', mode, rounds: '99', ...(explicitAuto ? { protocol: 'auto' } : {}) }, context);
      const result = output.result as any;
      expect(result.protocol).toBe(protocol);
      expect(result.rounds).toHaveLength(cap);
      expect(h.dispatch).toHaveBeenCalledTimes(cap * 2 + 1);
      for (let round = 1; round <= cap; round++) {
        const [first, second] = h.dispatch.mock.calls.slice((round - 1) * 2, round * 2).map(([, prompt]) => prompt);
        expect(first).toContain(`## ROUND\n${round} of ${cap}`);
        expect(second).toContain(`## ROUND\n${round} of ${cap}`);
        expect(first).not.toContain('## EARLIER ARGUMENTS THIS ROUND');
        expect(second.includes('## EARLIER ARGUMENTS THIS ROUND')).toBe(protocol === 'chained' || (protocol === 'hybrid' && round > 1));
      }
      expect(h.record).toHaveBeenCalledWith('tribunal', { mode, protocol, rounds: cap, engines: 2, failures: 0 });
    });

  it('runs the configured rounds and synthesizes a verdict', async () => {
    const h = await setup(); const result = await h.command.run({ question: 'Ship it?', rounds: '2', protocol: 'parallel' }, context); const parsed = (result as { result: any }).result;
    expect(parsed).toMatchObject({ mode: 'adversarial', protocol: 'parallel', summary: 'verdict', panelHealth: { requested: 4, responded: 4, degraded: false } });
    expect(parsed.rounds).toHaveLength(2); expect(h.dispatch).toHaveBeenCalledTimes(5); expect(h.record).toHaveBeenCalled();
  });
  it('rejects invalid modes and too-small panels before dispatch', async () => {
    const h = await setup(); await expect(h.command.run({ question: 'Q', mode: 'magic' }, context)).resolves.toMatchObject({ exitCode: 1 }); expect(h.dispatch).not.toHaveBeenCalled();
  });
  it('preserves partial evidence and marks a degraded panel', async () => {
    const h = await setup(new Set(['beta'])); const result = await h.command.run({ question: 'Q', rounds: '1' }, context); const parsed = (result as { result: any }).result;
    expect(parsed.panelHealth).toMatchObject({ requested: 2, responded: 1, degraded: true }); expect(parsed.panelHealth.notes.join(' ')).toContain('beta');
  });
});
