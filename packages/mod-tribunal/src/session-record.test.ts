import { describe, expect, it, vi } from 'vitest';
import { createTribunalSessionRecord } from './session-record.js';
import type { TribunalResult } from './runtime.js';

const result: TribunalResult = {
  question: 'enriched question', mode: 'red-team', protocol: 'parallel', summary: 'verdict',
  positions: [], rounds: [{ round: 1, positions: [{ engineId: 'alpha', position: 'critic', arguments: ['evidence', 'detail'] }] }],
};

function fixture() {
  const controller = new AbortController();
  const effects = {
    now: () => 2000, appendMessage: vi.fn(), addResult: vi.fn(), recordRun: vi.fn(() => 'receipt'),
    formatSummary: vi.fn(() => 'summary'), summaryEnabled: () => true, notify: vi.fn(), track: vi.fn(), warn: vi.fn(),
  };
  const record = createTribunalSessionRecord({ question: 'original question', engines: ['alpha', 'beta'], mode: 'red-team', protocol: 'parallel', startedAt: 1000, signal: controller.signal }, effects);
  return { controller, effects, record };
}

describe('Tribunal session recording owner', () => {
  it('preserves chat, historical result and tracking payloads', () => {
    const { record, effects } = fixture();
    record.complete(result);
    expect(effects.appendMessage.mock.calls).toEqual([
      [{ role: 'user', content: '[tribunal:red-team/parallel] original question', timestamp: '1970-01-01T00:00:02.000Z' }],
      [{ role: 'engine', engineId: 'tribunal', content: 'verdict', timestamp: '1970-01-01T00:00:02.000Z' }],
    ]);
    expect(effects.addResult).toHaveBeenCalledWith({ type: 'tribunal', timestamp: '1970-01-01T00:00:02.000Z',
      question: 'original question', engines: ['alpha', 'beta'], winner: null,
      data: { rounds: [{ round: 1, engineId: 'alpha', position: 'critic', argument: 'evidence' }], verdict: 'verdict', protocol: 'parallel' } });
    expect(effects.track).toHaveBeenCalledWith('alpha', { prompt: 'original question', response: 'evidence detail' });
    expect(effects.recordRun).toHaveBeenCalledWith({ mode: 'tribunal', intent: 'original question', success: true,
      durationMs: 1000, engineIds: ['alpha', 'beta'], completionState: 'completed' });
    expect(effects.notify).toHaveBeenCalledWith('summary');
    expect(() => record.complete(result)).toThrow('already started');
    expect(effects.addResult).toHaveBeenCalledOnce();
  });

  it.each(['before', 'history', 'result', 'tracking'])('does not record success when cancelled at %s', phase => {
    const { record, effects, controller } = fixture();
    const abort = () => controller.abort(new Error('cancelled'));
    if (phase === 'before') abort();
    if (phase === 'history') effects.appendMessage.mockImplementationOnce(abort);
    if (phase === 'result') effects.addResult.mockImplementationOnce(abort);
    if (phase === 'tracking') effects.track.mockImplementationOnce(abort);
    expect(() => record.complete(result)).toThrow('cancelled');
    expect(effects.recordRun).not.toHaveBeenCalled();
    expect(effects.notify).not.toHaveBeenCalled();
  });

  it('does not publish success if required tracking fails', () => {
    const { record, effects } = fixture();
    effects.track.mockImplementationOnce(() => { throw new Error('tracking failed'); });
    expect(() => record.complete(result)).toThrow('tracking failed');
    expect(effects.recordRun).not.toHaveBeenCalled();
    expect(() => record.complete(result)).toThrow('already started');
    expect(effects.addResult).toHaveBeenCalledOnce();
  });

  it('keeps a completed receipt when optional summary rendering fails', () => {
    const { record, effects } = fixture();
    effects.formatSummary.mockImplementationOnce(() => { throw new Error('renderer failed'); });
    expect(() => record.complete(result)).not.toThrow();
    expect(effects.recordRun).toHaveBeenCalledOnce();
    expect(effects.warn).toHaveBeenCalledOnce();
  });
});
