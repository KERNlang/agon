import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ execute: vi.fn(), record: vi.fn(), complete: vi.fn(), scan: vi.fn(), checkpoint: vi.fn() }));
vi.mock('@kernlang/agon-core', async original => ({ ...await original<object>(), scanProjectContext: mocks.scan }));
vi.mock('@kernlang/agon-mod-tribunal', async original => ({ ...await original<object>(), createTribunalSessionRecord: mocks.record }));
vi.mock('../../packages/cli/src/cesar/checkpoint.js', async original => ({ ...await original<object>(), recordCheckpoint: mocks.checkpoint }));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', async original => ({ ...await original<object>(), executeProcessCesarRoute: mocks.execute }));
import { runPhysicalCesarWorkflow } from '../../packages/cli/src/signals/dispatch/cesar-router.js';
import { runPhysicalTuiContribution } from '../../packages/cli/src/signals/dispatch/intent-session.js';

const result = { question: 'Question', summary: 'readable verdict', mode: 'adversarial', protocol: 'parallel', positions: [],
  rounds: [{ round: 1, positions: [{ engineId: 'alpha', position: 'advocate', arguments: ['evidence'] }] }] };
const callbacks = () => ({ dispatch: vi.fn(), ctx: { config: {}, activeEngines: () => ['alpha', 'beta'], chatSession: { id: 'fixture' } } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.scan.mockReturnValue('context');
  mocks.record.mockReturnValue({ complete: mocks.complete });
  mocks.execute.mockImplementation(async (_route, _input, context) => {
    context.onRunStarted?.('/fixture/run');
    context.onWorkflowEvent?.({ type: 'synthesis:start', engineId: 'alpha', data: { round: 1, position: 'advocate' } });
    return { exitCode: 0, result, stdout: JSON.stringify(result) };
  });
});

it.each(['tui', 'cesar'])('uses the selected %s contribution, passes cancellation, and records/render results once', async surface => {
  const cb = callbacks();
  const signal = new AbortController().signal;
  if (surface === 'cesar') {
    await runPhysicalCesarWorkflow('tribunal', { question: 'Question' }, cb as never, signal, '/selected-cwd');
  } else {
    await runPhysicalTuiContribution({ owner: { id: 'agon.tribunal' }, payload: {
      inputSchema: { type: 'object' }, run: (input: unknown, context: unknown) => mocks.execute('tribunal', input, context),
    } }, { question: 'Question' }, 'tribunal', cb as never, signal);
  }
  expect(mocks.execute).toHaveBeenCalledExactlyOnceWith('tribunal', expect.objectContaining({ question: 'Question\n\n## PROJECT CONTEXT\ncontext', engines: ['alpha', 'beta'] }), expect.objectContaining({ signal }));
  if (surface === 'cesar') expect(mocks.execute.mock.calls[0][2].cwd).toBe('/selected-cwd');
  expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(result);
  expect(cb.dispatch.mock.calls.filter(([event]) => event.type === 'verdict')).toEqual([[{ type: 'verdict', summary: 'readable verdict' }]]);
  expect(cb.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ message: JSON.stringify(result) }));
  expect(cb.dispatch).toHaveBeenCalledWith({ type: 'info', message: 'Full debate saved: /fixture/run' });
  expect(cb.dispatch).toHaveBeenLastCalledWith({ type: 'progress-clear' });
});

it.each(['cancelled', 'disabled', 'replaced'])('does not record or render late success when %s', async reason => {
  const cb = callbacks();
  const controller = new AbortController();
  mocks.execute.mockImplementationOnce(async (_route, _input, context) => {
    expect(context.signal).toBe(controller.signal);
    if (reason === 'cancelled') { controller.abort(new Error(reason)); return { exitCode: 0, result }; }
    throw new Error(reason);
  });
  await expect(runPhysicalCesarWorkflow('tribunal', { question: 'Question' }, cb as never, controller.signal)).rejects.toThrow(reason);
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(cb.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'verdict' }));
  expect(cb.dispatch).toHaveBeenLastCalledWith({ type: 'progress-clear' });
});

it('does not grant Tribunal presentation to an external mod using the same public name', async () => {
  const cb = callbacks();
  await runPhysicalTuiContribution({ owner: { id: 'external.fixture' }, payload: {
    inputSchema: { type: 'object' }, run: async () => ({ exitCode: 0, stdout: 'external' }),
  } }, { question: 'Question' }, 'tribunal', cb as never, new AbortController().signal);
  expect(mocks.record).not.toHaveBeenCalled();
  expect(cb.dispatch).toHaveBeenCalledWith({ type: 'info', message: 'external' });
});
