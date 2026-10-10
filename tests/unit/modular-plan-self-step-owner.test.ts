import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSelfStepExecutor } from '../../packages/mod-plan/src/self-step-execution.js';
import type { PlanSelfStepHost } from '../../packages/mod-plan/src/self-step-execution.js';
import type { CesarPlanStep } from '../../packages/mod-plan/src/execution-model.js';

const step: CesarPlanStep = { id: 's', type: 'self', description: 'task', imports: ['facts'], estimatedTokens: 0, estimatedCostUsd: 0 };
function fixture(live = true) {
  const dispatch = vi.fn();
  const host: PlanSelfStepHost = {
    cwd: '/fixture', outputDir: '/fixture/runs', assertAvailable: vi.fn(),
    snapshot: vi.fn().mockReturnValueOnce({ tokens: 10, cost: 1 }).mockReturnValue({ tokens: 25, cost: 1.5 }),
    getDispatch: vi.fn(() => live ? dispatch : undefined),
    brain: vi.fn().mockResolvedValue({}),
    verify: vi.fn().mockResolvedValue({ exitCode: 0, timedOut: false, stdout: '', stderr: '' }),
    delegate: vi.fn().mockResolvedValue({ response: 'fallback answer' }),
  };
  return { host, dispatch };
}
afterEach(() => vi.restoreAllMocks());

it('keeps the Self algorithm in its physical owner', () => {
  const cli = readFileSync(new URL('../../packages/cli/src/handlers/plan-mode.ts', import.meta.url), 'utf8');
  expect(cli).toContain('createSelfStepExecutor<');
  expect(cli).not.toContain('[APPROVED PLAN STEP]');
  expect(cli).not.toContain('[EXECUTOR OVERRIDE]');
  const owner = readFileSync(new URL('../../packages/mod-plan/src/self-step-execution.ts', import.meta.url), 'utf8');
  expect(owner).not.toMatch(/from ['"](?:@kernlang\/agon-(?:core|cli|forge)|\.\.\/)/);
});

it.each(['failed', 'timed_out', 'cancelled', 'superseded'] as const)('does not turn a %s brain outcome into success', async terminalState => {
  const { host } = fixture();
  vi.mocked(host.brain).mockResolvedValue({ terminalState, decisionReason: 'backend stopped' });
  const result = await createSelfStepExecutor(host).execute({ ...step, verifyCmd: 'must-not-run' }, {});
  expect(result.result.status).toBe('failure');
  expect(result.result.error).toContain(terminalState);
  expect(result).not.toHaveProperty('contextExport');
  expect(host.verify).not.toHaveBeenCalled();
});

it('retains streamed receipts and usage when the brain throws', async () => {
  const { host } = fixture();
  vi.mocked(host.brain).mockImplementation(async (_prompt, emit) => {
    emit({ type: 'streaming-chunk', chunk: 'partial answer' });
    emit({ type: 'tool-call', tool: 'Read', status: 'done' });
    throw new Error('owner lost');
  });
  const result = await createSelfStepExecutor(host).execute(step, {});
  expect(result.result).toMatchObject({ status: 'failure', actualTokens: 15, actualCostUsd: 0.5,
    output: 'partial answer\n[tool:Read:done]', error: 'owner lost' });
});

it.each(['disabled', 'cancelled'].flatMap(change => ['tool-call', 'tool-stream-end'].flatMap(type =>
  ['done', 'error'].map(status => ({ change, type, status })),
)))('retains $type/$status receipts after $change without publishing new UI output', async ({ change, type, status }) => {
  const { host, dispatch } = fixture();
  const controller = new AbortController();
  let disabled = false;
  host.assertAvailable = () => { if (disabled) throw new Error('self disabled'); };
  vi.mocked(host.brain).mockImplementation(async (_prompt, emit) => {
    if (change === 'disabled') disabled = true;
    else controller.abort();
    emit({ type, tool: 'Write', status });
    return {};
  });
  const result = await createSelfStepExecutor(host).execute(step, {}, controller.signal);
  expect(result.result).toMatchObject({ status: 'failure', output: `[tool:Write:${status === 'done' ? 'done' : 'failed'}]`, actualTokens: 15, actualCostUsd: 0.5 });
  expect(dispatch).not.toHaveBeenCalled();
  expect(result).not.toHaveProperty('contextExport');
});

it.each(['delegate', 'verify'])('rechecks the separate Delegate owner after %s returns', async boundary => {
  const { host } = fixture(false);
  let delegateAvailable = true;
  host.assertAvailable = vi.fn(kind => {
    if (kind === 'delegate' && !delegateAvailable) throw new Error('delegate disabled');
  });
  if (boundary === 'delegate') vi.mocked(host.delegate).mockImplementation(async () => {
    delegateAvailable = false;
    return { response: 'completed delegation' };
  });
  else vi.mocked(host.verify).mockImplementation(async () => {
    delegateAvailable = false;
    return { exitCode: 0, timedOut: false };
  });
  const result = await createSelfStepExecutor(host).execute({ ...step, verifyCmd: 'check' }, {});
  expect(result.result).toMatchObject({ status: 'failure', error: 'delegate disabled' });
  expect(result).not.toHaveProperty('contextExport');
  expect(host.verify).toHaveBeenCalledTimes(boundary === 'delegate' ? 0 : 1);
  expect(result.result.output).toBe(boundary === 'delegate' ? 'completed delegation' : 'fallback answer');
});

it.each([true, false])('refuses verification after work loses authority (live=%s)', async live => {
  for (const verifyCmd of [undefined, 'must-not-run']) {
    for (const fault of ['disabled', 'cancelled']) {
      const { host } = fixture(live);
      const controller = new AbortController();
      let available = true;
      host.assertAvailable = vi.fn(() => { if (!available) throw new Error('self disabled'); });
      const revoke = () => {
        if (fault === 'disabled') available = false;
        else controller.abort(new Error('cancelled'));
      };
      vi.mocked(host.brain).mockImplementation(async () => { revoke(); return {}; });
      vi.mocked(host.delegate).mockImplementation(async () => { revoke(); return { response: 'done' }; });
      const result = await createSelfStepExecutor(host).execute({ ...step, verifyCmd }, {}, controller.signal);
      expect(result.result.status, `${fault}/${verifyCmd}`).toBe('failure');
      expect(result.result.error).toMatch(/disabled|cancelled/);
      expect(result).not.toHaveProperty('contextExport');
      expect(host.verify).not.toHaveBeenCalled();
    }
  }
});

it.each([true, false])('refuses success after verification loses authority (live=%s)', async live => {
  for (const fault of ['disabled', 'cancelled']) {
    const { host } = fixture(live);
    const controller = new AbortController();
    let available = true;
    host.assertAvailable = vi.fn(() => { if (!available) throw new Error('self disabled'); });
    vi.mocked(host.verify).mockImplementation(async () => {
      if (fault === 'disabled') available = false;
      else controller.abort(new Error('cancelled'));
      return { exitCode: 0, timedOut: false };
    });
    const result = await createSelfStepExecutor(host).execute({ ...step, verifyCmd: 'check' }, {}, controller.signal);
    expect(result.result.status, fault).toBe('failure');
    expect(result).not.toHaveProperty('contextExport');
    expect(host.verify).toHaveBeenCalledOnce();
  }
});

it('refuses the retry after its warning callback revokes authority', async () => {
  const { host, dispatch } = fixture();
  let available = true;
  host.assertAvailable = vi.fn(() => { if (!available) throw new Error('self disabled'); });
  vi.mocked(host.brain).mockResolvedValue({ awaitingUserInput: true });
  dispatch.mockImplementation(() => { available = false; });
  const result = await createSelfStepExecutor(host).execute({ ...step, verifyCmd: 'check' }, {});
  expect(result.result).toMatchObject({ status: 'failure', error: 'self disabled' });
  expect(host.brain).toHaveBeenCalledOnce();
  expect(host.verify).not.toHaveBeenCalled();
});

it('refuses Self before reading UI state or invoking effects', async () => {
  const { host } = fixture();
  host.assertAvailable = vi.fn(() => { throw new Error('unavailable'); });
  await expect(createSelfStepExecutor(host).execute(step, {})).rejects.toThrow('unavailable');
  for (const key of ['snapshot', 'getDispatch', 'brain', 'verify', 'delegate'] as const) expect(host[key]).not.toHaveBeenCalled();
});

it('streams unchanged events and captures only completion evidence', async () => {
  const { host, dispatch } = fixture();
  const events = [{ type: 'engine-block', content: 'answer' }, { type: 'streaming-chunk', chunk: 'chunk' },
    { type: 'tool-call', tool: 'Read', status: 'done' }, { type: 'tool-call', tool: 'Write', status: 'error' },
    { type: 'tool-call', tool: 'Bash', status: 'running' }, { type: 'info', message: 'not output' }];
  vi.mocked(host.brain).mockImplementation(async (prompt, emit) => {
    expect(prompt).toContain('[APPROVED PLAN STEP]');
    expect(prompt).toContain('Step s: task\n\n## facts\ncontext');
    for (const event of events) emit(event);
    return {};
  });
  vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValue(140);
  const result = await createSelfStepExecutor(host).execute(step, { facts: 'context' });
  expect(dispatch.mock.calls.map(([event]) => event)).toEqual(events);
  events.forEach((event, i) => expect(dispatch.mock.calls[i][0]).toBe(event));
  const output = 'answer\nchunk\n[tool:Read:done]\n[tool:Write:failed]';
  expect(result).toEqual({ result: { status: 'success', actualTokens: 15, actualCostUsd: 0.5, durationMs: 40, output }, contextExport: output });
  expect(host.delegate).not.toHaveBeenCalled();
  expect(host.verify).not.toHaveBeenCalled();
});

it('checks Delegate authority before the non-UI fallback', async () => {
  const { host } = fixture(false);
  host.assertAvailable = vi.fn(kind => { if (kind === 'delegate') throw new Error('agent disabled'); });
  const result = await createSelfStepExecutor(host).execute(step, {});
  expect(result.result).toMatchObject({ status: 'failure', error: 'agent disabled' });
  expect(host.assertAvailable).toHaveBeenNthCalledWith(1, 'self', undefined);
  expect(host.assertAvailable).toHaveBeenNthCalledWith(2, 'delegate', undefined);
  expect(host.delegate).not.toHaveBeenCalled();
  expect(host.verify).not.toHaveBeenCalled();
});

it('preserves fallback engine, task, timeout, output directory, and signal', async () => {
  const { host } = fixture(false);
  const signal = new AbortController().signal;
  const result = await createSelfStepExecutor(host).execute(step, {}, signal);
  expect(host.delegate).toHaveBeenCalledExactlyOnceWith({ engineId: 'claude', task: 'Analyze and respond:\ntask', timeout: 180, outputDir: '/fixture/runs/s', signal });
  expect(result.contextExport).toBe('fallback answer');
});

it.each([true, false])('gates completion on the real verification exit (live=%s)', async live => {
  const { host } = fixture(live);
  vi.mocked(host.verify).mockResolvedValue({ exitCode: 3, timedOut: false, stdout: 'bad test', stderr: 'details' });
  const signal = new AbortController().signal;
  const result = await createSelfStepExecutor(host).execute({ ...step, verifyCmd: 'test-command' }, {}, signal);
  expect(host.verify).toHaveBeenCalledExactlyOnceWith({ command: 'bash', args: ['-lc', 'test-command'], cwd: '/fixture', timeout: 600000, signal });
  expect(result.result).toMatchObject({ status: 'failure', error: 'verify failed (exit 3): test-command\nbad test\ndetails' });
  expect(result).not.toHaveProperty('contextExport');
});

it('refuses a timed-out verification even with exit zero and bounds its diagnostics', async () => {
  const { host } = fixture();
  vi.mocked(host.verify).mockResolvedValue({ exitCode: 0, timedOut: true, stdout: Array.from({ length: 30 }, (_, i) => `line-${i}`).join('\n'), stderr: 'last' });
  const result = await createSelfStepExecutor(host).execute({ ...step, verifyCmd: 'check' }, {});
  expect(result.result.status).toBe('failure');
  expect(result.result.error).toBe(`verify failed (exit 0, timed out): check\n${Array.from({ length: 19 }, (_, i) => `line-${i + 11}`).join('\n')}\nlast`);
});

it('retries awaiting input once, then pauses with the retry question', async () => {
  const { host, dispatch } = fixture();
  vi.mocked(host.brain).mockImplementationOnce(async (_prompt, emit) => { emit({ type: 'engine-block', content: 'old question' }); return { awaitingUserInput: true }; })
    .mockImplementationOnce(async (prompt, emit) => { expect(prompt).toContain('[EXECUTOR OVERRIDE]'); emit({ type: 'engine-block', content: 'new question' }); return { awaitingUserInput: true }; });
  const result = await createSelfStepExecutor(host).execute({ ...step, verifyCmd: 'check' }, {});
  expect(host.brain).toHaveBeenCalledTimes(2);
  expect(result.result).toMatchObject({ status: 'paused', output: 'old question\nnew question' });
  const last = dispatch.mock.calls.at(-1)?.[0];
  expect(last.message).toContain('new question');
  expect(last.message).not.toContain('old question');
  expect(host.verify).not.toHaveBeenCalled();
});

it('continues after the single retry succeeds', async () => {
  const { host } = fixture();
  vi.mocked(host.brain).mockResolvedValueOnce({ awaitingUserInput: true }).mockResolvedValueOnce({});
  const result = await createSelfStepExecutor(host).execute({ ...step, verifyCmd: 'check' }, {});
  expect(result.result.status).toBe('success');
  expect(host.brain).toHaveBeenCalledTimes(2);
  expect(host.verify).toHaveBeenCalledOnce();
});

it('does not retry or verify after cancellation during the brain turn', async () => {
  const { host } = fixture();
  const controller = new AbortController();
  vi.mocked(host.brain).mockImplementation(async () => { controller.abort(); return { awaitingUserInput: true }; });
  const result = await createSelfStepExecutor(host).execute({ ...step, verifyCmd: 'check' }, {}, controller.signal);
  expect(result.result).toMatchObject({ status: 'failure', error: 'cancelled' });
  expect(host.brain).toHaveBeenCalledOnce();
  expect(host.verify).not.toHaveBeenCalled();
});

it('does not verify a brain-reported abort', async () => {
  const { host } = fixture();
  vi.mocked(host.brain).mockResolvedValue({ decisionReason: 'aborted' });
  const result = await createSelfStepExecutor(host).execute({ ...step, verifyCmd: 'check' }, {});
  expect(result.result).toMatchObject({ status: 'failure', error: 'cancelled' });
  expect(host.verify).not.toHaveBeenCalled();
});
