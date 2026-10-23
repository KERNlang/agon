import { expect, it, vi } from 'vitest';
import { runConquerSession } from './session-workflow.js';
import type { ConquerSessionContext } from './session-workflow.js';
import { runConquerCli } from './cli-workflow.js';
import type { ConquerDisplay } from './presentation.js';

it.each(['success', 'published', 'incomplete', 'builder-failed', 'publication-failed', 'crash', 'crash-record-failure', 'cancel-start', 'cancel-display', 'cancel-settlement', 'record-failure'] as const)(
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
        result: { outputDir: '/run', ...(scenario === 'published' ? {
          publication: { ok: true, branch: 'conquer/fixture' },
          pullRequest: { title: 'Review feature', body: 'Verified feature', mergeHint: 'Open the PR' },
        } : {}), workflow: {
        done: scenario !== 'incomplete' && scenario !== 'builder-failed',
        stopReason: scenario === 'incomplete' ? 'cap-turns' : scenario === 'builder-failed' ? 'builder-failed' : 'done',
        turnsUsed: 1, consultsRun: 0, lastClaim: 'verified feature', doneReason: 'gate checked',
      } } };
    });
    const running = runConquerSession({ task: 'build feature', gate: 'npm test' }, controller.signal, host, execute);
    const committed = scenario === 'success' || scenario === 'published' || scenario === 'cancel-settlement';
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
    if (scenario === 'published') {
      expect(dispatch).toHaveBeenCalledWith({ type: 'info', message: 'Pushed conquer/fixture.' });
      expect(dispatch).toHaveBeenCalledWith({ type: 'info', message: 'Open the PR' });
      expect(dispatch).not.toHaveBeenCalledWith({ type: 'info', message: expect.stringContaining('Review and commit there') });
    }
    if (scenario === 'cancel-display') expect(dispatch).not.toHaveBeenCalledWith({ type: 'info', message: expect.stringContaining('✓ Conquered') });
  },
);

it.each(['published', 'publication-failed', 'incomplete', 'crash', 'cancel-display', 'cancel-summary', 'observer-error', 'display-errors'] as const)(
  'preserves CLI output and failure semantics for %s', async scenario => {
    const controller = new AbortController();
    const messages: string[] = [];
    const display: ConquerDisplay = event => {
      const message = event.type === 'header' ? event.title : event.message;
      messages.push(message);
      if (scenario === 'cancel-display' && event.type === 'header') controller.abort(new Error('display cancelled'));
      if (scenario === 'cancel-summary' && message.startsWith('Stopped:')) controller.abort(new Error('summary cancelled'));
      if (scenario === 'display-errors') throw new Error(event.type === 'header' ? 'first display failed' : 'recovery display failed');
    };
    const payload = {
      workflow: { done: scenario !== 'incomplete', stopReason: 'done', turnsUsed: 1,
        consultsRun: 0, lastClaim: 'feature works', doneReason: 'No patch was produced', counterexample: 'bad input', observed: 'refused', attackText: 'probe' },
      outputDir: '/run', publication: { ok: scenario !== 'publication-failed', branch: 'conquer/fixture', message: 'push refused' },
      pullRequest: { title: 'Review feature', body: 'Verified feature', mergeHint: 'Open the PR', url: '', usedTemplate: true },
    };
    const execute = vi.fn(async (_input, context) => {
      context.onWorkflowEvent({ type: 'conquer:start', data: { task: 'feature', gate: 'true', builder: 'builder',
        advisors: [], worktree: { branch: 'conquer/fixture', path: '/retained' } } });
      if (scenario === 'crash') throw new Error('finalization failed');
      return { exitCode: scenario === 'published' ? 0 : 1, result: payload,
        ...(scenario === 'incomplete' ? { failure: { code: 'CONQUER_INCOMPLETE', message: 'Conquer stopped without satisfying completion requirements', retryable: true } } : {}),
        ...(scenario === 'publication-failed' ? { failure: { code: 'PUBLISH', message: 'push refused', retryable: false }, stderr: 'push refused\n' } : {}) };
    });
    const running = runConquerCli({}, { invocationId: 'cli-output', cwd: '/source', platform: 'darwin-arm64',
      signal: controller.signal, config: {},
      onWorkflowEvent: () => { if (scenario === 'observer-error') throw new Error('observer failed'); },
    }, execute, display);
    if (['crash', 'cancel-display', 'cancel-summary', 'observer-error', 'display-errors'].includes(scenario)) {
      const error = scenario === 'crash' ? 'finalization failed' : scenario === 'cancel-display' ? 'display cancelled'
        : scenario === 'cancel-summary' ? 'summary cancelled' : scenario === 'observer-error' ? 'observer failed' : 'first display failed';
      await expect(running).rejects.toThrow(error);
      expect(messages.join('\n')).toContain('Work preserved on conquer/fixture at /retained');
      expect(messages.join('\n')).not.toContain('✓ Conquered');
    } else {
      const result = await running;
      expect(result.result).toBe(payload);
      expect(result.stdout).toBe('');
      expect(result.exitCode).toBe(scenario === 'published' ? 0 : 1);
      expect(messages.join('\n')).toContain('Falsifier counterexample: bad input → observed: refused');
      expect(messages.join('\n')).toContain('Adversary falsifier log: /run');
      if (scenario === 'published') {
        expect(messages).toContain('Pushed conquer/fixture.');
        expect(messages).toContain('Review feature');
        expect(messages).toContain('Verified feature');
        expect(messages).toContain('Open the PR');
      } else {
        expect(messages.join('\n')).not.toContain('✓ Conquered');
        expect(messages.join('\n')).toContain('Work preserved on conquer/fixture at /retained');
      }
      if (scenario === 'publication-failed') {
        expect(result.stderr).toBe('push refused\n');
        expect(messages).toContain('push refused');
      }
      if (scenario === 'incomplete') expect(messages.join('\n')).toContain('No patch was produced');
    }
  },
);
