import { afterEach, expect, it, vi } from 'vitest';
import { createAgentReviewStepExecutors } from '../../packages/mod-plan/src/agent-review-step-execution.js';
import type { PlanAgentReviewHost, PlanAgentReviewStepType } from '../../packages/mod-plan/src/agent-review-step-execution.js';
import type { CesarPlanStep } from '../../packages/mod-plan/src/execution-model.js';

function host(): PlanAgentReviewHost {
  return {
    assertAvailable: vi.fn(),
    snapshot: vi.fn().mockReturnValueOnce({ tokens: 10, cost: 1 }).mockReturnValue({ tokens: 25, cost: 1.5 }),
    reviewTarget: vi.fn(() => ({ diff: 'patch', label: 'changes' })),
    selectReviewEngine: vi.fn(() => 'selected'),
    review: vi.fn().mockResolvedValue({ response: 'approved', blocking: false, parseFailed: false }),
    agent: vi.fn().mockResolvedValue({ status: 'completed' }), teamAgent: vi.fn().mockResolvedValue({ status: 'completed' }),
  };
}
function step(type: PlanAgentReviewStepType): CesarPlanStep {
  return { id: 's', type, description: 'task', imports: ['facts'], engine: 'chosen', engines: ['one', 'two'], fitnessCmd: 'test-command', estimatedTokens: 1, estimatedCostUsd: 0 };
}
afterEach(() => vi.restoreAllMocks());

it.each((['agent', 'team-agent'] as const).flatMap(kind =>
  ['missing', 'failed', 'cancelled', 'budget_exceeded', 'no-winner', 'completed'].map(status => ({ kind, status })),
))('retains the backend outcome for $kind/$status', async ({ kind, status }) => {
  const effects = host();
  const backend = kind === 'agent' ? effects.agent : effects.teamAgent;
  vi.mocked(backend).mockImplementation(async (_task, emit) => {
    emit({ message: `observed ${status}` });
    return status === 'missing' ? undefined : { status, summary: `backend ${status}` };
  });
  const result = await createAgentReviewStepExecutors(effects)[kind].execute(step(kind), {});
  expect(result.result).toMatchObject({ status: status === 'completed' ? 'success' : 'failure',
    output: `observed ${status}`, actualTokens: 15, actualCostUsd: 0.5 });
  if (status !== 'completed') {
    expect(result).not.toHaveProperty('contextExport');
    expect(result.result.error).toBe(status === 'missing'
      ? `${kind === 'agent' ? 'Agent' : 'Team-agent'} step did not complete (no result)`
      : `backend ${status}`);
  }
});

it.each(['review', 'agent', 'team-agent'] as const)('refuses an aborted %s before host effects', async kind => {
  const effects = host();
  const signal = AbortSignal.abort(new Error('cancelled'));
  await expect(createAgentReviewStepExecutors(effects)[kind].execute(step(kind), {}, signal)).rejects.toThrow('cancelled');
  for (const key of ['snapshot', 'reviewTarget', 'selectReviewEngine', 'review', 'agent', 'teamAgent'] as const) {
    expect(effects[key]).not.toHaveBeenCalled();
  }
});

it.each(['review', 'agent', 'team-agent'] as const)('refuses stale %s completion with measured usage', async kind => {
  for (const fault of ['disabled', 'cancelled']) {
    const effects = host();
    const controller = new AbortController();
    let available = true;
    effects.assertAvailable = vi.fn(() => { if (!available) throw new Error('disabled'); });
    const revoke = () => { if (fault === 'disabled') available = false; else controller.abort(new Error('cancelled')); };
    effects.review = vi.fn(async () => { revoke(); return { response: 'approved', blocking: false, parseFailed: false }; });
    effects.agent = vi.fn(async () => { revoke(); return { status: 'completed' }; });
    effects.teamAgent = vi.fn(async () => { revoke(); return { status: 'completed' }; });
    const output = await createAgentReviewStepExecutors(effects)[kind].execute(step(kind), {}, controller.signal);
    expect(output.result).toMatchObject({ status: 'failure', actualTokens: 15, actualCostUsd: 0.5, error: fault });
    expect(output).not.toHaveProperty('contextExport');
  }
});

it.each(['review', 'agent', 'team-agent'] as const)('refuses %s before any host effect', async kind => {
  const effects = host();
  effects.assertAvailable = vi.fn(() => { throw new Error('disabled'); });
  await expect(createAgentReviewStepExecutors(effects)[kind].execute(step(kind), {})).rejects.toThrow('disabled');
  for (const key of ['snapshot', 'reviewTarget', 'selectReviewEngine', 'review', 'agent', 'teamAgent'] as const) {
    expect(effects[key]).not.toHaveBeenCalled();
  }
});

it('binds authority to the handler, not the supplied step kind', async () => {
  const effects = host();
  await createAgentReviewStepExecutors(effects).review.execute(step('agent'), {});
  expect(vi.mocked(effects.assertAvailable).mock.calls).toEqual([['review', undefined], ['review', undefined]]);
});

it('refuses an empty review diff without selecting or calling an engine', async () => {
  const effects = host();
  effects.reviewTarget = vi.fn(() => ({ diff: ' \n ', label: 'empty' }));
  const output = await createAgentReviewStepExecutors(effects).review.execute(step('review'), {});
  expect(output.result).toMatchObject({ status: 'failure', error: 'no diff to review' });
  expect(effects.selectReviewEngine).not.toHaveBeenCalled();
  expect(effects.review).not.toHaveBeenCalled();
});

it.each([
  { blocking: false, parseFailed: false, status: 'success', error: undefined, prefix: 'Review approved: ' },
  { blocking: true, parseFailed: false, status: 'failure', error: 'blocking issues found', prefix: 'Review blocked: ' },
  { blocking: false, parseFailed: true, status: 'failure', error: 'review parse failed (fail-closed)', prefix: 'Review unparseable: ' },
  { blocking: true, parseFailed: true, status: 'failure', error: 'review parse failed (fail-closed)', prefix: 'Review unparseable: ' },
])('preserves review verdict $blocking/$parseFailed', async value => {
  const effects = host();
  vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValue(140);
  vi.mocked(effects.review).mockResolvedValue({ response: 'r'.repeat(2200), blocking: value.blocking, parseFailed: value.parseFailed });
  const signal = new AbortController().signal;
  const output = await createAgentReviewStepExecutors(effects).review.execute(step('review'), { __plan_intent: 'i'.repeat(220) }, signal);
  expect(effects.selectReviewEngine).toHaveBeenCalledExactlyOnceWith('chosen');
  expect(effects.review).toHaveBeenCalledExactlyOnceWith('patch', `changes (verifying intent: ${'i'.repeat(200)})`, 'selected', signal);
  expect(output).toEqual({ result: { status: value.status, output: 'r'.repeat(2000), actualTokens: 15, actualCostUsd: 0.5, durationMs: 40,
    ...(value.error ? { error: value.error } : {}) }, contextExport: value.prefix + 'r'.repeat(300) });
});

it.each(['agent', 'team-agent'] as const)('threads %s options and keeps the parent signal', async kind => {
  const effects = host();
  const backend = kind === 'agent' ? effects.agent : effects.teamAgent;
  const signal = new AbortController().signal;
  await createAgentReviewStepExecutors(effects)[kind].execute(step(kind), { facts: 'context' }, signal);
  expect(backend).toHaveBeenCalledExactlyOnceWith('task\n\n## facts\ncontext', expect.any(Function), kind === 'agent'
    ? { engineId: 'chosen', parentSignal: signal }
    : { engines: ['one', 'two'], fitnessCmd: 'test-command', parentSignal: signal });
});

it.each(['agent', 'team-agent'] as const)('captures %s output with message precedence and bounded exports', async kind => {
  const effects = host();
  const backend = kind === 'agent' ? effects.agent : effects.teamAgent;
  vi.mocked(backend).mockImplementation(async (_task, emit) => {
    emit(null); emit('ignored'); emit({ message: 10 });
    for (let i = 0; i < 25; i++) emit({ message: `m${i}${'x'.repeat(130)}`, content: 'ignored' });
    emit({ content: 'content' });
    return { status: 'completed' };
  });
  const output = await createAgentReviewStepExecutors(effects)[kind].execute(step(kind), {});
  const expected = [...Array.from({ length: 19 }, (_, i) => `m${i + 6}${'x'.repeat(130)}`), 'content'].join('\n').slice(0, 2000);
  expect(output.result.status).toBe('success');
  expect(output.result.output).toBe(expected);
  expect(output.contextExport).toBe(expected.slice(0, 500));
});

it.each(['agent', 'team-agent'] as const)('preserves %s failure output from the last ten events', async kind => {
  const effects = host();
  const backend = kind === 'agent' ? effects.agent : effects.teamAgent;
  vi.mocked(backend).mockImplementation(async (_task, emit) => {
    for (let i = 0; i < 15; i++) emit({ content: `event-${i}` });
    throw new Error('failed');
  });
  const output = await createAgentReviewStepExecutors(effects)[kind].execute(step(kind), {});
  expect(output.result).toMatchObject({ status: 'failure', error: 'failed', actualTokens: 15, actualCostUsd: 0.5,
    output: Array.from({ length: 10 }, (_, i) => `event-${i + 5}`).join('\n') });
  expect(output).not.toHaveProperty('contextExport');
});

it.each(['agent', 'team-agent'] as const)('preserves the empty %s completion message', async kind => {
  const output = await createAgentReviewStepExecutors(host())[kind].execute(step(kind), {});
  expect(output.result.output).toBe(`${kind === 'agent' ? 'Agent' : 'Team-agent'} step completed (15 tokens)`);
  expect(output.contextExport).toBe('');
});
