import { describe, it, expect, beforeEach } from 'vitest';
import { sessionResultStore } from '../../packages/cli/src/generated/session-results.js';

describe('SessionResultStore', () => {
  beforeEach(() => {
    sessionResultStore.clear();
  });

  it('starts empty', () => {
    expect(sessionResultStore.hasResults()).toBe(false);
    expect(sessionResultStore.getResults()).toEqual([]);
  });

  it('stores a brainstorm result', () => {
    sessionResultStore.add({
      type: 'brainstorm',
      timestamp: '2026-04-07T22:00:00.000Z',
      question: 'caching strategy?',
      engines: ['claude', 'codex'],
      winner: 'claude',
      data: {
        bids: [
          { engineId: 'claude', reasoning: 'Use Redis', score: 92 },
          { engineId: 'codex', reasoning: 'Use Memcached', score: 85 },
        ],
        response: 'Full Redis implementation plan...',
      },
    });

    expect(sessionResultStore.hasResults()).toBe(true);
    expect(sessionResultStore.getResults()).toHaveLength(1);
    expect(sessionResultStore.getResults()[0].type).toBe('brainstorm');
    expect(sessionResultStore.getResults()[0].winner).toBe('claude');
  });

  it('stores multiple results in order', () => {
    sessionResultStore.add({
      type: 'brainstorm',
      timestamp: '2026-04-07T22:00:00.000Z',
      question: 'first',
      engines: ['claude'],
      winner: 'claude',
      data: { bids: [], response: '' },
    });
    sessionResultStore.add({
      type: 'campfire',
      timestamp: '2026-04-07T22:05:00.000Z',
      question: 'second',
      engines: ['claude', 'gemini'],
      winner: null,
      data: { rounds: [] },
    });

    const results = sessionResultStore.getResults();
    expect(results).toHaveLength(2);
    expect(results[0].type).toBe('brainstorm');
    expect(results[1].type).toBe('campfire');
  });

  it('clear removes all results', () => {
    sessionResultStore.add({
      type: 'tribunal',
      timestamp: '2026-04-07T22:00:00.000Z',
      question: 'debate topic',
      engines: ['claude', 'codex'],
      winner: null,
      data: { rounds: [], verdict: 'Some verdict' },
    });
    expect(sessionResultStore.hasResults()).toBe(true);
    sessionResultStore.clear();
    expect(sessionResultStore.hasResults()).toBe(false);
  });
});
