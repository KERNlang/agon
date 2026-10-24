import { expect, it, vi } from 'vitest';
import { runTribunalSession } from './session-workflow.js';
import type { TribunalSessionHost, TribunalSessionContext } from './session-workflow.js';
import type { TribunalResult } from './runtime.js';

const result: TribunalResult = { question: 'question', mode: 'red-team', protocol: 'parallel', summary: 'verdict',
  positions: [], rounds: [{ round: 1, positions: [{ engineId: 'alpha', position: 'critic', arguments: ['evidence'] }] }] };
function fixture() {
  const complete = vi.fn();
  const stop = vi.fn();
  const host: TribunalSessionHost = {
    cwd: () => '/fixture', hasSession: () => true, defaultEngines: () => ({ active: ['alpha', 'beta'], excluded: ['disabled'] }),
    scanContext: vi.fn(() => 'project context'), now: () => 1000, dispatch: vi.fn(),
    scheduleEvery: vi.fn(() => stop), checkpoint: vi.fn(),
    createScoreboard: vi.fn(() => ({ finish: vi.fn(), render: () => 'scoreboard' })),
    createRecord: vi.fn(() => ({ complete })),
  };
  const controller = new AbortController();
  const execute = vi.fn(async (_input: Record<string, unknown>, context: TribunalSessionContext) => {
    context.onRunStarted('/fixture/run');
    context.onWorkflowEvent({ type: 'synthesis:start', engineId: 'alpha', data: { round: 1, position: 'critic' } });
    return { exitCode: 0, result };
  });
  return { host, controller, execute, complete, stop };
}

it('runs the selected executor with context and signal, renders debate, and saves the original question', async () => {
  const f = fixture();
  await expect(runTribunalSession({ question: 'question', tribunalMode: 'red-team', protocol: 'parallel' }, f.controller.signal, f.host, f.execute)).resolves.toBe(result);
  expect(f.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    question: 'question\n\n## PROJECT CONTEXT\nproject context', engines: ['alpha', 'beta'], mode: 'red-team', protocol: 'parallel',
  }), expect.objectContaining({ signal: f.controller.signal, cwd: '/fixture' }));
  expect(f.host.createRecord).toHaveBeenCalledWith(expect.objectContaining({ question: 'question', mode: 'red-team', protocol: 'parallel', signal: f.controller.signal }));
  expect(f.complete).toHaveBeenCalledExactlyOnceWith(result);
  expect(f.host.dispatch).toHaveBeenCalledWith({ type: 'debate-round', round: 1, engineId: 'alpha', position: 'critic', argument: 'evidence' });
  expect(f.host.dispatch).toHaveBeenCalledWith({ type: 'header', title: 'Risk Register' });
  expect(f.host.dispatch).toHaveBeenCalledWith({ type: 'info', message: 'Full debate saved: /fixture/run' });
  expect(f.host.dispatch).toHaveBeenLastCalledWith({ type: 'progress-clear' });
  expect(f.stop).toHaveBeenCalled();
});

it.each(['abort', 'reject', 'exit', 'invalid'])('cleans progress without success recording on %s', async kind => {
  const f = fixture();
  const execute = vi.fn(async (_input: Record<string, unknown>, context: TribunalSessionContext) => {
    expect(context.signal).toBe(f.controller.signal);
    if (kind === 'abort') f.controller.abort(new Error('cancelled'));
    if (kind === 'reject') throw new Error('disabled');
    return kind === 'exit' ? { exitCode: 1, stderr: 'failed' } : kind === 'invalid' ? { exitCode: 0, result: {} } : { exitCode: 0, result };
  });
  await expect(runTribunalSession({ question: 'question' }, f.controller.signal, f.host, execute)).rejects.toThrow();
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.stop).toHaveBeenCalled();
  expect(f.host.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'verdict' }));
  expect(f.host.dispatch).toHaveBeenLastCalledWith({ type: 'progress-clear' });
});

it('does not dispatch or create session records for a pre-cancelled invocation', async () => {
  const f = fixture();
  f.controller.abort(new Error('cancelled'));
  await expect(runTribunalSession({ question: 'question' }, f.controller.signal, f.host, f.execute)).rejects.toThrow('cancelled');
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.host.createRecord).not.toHaveBeenCalled();
  expect(f.host.scheduleEvery).not.toHaveBeenCalled();
});

it.each([{ question: '' }, { question: 'q', engines: ['only'] }, { question: 'q', mode: 'invalid' }, { question: 'q', protocol: 'invalid' }])('rejects invalid session input %j before execution', async input => {
  const f = fixture();
  await expect(runTribunalSession(input, f.controller.signal, f.host, f.execute)).rejects.toThrow();
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.host.createRecord).not.toHaveBeenCalled();
});

it.each(['checkpoint', 'verdict-header'])('does not publish a verdict after cancellation in %s', async phase => {
  const f = fixture();
  if (phase === 'checkpoint') {
    f.host.checkpoint = vi.fn((_id, stage) => {
      if (stage === 'post-dispatch') f.controller.abort(new Error('cancelled during settlement'));
    });
  } else {
    f.host.dispatch = vi.fn(event => {
      if (event.type === 'header' && event.title === 'Verdict') f.controller.abort(new Error('cancelled during settlement'));
    });
  }
  await expect(runTribunalSession({ question: 'question' }, f.controller.signal, f.host, f.execute)).rejects.toThrow('cancelled during settlement');
  expect(f.host.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'verdict' }));
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.stop).toHaveBeenCalled();
  expect(f.host.dispatch).toHaveBeenLastCalledWith({ type: 'progress-clear' });
});

it('carries cancellation into an in-flight selected executor', async () => {
  const f = fixture();
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const execute = vi.fn(async (_input: Record<string, unknown>, context: TribunalSessionContext) => {
    began();
    await new Promise<void>((_resolve, reject) => context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true }));
    return { exitCode: 0, result };
  });
  const running = runTribunalSession({ question: 'question' }, f.controller.signal, f.host, execute);
  const rejected = expect(running).rejects.toThrow('cancelled');
  await started;
  f.controller.abort(new Error('cancelled'));
  await rejected;
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.stop).toHaveBeenCalled();
});
