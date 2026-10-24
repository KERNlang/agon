import { beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as physical from '@kernlang/agon-mod-brainstorm';
const mocks = vi.hoisted(() => ({ execute: vi.fn(), complete: vi.fn(), fail: vi.fn(), create: vi.fn(), present: vi.fn(), dispose: vi.fn(), scan: vi.fn(), append: vi.fn(), setEngines: vi.fn(), presentationFail: vi.fn(), addResult: vi.fn(), recordRun: vi.fn() }));
vi.mock('@kernlang/agon-core', async importOriginal => ({ ...await importOriginal<object>(), scanProjectContext: mocks.scan, appendMessage: mocks.append }));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', async importOriginal => ({ ...await importOriginal<object>(), executeProcessCesarRoute: mocks.execute }));
vi.mock('@kernlang/agon-mod-brainstorm', async original => ({ ...await original<object>(), createBrainstormSessionRecord: mocks.create }));
vi.mock('../../packages/cli/src/blocks/brainstorm-presentation.js', () => ({ createBrainstormPresentation: () => ({ complete: mocks.present, dispose: mocks.dispose, setEngines: mocks.setEngines, fail: mocks.presentationFail }) }));
vi.mock('../../packages/cli/src/models/session-results.js', () => ({ sessionResultStore: { add: mocks.addResult } }));
vi.mock('../../packages/cli/src/telemetry/index.js', async original => ({ ...await original<object>(), recordRun: mocks.recordRun, formatRunSummary: () => 'saved summary' }));
import { runPhysicalCesarWorkflow } from '../../packages/cli/src/signals/dispatch/cesar-router.js';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockReturnValue({ complete: mocks.complete, fail: mocks.fail });
});
const callbacks = () => ({ dispatch: vi.fn(), ctx: { activeEngines: () => ['codex', 'claude'], chatSession: { id: 'test' } } });

it('owns session preparation and settlement in the physical Brainstorm package', () => {
  expect(physical).toHaveProperty('runBrainstormSession');
  const source = readFileSync(new URL('../../packages/cli/src/blocks/brainstorm-session.ts', import.meta.url), 'utf8');
  expect(source).toContain("from '@kernlang/agon-mod-brainstorm'");
  expect(source).not.toContain('output.exitCode');
  expect(source).not.toContain('input.engines.split');
  expect(source).not.toContain('sessionRecord?.complete');
});

it('records the same session-selected roster passed to the physical mod', async () => {
  const cb = callbacks();
  const result = { question: 'question', winner: 'codex', response: 'answer', bids: [] };
  mocks.execute.mockResolvedValue({ result });
  mocks.complete.mockReturnValue('record summary');
  await runPhysicalCesarWorkflow('brainstorm', { question: 'question' }, cb as never);
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ engines: ['codex', 'claude'] }), expect.any(Object));
  expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('chatSession');
  const message = { role: 'user', content: 'fixture', timestamp: '2026-01-01T00:00:00.000Z' };
  const originalSession = cb.ctx.chatSession;
  cb.ctx.chatSession = { id: 'later-session' };
  mocks.create.mock.calls[0][1].appendMessage(message);
  expect(mocks.append).toHaveBeenCalledExactlyOnceWith(originalSession, message);
  expect(mocks.execute).toHaveBeenCalledWith('brainstorm', { question: 'question', engines: ['codex', 'claude'] }, expect.anything());
  expect(mocks.complete).toHaveBeenCalledWith(result);
  expect(mocks.setEngines).toHaveBeenCalledExactlyOnceWith(['codex', 'claude']);
  expect(mocks.fail).not.toHaveBeenCalled();
  expect(mocks.dispose).toHaveBeenCalledOnce();
});

it('preserves the execution error even if failure recording also fails', async () => {
  mocks.execute.mockRejectedValue(new Error('workflow failure'));
  mocks.fail.mockImplementation(() => { throw new Error('ledger unavailable'); });
  await expect(runPhysicalCesarWorkflow('brainstorm', { question: 'question' }, callbacks() as never)).rejects.toThrow('workflow failure');
  expect(mocks.fail).toHaveBeenCalledOnce();
  expect(mocks.presentationFail).toHaveBeenCalledOnce();
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(mocks.dispose).toHaveBeenCalledOnce();
});

it('does not record another workflow as brainstorm', async () => {
  mocks.execute.mockResolvedValue({ exitCode: 0, result: { ok: true, chairmanId: 'codex', actingChairmanId: 'codex',
    brief: 'question', verdict: 'answer', confidence: 90, warnings: [], seats: [] } });
  await runPhysicalCesarWorkflow('council', { question: 'question' }, callbacks() as never);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.addResult).toHaveBeenCalledWith(expect.objectContaining({ type: 'council', winner: 'codex' }));
  expect(mocks.recordRun).toHaveBeenCalledWith(expect.objectContaining({ mode: 'council', success: true }));
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
  mocks.execute.mockResolvedValue({ result: { question: 'fixture', winner: 'fixture', response: 'answer', bids: [] } });
  await runPhysicalCesarWorkflow('brainstorm', { question: 'question', engines: 'claude,codex' }, callbacks() as never);
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ engines: ['claude', 'codex'] }), expect.any(Object));
});

it('rejects invalid input before recording or executing', async () => {
  await expect(runPhysicalCesarWorkflow('brainstorm', { question: ' ' }, callbacks() as never)).rejects.toThrow('requires a question');
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.dispose).toHaveBeenCalledOnce();
});

it('enriches brainstorm with session-configured project context from the invocation cwd', async () => {
  const cb = callbacks();
  Object.assign(cb.ctx, { config: { projectContext: 'Project constraints', contextFormat: 'kern' } });
  mocks.scan.mockReturnValue('Scanned project context');
  mocks.execute.mockResolvedValue({ result: { question: 'fixture', winner: 'fixture', response: 'answer', bids: [] } });
  await runPhysicalCesarWorkflow('brainstorm', { question: 'question' }, cb as never);
  const invocation = mocks.execute.mock.calls[0][2];
  expect(mocks.scan).toHaveBeenCalledExactlyOnceWith(invocation.cwd, 'Project constraints', 'kern');
  expect(mocks.execute.mock.calls[0][1]).toMatchObject({ context: 'Scanned project context' });
  expect(cb.dispatch).toHaveBeenCalledWith({ type: 'info', message: `Context: ${invocation.cwd}` });
});

it.each(['Explicit context', ''])('preserves explicit context %j without scanning', async context => {
  const cb = callbacks();
  Object.assign(cb.ctx, { config: {} });
  mocks.execute.mockResolvedValue({ result: { question: 'fixture', winner: 'fixture', response: 'answer', bids: [] } });
  await runPhysicalCesarWorkflow('brainstorm', { question: 'question', context }, cb as never);
  expect(mocks.scan).not.toHaveBeenCalled();
  expect(mocks.execute.mock.calls[0][1]).toMatchObject({ context });
});

it('rejects malformed context instead of silently replacing it', async () => {
  mocks.execute.mockResolvedValue({ result: { question: 'fixture', winner: 'fixture', response: 'answer', bids: [] } });
  await expect(runPhysicalCesarWorkflow('brainstorm', { question: 'question', context: 42 }, callbacks() as never)).rejects.toThrow('context must be a string');
  expect(mocks.scan).not.toHaveBeenCalled();
  expect(mocks.execute).not.toHaveBeenCalled();
});

it('does not scan for a cancelled invocation', async () => {
  const cb = callbacks();
  Object.assign(cb.ctx, { config: {} });
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await expect(runPhysicalCesarWorkflow('brainstorm', { question: 'question' }, cb as never, controller.signal)).rejects.toThrow('cancelled');
  expect(mocks.scan).not.toHaveBeenCalled();
});

it('cleans up without dispatching or recording success when scanning fails', async () => {
  mocks.execute.mockResolvedValue({ result: { question: 'fixture', winner: 'fixture', response: 'answer', bids: [] } });
  const cb = callbacks();
  Object.assign(cb.ctx, { config: {} });
  mocks.scan.mockImplementation(() => { throw new Error('scan failed'); });
  await expect(runPhysicalCesarWorkflow('brainstorm', { question: 'question' }, cb as never)).rejects.toThrow('scan failed');
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.dispose).toHaveBeenCalledOnce();
});
