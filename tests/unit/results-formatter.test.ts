import { describe, it, expect } from 'vitest';
import { formatSessionResults } from '../../packages/cli/src/generated/results-formatter.js';
import type { SessionResult } from '@agon/core';

describe('formatSessionResults', () => {
  it('returns empty-state message when no results', () => {
    const output = formatSessionResults([]);
    expect(output).toContain('No results in this session yet');
  });

  it('formats a brainstorm result with header and bids', () => {
    const results: SessionResult[] = [{
      type: 'brainstorm',
      timestamp: '2026-04-07T22:15:00.000Z',
      question: 'caching strategy?',
      engines: ['claude', 'codex'],
      winner: 'claude',
      data: {
        bids: [
          { engineId: 'claude', reasoning: 'Use Redis for speed', score: 92 },
          { engineId: 'codex', reasoning: 'Use Memcached', score: 85 },
        ],
        response: 'Full Redis plan here',
      },
    }];

    const output = formatSessionResults(results);
    expect(output).toContain('BRAINSTORM #1');
    expect(output).toContain('caching strategy?');
    expect(output).toContain('claude');
    expect(output).toContain('codex');
    expect(output).toContain('Use Redis for speed');
    expect(output).toContain('Use Memcached');
    expect(output).toContain('Full Redis plan here');
  });

  it('formats a campfire result with rounds', () => {
    const results: SessionResult[] = [{
      type: 'campfire',
      timestamp: '2026-04-07T22:20:00.000Z',
      question: 'discuss caching',
      engines: ['claude', 'gemini'],
      winner: null,
      data: {
        rounds: [
          { engineId: 'claude', content: 'I think Redis is best' },
          { engineId: 'gemini', content: 'Consider edge caching too' },
        ],
      },
    }];

    const output = formatSessionResults(results);
    expect(output).toContain('CAMPFIRE #1');
    expect(output).toContain('discuss caching');
    expect(output).toContain('I think Redis is best');
    expect(output).toContain('Consider edge caching too');
  });

  it('formats a tribunal result with rounds and verdict', () => {
    const results: SessionResult[] = [{
      type: 'tribunal',
      timestamp: '2026-04-07T22:25:00.000Z',
      question: 'Redis vs Memcached',
      engines: ['claude', 'codex'],
      winner: null,
      data: {
        rounds: [
          { round: 1, engineId: 'claude', position: 'pro', argument: 'Redis has persistence' },
          { round: 1, engineId: 'codex', position: 'con', argument: 'Memcached is simpler' },
        ],
        verdict: 'Redis wins for this use case',
      },
    }];

    const output = formatSessionResults(results);
    expect(output).toContain('TRIBUNAL #1');
    expect(output).toContain('Redis vs Memcached');
    expect(output).toContain('Round 1');
    expect(output).toContain('Redis has persistence');
    expect(output).toContain('Memcached is simpler');
    expect(output).toContain('Redis wins for this use case');
  });

  it('formats a forge result with scoreboard', () => {
    const results: SessionResult[] = [{
      type: 'forge',
      timestamp: '2026-04-07T22:30:00.000Z',
      question: 'fix auth bug',
      engines: ['claude', 'codex'],
      winner: 'claude',
      data: {
        scoreboard: [
          { engineId: 'claude', pass: true, score: 95, diffLines: 42, filesChanged: 3, durationSec: 15 },
          { engineId: 'codex', pass: false, score: 60, diffLines: 100, filesChanged: 8, durationSec: 22 },
        ],
        winner: 'claude',
      },
    }];

    const output = formatSessionResults(results);
    expect(output).toContain('FORGE #1');
    expect(output).toContain('fix auth bug');
    expect(output).toContain('PASS');
    expect(output).toContain('FAIL');
    expect(output).toContain('95');
    expect(output).toContain('42 lines');
  });

  it('numbers multiple results sequentially', () => {
    const results: SessionResult[] = [
      {
        type: 'brainstorm',
        timestamp: '2026-04-07T22:00:00.000Z',
        question: 'first',
        engines: ['claude'],
        winner: 'claude',
        data: { bids: [], response: '' },
      },
      {
        type: 'forge',
        timestamp: '2026-04-07T22:10:00.000Z',
        question: 'second',
        engines: ['claude'],
        winner: 'claude',
        data: { scoreboard: [], winner: 'claude' },
      },
    ];

    const output = formatSessionResults(results);
    expect(output).toContain('#1');
    expect(output).toContain('#2');
  });
});
