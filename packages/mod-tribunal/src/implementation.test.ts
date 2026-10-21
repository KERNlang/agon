import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, IntentContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from './implementation.js';

const context = { invocationId: 'tribunal-test', cwd: process.cwd(), platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };

async function setup(failing = new Set<string>()) {
  const dispatch = vi.fn(async (engineId: string, prompt: string) => ({ engineId, exitCode: failing.has(engineId) ? 1 : 0, stdout: failing.has(engineId) ? '' : prompt.includes('## TASK\n') ? 'verdict' : `${engineId} argument`, stderr: failing.has(engineId) ? 'failed' : '', timedOut: false }));
  const record = vi.fn(async () => 'receipt');
  const services = { identity: { id: 'agon.tribunal', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` }, source: 'bundled', logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record }, permissions: { check: vi.fn(async () => 'allow') }, state: { read: vi.fn(), write: vi.fn() }, engines: { listActive: vi.fn(async () => ['alpha', 'beta']), dispatch } } as unknown as ModServices;
  const intents: IntentContribution[] = [];
  let command: CommandContribution | undefined; const registrar = { command: (surface: string, value: CommandContribution) => { if (surface === 'cli') command = value; return () => {}; }, intent: (value: IntentContribution) => { intents.push(value); return () => {}; }, tool: () => () => {}, planStep: () => () => {}, resultType: () => () => {} } as unknown as Registrar;
  const mod = await createMod(services); await mod.activate(registrar, services); return { command: command!, intents, dispatch, record };
}

describe('physical tribunal mod', () => {
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
    const parsed = JSON.parse((result as { stdout: string }).stdout);
    expect(parsed.positions.map((position: { position: string }) => position.position)).toEqual(roles);
    expect(h.dispatch.mock.calls[0][1]).toContain(instruction);
    expect(h.dispatch.mock.calls.at(-1)?.[1]).toContain(summary);
  });

  it('uses investigator roles for a two-engine postmortem', async () => {
    const h = await setup();
    const result = await h.command.run({ question: 'Incident?', rounds: '1', mode: 'postmortem' }, context);
    const parsed = JSON.parse((result as { stdout: string }).stdout);
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
          expect(h.dispatch.mock.calls[first + 1][1]).toContain(`alpha: first ${round}`);
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
    expect(prompts[2]).toContain('## PREVIOUS ARGUMENTS\nalpha (Proposer A): alpha argument 1\n\nbeta (Proposer B): beta argument 2');
    expect(prompts[2]).not.toContain('## EARLIER ARGUMENTS THIS ROUND');
    expect(prompts[2]).toContain('create a hybrid');
    expect(prompts[3].includes('## EARLIER ARGUMENTS THIS ROUND')).toBe(protocol !== 'parallel');
    if (protocol !== 'parallel') expect(prompts[3]).toContain('alpha: alpha argument 3');
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
      const result = JSON.parse((output as { stdout: string }).stdout);
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
