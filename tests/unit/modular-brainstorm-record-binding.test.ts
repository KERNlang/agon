import { expect, it, vi } from 'vitest';
import type { BrainstormResult } from '@kernlang/agon-mod-brainstorm';
import { runBrainstormSession } from '../../packages/cli/src/blocks/brainstorm-session.js';

const effects = vi.hoisted(() => ({
  append: vi.fn(), track: vi.fn(), add: vi.fn(), checkpoint: vi.fn(), run: vi.fn(() => ({ id: 'receipt' })),
  summary: vi.fn(() => 'record summary'), complete: vi.fn(), dispose: vi.fn(),
}));
vi.mock('@kernlang/agon-core', async original => ({ ...await original<object>(),
  resolveWorkingDir: () => '/fixture', appendMessage: effects.append, tracker: { record: effects.track },
}));
vi.mock('../../packages/cli/src/models/session-results.js', () => ({ sessionResultStore: { add: effects.add } }));
vi.mock('../../packages/cli/src/cesar/checkpoint.js', () => ({
  buildCheckpoint: (id: string, phase: string, mode: string, engines: string[], metadata: unknown) => ({ id, phase, mode, engines, metadata }),
  recordCheckpoint: effects.checkpoint,
}));
vi.mock('../../packages/cli/src/telemetry/index.js', () => ({ recordRun: effects.run, formatRunSummary: effects.summary }));
vi.mock('../../packages/cli/src/blocks/brainstorm-presentation.js', () => ({
  createBrainstormPresentation: () => ({ setEngines: vi.fn(), onEvent: vi.fn(), complete: effects.complete, fail: vi.fn(), dispose: effects.dispose }),
}));

it('binds physical recording to the invocation session, checkpoints, tracker, result store and telemetry', async () => {
  const chatSession = { id: 'original' };
  const ctx = { chatSession, activeEngines: () => ['fixture'] };
  const dispatch = vi.fn();
  const result: BrainstormResult = { question: 'Question', winner: 'fixture', response: 'answer',
    bids: [{ engineId: 'fixture', reasoning: 'why', approach: 'how', score: 75, confidence: 80 }] };
  await expect(runBrainstormSession({ question: 'Question' }, { ctx, dispatch } as never,
    new AbortController().signal, async () => {
      ctx.chatSession = { id: 'replacement' };
      return { result };
    })).resolves.toEqual(result);
  expect(effects.append.mock.calls).toEqual([
    [chatSession, { role: 'user', content: '[brainstorm] Question', timestamp: expect.any(String) }],
    [chatSession, { role: 'engine', engineId: 'fixture', content: 'answer', timestamp: expect.any(String) }],
  ]);
  expect(effects.checkpoint.mock.calls.map(([item]) => item.phase)).toEqual(['pre-dispatch', 'post-dispatch']);
  expect(effects.checkpoint.mock.calls[0][0]).toMatchObject({ mode: 'brainstorm', engines: ['fixture'], metadata: { question: 'Question' } });
  expect(effects.track.mock.calls).toEqual([
    ['fixture', { prompt: 'Question', response: 'why' }],
    ['fixture', { prompt: 'Question', response: 'answer' }],
  ]);
  expect(effects.add).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'brainstorm', winner: 'fixture', question: 'Question' }));
  expect(effects.run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ mode: 'brainstorm', success: true, completionState: 'completed' }));
  expect(effects.summary).toHaveBeenCalledExactlyOnceWith({ id: 'receipt' });
  expect(effects.complete).toHaveBeenCalledExactlyOnceWith(result);
  expect(effects.run.mock.invocationCallOrder[0]).toBeLessThan(effects.complete.mock.invocationCallOrder[0]);
  expect(effects.dispose).toHaveBeenCalledOnce();
});
