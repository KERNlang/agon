import { expect, it, vi } from 'vitest';
import { runConquerSession } from './session-workflow.js';
import type { ConquerSessionContext } from './session-workflow.js';

it.each(['success', 'incomplete', 'builder-failed', 'publication-failed', 'crash', 'crash-record-failure', 'cancel-start', 'cancel-display', 'cancel-settlement', 'record-failure'] as const)(
  'preserves Conquer session effects for %s', async scenario => {
    const controller = new AbortController();
    const dispatch = vi.fn((event: { type: string; message?: string }) => {
      if (scenario === 'cancel-display' && event.message?.startsWith('Stopped:')) controller.abort(new Error('cancelled'));
    });
    const appendMessage = vi.fn(() => { if (scenario === 'cancel-settlement') controller.abort(new Error('cancelled')); });
    const recordRun = vi.fn(() => { if (scenario === 'record-failure' || scenario === 'crash-record-failure') throw new Error('receipt failed'); });
    const host = { cwd: () => '/source', now: () => 1000, dispatch, appendMessage, recordRun };
    const execute = vi.fn(async (_input: Record<string, unknown>, context: ConquerSessionContext) => {
      expect(context.cwd).toBe('/source');
      expect(context.signal).toBe(controller.signal);
      context.onWorkflowEvent?.({ type: 'conquer:start', data: { builder: 'builder', advisors: ['advisor'],
        worktree: { branch: 'conquer/fixture', path: '/retained' }, dirtySourceExcluded: true } });
      if (scenario === 'cancel-start') controller.abort(new Error('cancelled'));
      if (scenario === 'crash' || scenario === 'crash-record-failure') throw new Error('builder crashed');
      context.onWorkflowEvent?.({ type: 'conquer:turn', data: { n: 1, action: 'build', detail: 'work' } });
      return { exitCode: ['incomplete', 'builder-failed', 'publication-failed'].includes(scenario) ? 1 : 0,
        ...(scenario === 'publication-failed' ? { failure: { message: 'Publication refused: protected branch' } } : {}),
        result: { outputDir: '/run', workflow: {
        done: scenario !== 'incomplete' && scenario !== 'builder-failed',
        stopReason: scenario === 'incomplete' ? 'cap-turns' : scenario === 'builder-failed' ? 'builder-failed' : 'done',
        turnsUsed: 1, consultsRun: 0, lastClaim: 'verified feature', doneReason: 'gate checked',
      } } };
    });
    const running = runConquerSession({ task: 'build feature', gate: 'npm test' }, controller.signal, host, execute);
    const committed = scenario === 'success' || scenario === 'cancel-settlement';
    if (committed) await expect(running).resolves.toMatchObject({ workflow: { done: true } });
    else if (scenario === 'crash-record-failure') await expect(running).rejects.toThrow('builder crashed');
    else await expect(running).rejects.toThrow();
    expect(dispatch).toHaveBeenCalledWith({ type: 'info', message: 'worktree: /retained' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'warning', message: expect.stringContaining('uncommitted work') });
    expect(recordRun).toHaveBeenCalledOnce();
    if (scenario === 'crash' || scenario === 'crash-record-failure' || scenario === 'cancel-start' || scenario === 'cancel-display') expect(appendMessage).not.toHaveBeenCalled();
    else expect(appendMessage).toHaveBeenCalledOnce();
    if (scenario !== 'record-failure') expect(recordRun).toHaveBeenCalledWith(expect.objectContaining({
      success: committed, engineIds: ['builder', 'advisor'],
    }));
    if (committed) {
      expect(appendMessage).toHaveBeenCalledWith(expect.objectContaining({ content: '[conquer:done] verified feature' }));
      expect(recordRun).toHaveBeenCalledWith(expect.objectContaining({ completionState: 'completed' }));
    } else expect(dispatch).toHaveBeenCalledWith({ type: 'info', message: expect.stringContaining('Work preserved') });
    if (scenario === 'builder-failed' || scenario === 'publication-failed') {
      expect(recordRun).toHaveBeenCalledWith(expect.objectContaining({ completionState: 'crashed', success: false }));
    }
    if (scenario === 'publication-failed') {
      expect(appendMessage).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Publication refused: protected branch') }));
    }
    if (scenario === 'cancel-display') expect(dispatch).not.toHaveBeenCalledWith({ type: 'info', message: expect.stringContaining('✓ Conquered') });
  },
);
