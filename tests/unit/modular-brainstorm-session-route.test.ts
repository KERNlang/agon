import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ execute: vi.fn(), complete: vi.fn(), fail: vi.fn(), create: vi.fn(), present: vi.fn(), dispose: vi.fn() }));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', async importOriginal => ({ ...await importOriginal<object>(), executeProcessCesarRoute: mocks.execute }));
vi.mock('../../packages/cli/src/blocks/brainstorm-session-record.js', () => ({ createBrainstormSessionRecord: mocks.create }));
vi.mock('../../packages/cli/src/blocks/brainstorm-presentation.js', () => ({ createBrainstormPresentation: () => ({ complete: mocks.present, dispose: mocks.dispose }) }));
import { runPhysicalCesarWorkflow } from '../../packages/cli/src/signals/dispatch/cesar-router.js';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockReturnValue({ complete: mocks.complete, fail: mocks.fail });
});
const callbacks = () => ({ dispatch: vi.fn(), ctx: { activeEngines: () => ['codex', 'claude'], chatSession: { id: 'test' } } });

it('records the same session-selected roster passed to the physical mod', async () => {
  const cb = callbacks();
  const result = { winner: 'codex', response: 'answer', bids: [] };
  mocks.execute.mockResolvedValue({ result });
  mocks.complete.mockReturnValue('record summary');
  await runPhysicalCesarWorkflow('brainstorm', { question: 'question' }, cb as never);
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ engines: ['codex', 'claude'], chatSession: cb.ctx.chatSession }));
  expect(mocks.execute).toHaveBeenCalledWith('brainstorm', { question: 'question', engines: ['codex', 'claude'] }, expect.anything());
  expect(mocks.complete).toHaveBeenCalledWith(result);
  expect(mocks.fail).not.toHaveBeenCalled();
  expect(mocks.dispose).toHaveBeenCalledOnce();
});

it('preserves the execution error even if failure recording also fails', async () => {
  mocks.execute.mockRejectedValue(new Error('workflow failure'));
  mocks.fail.mockImplementation(() => { throw new Error('ledger unavailable'); });
  await expect(runPhysicalCesarWorkflow('brainstorm', { question: 'question' }, callbacks() as never)).rejects.toThrow('workflow failure');
  expect(mocks.fail).toHaveBeenCalledOnce();
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(mocks.dispose).toHaveBeenCalledOnce();
});

it('does not record another workflow as brainstorm', async () => {
  mocks.execute.mockResolvedValue({ result: { response: 'answer' } });
  await runPhysicalCesarWorkflow('council', { question: 'question' }, callbacks() as never);
  expect(mocks.create).not.toHaveBeenCalled();
});

it('rejects cancellation before displaying or recording a late success', async () => {
  const controller = new AbortController();
  mocks.execute.mockImplementation(async () => {
    controller.abort(new Error('cancelled'));
    return { result: { response: 'late' } };
  });
  await expect(runPhysicalCesarWorkflow('brainstorm', { question: 'question' }, callbacks() as never, controller.signal)).rejects.toThrow('cancelled');
  expect(mocks.present).not.toHaveBeenCalled();
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(mocks.fail).toHaveBeenCalledOnce();
});

it('preserves explicit engine selection', async () => {
  mocks.execute.mockResolvedValue({ result: {} });
  await runPhysicalCesarWorkflow('brainstorm', { question: 'question', engines: 'claude,codex' }, callbacks() as never);
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ engines: ['claude', 'codex'] }));
});

it('rejects invalid input before recording or executing', async () => {
  await expect(runPhysicalCesarWorkflow('brainstorm', { question: ' ' }, callbacks() as never)).rejects.toThrow('requires a question');
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.dispose).toHaveBeenCalledOnce();
});
