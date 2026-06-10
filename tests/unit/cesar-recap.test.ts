import { describe, expect, it } from 'vitest';
import {
  createCesarRecapCapture,
  recordCesarRecapEvent,
  buildCesarTurnRecapEvent,
  shouldEmitCesarRecap,
} from '../../packages/cli/src/generated/cesar/recap.js';

describe('shouldEmitCesarRecap — turn-recap skip gate', () => {
  const base = {
    type: 'cesar-recap',
    engineId: 'claude',
    mode: 'self',
    outcome: 'Completed',
    durationMs: 1000,
    toolCount: 0,
    failedTools: 0,
    toolSummary: [] as string[],
    commands: [] as any[],
    files: [] as any[],
    changeSummary: { created: 0, edited: 0, read: 0 },
    todos: null as any,
    warnings: [] as string[],
  };

  it('rejects non-recap events', () => {
    expect(shouldEmitCesarRecap({ type: 'text' })).toBe(false);
    expect(shouldEmitCesarRecap(null)).toBe(false);
  });

  it('always emits a delegation hand-off', () => {
    expect(shouldEmitCesarRecap({ ...base, outcome: 'Handed off to forge', confidence: null })).toBe(true);
  });

  it('SKIPS a bare ReportConfidence turn (toolCount 1, confidence set, no findings)', () => {
    // Exactly the trivial turn the spec calls out: one Confidence tool call, a
    // confidence number, nothing else. Must stay quiet.
    const recap = { ...base, toolCount: 1, confidence: 92, toolSummary: ['Confidence'] };
    expect(shouldEmitCesarRecap(recap)).toBe(false);
  });

  it('SKIPS a no-tool, confidence-only turn', () => {
    expect(shouldEmitCesarRecap({ ...base, toolCount: 0, confidence: 80 })).toBe(false);
  });

  it('SKIPS a single silent read with no findings', () => {
    const recap = { ...base, toolCount: 1, confidence: null, files: [{ path: 'a.ts', relPath: 'a.ts', status: 'read', touchCount: 1 }] };
    expect(shouldEmitCesarRecap(recap)).toBe(false);
  });

  it('emits when more than one tool call ran (real work, even read-only)', () => {
    expect(shouldEmitCesarRecap({ ...base, toolCount: 3, confidence: 90 })).toBe(true);
  });

  it('emits when a file was changed (finding) even on a single tool call', () => {
    const recap = { ...base, toolCount: 1, files: [{ path: 'a.ts', relPath: 'a.ts', status: 'edited', touchCount: 1 }] };
    expect(shouldEmitCesarRecap(recap)).toBe(true);
  });

  it('emits when a command ran', () => {
    expect(shouldEmitCesarRecap({ ...base, toolCount: 1, commands: [{ label: 'tests', command: 'npm test', status: 'done' }] })).toBe(true);
  });

  it('emits when warnings/errors were raised', () => {
    expect(shouldEmitCesarRecap({ ...base, toolCount: 0, warnings: ['something went wrong'] })).toBe(true);
  });

  it('emits when the turn made todo progress (finding) even with one tool call', () => {
    expect(shouldEmitCesarRecap({ ...base, toolCount: 1, todos: { done: 1, total: 3 } })).toBe(true);
  });
});

describe('buildCesarTurnRecapEvent — todo delta capture', () => {
  it('captures the latest todos-set snapshot as N/M done', () => {
    const capture = createCesarRecapCapture('do stuff', Date.now());
    recordCesarRecapEvent(capture, {
      type: 'todos-set',
      todos: [
        { id: '1', text: 'a', state: 'done' },
        { id: '2', text: 'b', state: 'done' },
        { id: '3', text: 'c', state: 'running' },
      ],
    });
    const recap = buildCesarTurnRecapEvent(capture, { responded: true }, [], []);
    expect(recap.todos).toEqual({ done: 2, total: 3 });
  });

  it('latest todos-set wins (the brain re-emits the whole block)', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, { type: 'todos-set', todos: [{ id: '1', text: 'a', state: 'running' }] });
    recordCesarRecapEvent(capture, {
      type: 'todos-set',
      todos: [{ id: '1', text: 'a', state: 'done' }, { id: '2', text: 'b', state: 'done' }],
    });
    const recap = buildCesarTurnRecapEvent(capture, { responded: true }, [], []);
    expect(recap.todos).toEqual({ done: 2, total: 2 });
  });

  it('counts cancelled todos as resolved (done)', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, {
      type: 'todos-set',
      todos: [{ id: '1', text: 'a', state: 'done' }, { id: '2', text: 'b', state: 'cancelled' }],
    });
    const recap = buildCesarTurnRecapEvent(capture, { responded: true }, [], []);
    expect(recap.todos).toEqual({ done: 2, total: 2 });
  });

  it('a todos-clear wipes the captured snapshot (todos: null)', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    recordCesarRecapEvent(capture, { type: 'todos-set', todos: [{ id: '1', text: 'a', state: 'running' }] });
    recordCesarRecapEvent(capture, { type: 'todos-clear', scope: 'live' });
    const recap = buildCesarTurnRecapEvent(capture, { responded: true }, [], []);
    expect(recap.todos).toBeNull();
  });

  it('no todos declared → todos is null (renderer omits the line)', () => {
    const capture = createCesarRecapCapture('x', Date.now());
    const recap = buildCesarTurnRecapEvent(capture, { responded: true }, [], []);
    expect(recap.todos).toBeNull();
  });
});
