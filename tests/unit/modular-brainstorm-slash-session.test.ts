import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), complete: vi.fn(), fail: vi.fn(), scan: vi.fn() }));
vi.mock('@kernlang/agon-core', async importOriginal => ({ ...await importOriginal<object>(), scanProjectContext: mocks.scan }));
vi.mock('../../packages/cli/src/blocks/brainstorm-session-record.js', () => ({ createBrainstormSessionRecord: mocks.create }));
import { runPhysicalTuiContribution } from '../../packages/cli/src/signals/dispatch/intent-session.js';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockReturnValue({ complete: mocks.complete, fail: mocks.fail });
});
const result = { winner: 'fixture', response: 'readable answer', bids: [
  { engineId: 'fixture', reasoning: 'why', approach: 'how', score: 71, confidence: 80 },
] };
const callbacks = () => ({ dispatch: vi.fn(), ctx: { config: {}, activeEngines: () => ['fixture'], chatSession: { id: 'session' } } });
const record = (run: ReturnType<typeof vi.fn>, owner = 'agon.brainstorm') => ({ owner: { id: owner }, payload: {
  inputSchema: { type: 'object', required: ['question'], properties: { question: { type: 'string' } } }, run,
} });

it('uses the selected TUI contribution with session context and the real Brainstorm presenter', async () => {
  const cb = callbacks();
  const signal = new AbortController().signal;
  mocks.scan.mockReturnValue('fixture project context');
  const run = vi.fn(async (_input, context) => {
    context.onWorkflowEvent?.({ type: 'brainstorm:seat-started', data: { engineId: 'fixture' } });
    return { exitCode: 0, result, stdout: JSON.stringify(result) };
  });
  await runPhysicalTuiContribution(record(run), { question: 'Question' }, 'brainstorm', cb as never, signal);
  expect(run).toHaveBeenCalledExactlyOnceWith({ question: 'Question', engines: ['fixture'], context: 'fixture project context' }, expect.objectContaining({ signal }));
  expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(result);
  expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'kern-draft' }));
  expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'engine-block', content: 'readable answer' }));
  expect(cb.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ message: JSON.stringify(result) }));
  expect(cb.dispatch).toHaveBeenLastCalledWith({ type: 'progress-clear' });
});

it('rejects late success after cancellation and clears progress', async () => {
  const cb = callbacks();
  const controller = new AbortController();
  const run = vi.fn(async () => { controller.abort(new Error('cancelled')); return { exitCode: 0, result }; });
  await expect(runPhysicalTuiContribution(record(run), { question: 'Question' }, 'brainstorm', cb as never, controller.signal)).rejects.toThrow('cancelled');
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(mocks.fail).toHaveBeenCalledOnce();
  expect(cb.dispatch).toHaveBeenLastCalledWith({ type: 'progress-clear' });
});

it('does not apply first-party presentation based only on a command name', async () => {
  const cb = callbacks();
  const run = vi.fn(async () => ({ exitCode: 0, stdout: 'external output' }));
  await runPhysicalTuiContribution(record(run, 'external.fixture'), { question: 'Question' }, 'brainstorm', cb as never, new AbortController().signal);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(run).toHaveBeenCalledWith({ question: 'Question' }, expect.anything());
  expect(cb.dispatch).toHaveBeenCalledWith({ type: 'info', message: 'external output' });
});
