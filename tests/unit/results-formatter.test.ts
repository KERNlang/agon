import { describe, it, expect } from 'vitest';
import { formatSessionResults, formatChatTranscript } from '../../packages/cli/src/generated/blocks/results-formatter.js';
import type { SessionResult, ChatSession } from '@kernlang/agon-core';

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

  it('formats a review result with consensus summary and full per-engine prose', () => {
    const results: SessionResult[] = [{
      type: 'review',
      timestamp: '2026-04-07T22:35:00.000Z',
      question: 'uncommitted changes',
      engines: ['codex', 'claude'],
      winner: null,
      data: {
        label: 'uncommitted changes',
        consensusSummary: 'Consensus — 2/2 engines reviewed · 0 verified, 1 needs-check, 2 nit',
        blocking: false,
        reviews: [
          { engineId: 'codex', status: 'ok', reviewOutput: 'codex full review prose here' },
          { engineId: 'claude', status: 'unstructured', reviewOutput: 'claude unstructured prose' },
        ],
      },
    }];

    const output = formatSessionResults(results);
    expect(output).toContain('REVIEW #1');
    expect(output).toContain('uncommitted changes');
    expect(output).toContain('Consensus');
    expect(output).toContain('codex full review prose here');
    expect(output).toContain('claude unstructured prose');
    // non-ok engines get a status tag in the per-engine header
    expect(output).toContain('unstructured');
  });

  it('flags a blocking review in the header', () => {
    const results: SessionResult[] = [{
      type: 'review',
      timestamp: '2026-04-07T22:36:00.000Z',
      question: 'branch main',
      engines: ['codex'],
      winner: null,
      data: {
        label: 'branch main',
        consensusSummary: 'Consensus — 1/1 engines reviewed · 1 verified',
        blocking: true,
        reviews: [{ engineId: 'codex', status: 'ok', reviewOutput: 'found a blocker' }],
      },
    }];

    const output = formatSessionResults(results);
    expect(output).toContain('REVIEW #1');
    expect(output).toContain('BLOCKING');
    expect(output).toContain('found a blocker');
  });

  it('formats a chrome result with the page-driving header and answer', () => {
    const results: SessionResult[] = [{
      type: 'chrome',
      timestamp: '2026-04-07T22:40:00.000Z',
      question: 'check the pricing page design',
      engines: ['codex'],
      winner: 'codex',
      data: {
        task: 'check the pricing page design',
        answer: 'The hero is cluttered — three CTAs compete above the fold.',
        engineId: 'codex',
        pageActivity: true,
      },
    }];

    const output = formatSessionResults(results);
    expect(output).toContain('CHROME #1');
    expect(output).toContain('check the pricing page design');
    expect(output).toContain('codex');
    expect(output).toContain('drove the page');
    expect(output).toContain('The hero is cluttered');
  });

  it('marks a chrome result as text-only when no page tools ran', () => {
    const results: SessionResult[] = [{
      type: 'chrome',
      timestamp: '2026-04-07T22:41:00.000Z',
      question: 'what is the WHATWG URL spec',
      engines: ['agon'],
      winner: 'agon',
      data: { task: 'what is the WHATWG URL spec', answer: 'A living standard…', engineId: 'agon', pageActivity: false },
    }];

    const output = formatSessionResults(results);
    expect(output).toContain('CHROME #1');
    expect(output).toContain('text only (no page tools ran)');
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

describe('formatChatTranscript', () => {
  it('returns empty-state message when no chat messages exist', () => {
    const session: ChatSession = {
      id: 'chat-1',
      startedAt: '2026-04-08T10:00:00.000Z',
      messages: [],
      cwd: '/tmp/project',
      branch: 'main',
    };

    const output = formatChatTranscript(session);
    expect(output).toContain('No chat messages in this session yet');
  });

  it('formats user and engine messages for pager-friendly copying', () => {
    const session: ChatSession = {
      id: 'chat-2',
      startedAt: '2026-04-08T10:00:00.000Z',
      cwd: '/tmp/project',
      branch: 'feat/chat-pager',
      messages: [
        {
          role: 'user',
          content: 'Explain the auth flow',
          timestamp: '2026-04-08T10:01:00.000Z',
          images: ['diagram.png'],
        },
        {
          role: 'engine',
          engineId: 'claude',
          content: 'The request goes through middleware first.',
          timestamp: '2026-04-08T10:01:30.000Z',
        },
      ],
    };

    const output = formatChatTranscript(session);
    expect(output).toContain('Chat Transcript');
    expect(output).toContain('/tmp/project');
    expect(output).toContain('branch: feat/chat-pager');
    expect(output).toContain('USER');
    expect(output).toContain('CLAUDE');
    expect(output).toContain('Images: diagram.png');
    expect(output).toContain('Explain the auth flow');
    expect(output).toContain('The request goes through middleware first.');
  });
});
