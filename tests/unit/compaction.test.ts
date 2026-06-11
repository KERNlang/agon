import { describe, it, expect } from 'vitest';
import {
  findSafeKeepStart,
  buildCompactionSummary,
  renderCompactionText,
  buildSummarizationContext,
  buildCompactionPrompt,
} from '@kernlang/agon-core';

const msg = (role: string, content: unknown, extra: Record<string, unknown> = {}) =>
  ({ role, content, ...extra }) as any;

describe('findSafeKeepStart — boundary-safe keep-last-N cut', () => {
  it('keeps the last N messages when no tool boundary is involved', () => {
    const messages = [
      msg('system', 'sys'),
      msg('user', 'a'), msg('assistant', 'b'),
      msg('user', 'c'), msg('assistant', 'd'),
    ];
    expect(findSafeKeepStart(messages, 2, 1)).toBe(3);
  });

  it('never cuts between a tool_use and its tool_result', () => {
    const messages = [
      msg('system', 'sys'),
      msg('user', 'a'),
      msg('assistant', null, { tool_calls: [{ id: 'c1' }] }),
      msg('tool', 'result 1', { tool_call_id: 'c1' }),
      msg('tool', 'result 2', { tool_call_id: 'c2' }),
      msg('assistant', 'done'),
    ];
    // target keep=3 would cut at index 3 (a tool result) — must walk back to
    // the assistant message that issued the calls (index 2).
    expect(findSafeKeepStart(messages, 3, 1)).toBe(2);
  });

  it('clamps to minStart when the keep window covers everything', () => {
    const messages = [msg('system', 'sys'), msg('user', 'a'), msg('assistant', 'b')];
    expect(findSafeKeepStart(messages, 10, 1)).toBe(1);
  });

  it('handles an empty history', () => {
    expect(findSafeKeepStart([], 8, 0)).toBe(0);
  });

  it('walks back to minStart when the tail is all tool results', () => {
    const messages = [
      msg('assistant', null, { tool_calls: [{ id: 'c1' }] }),
      msg('tool', 'r1', { tool_call_id: 'c1' }),
      msg('tool', 'r2', { tool_call_id: 'c2' }),
    ];
    expect(findSafeKeepStart(messages, 1, 0)).toBe(0);
  });
});

describe('buildCompactionSummary — structured extraction + merge', () => {
  it('extracts goal, files, tools, and decisions', () => {
    const old = [
      msg('user', 'Fix the context gauge in the status bar'),
      msg('assistant', null, {
        tool_calls: [{ function: { name: 'Read', arguments: JSON.stringify({ file_path: '/a/status.kern' }) } }],
      }),
      msg('tool', 'file contents…', { tool_call_id: 'c1' }),
      msg('assistant', 'I decided to use the real API usage.\nApproach: anchor on the last response.', {}),
      msg('assistant', null, {
        tool_calls: [{ function: { name: 'Edit', arguments: JSON.stringify({ file_path: '/a/status.kern' }) } }],
      }),
    ];
    const summary = buildCompactionSummary(old, null);
    expect(summary.goal).toContain('Fix the context gauge');
    expect(summary.filesRead).toContain('/a/status.kern');
    expect(summary.filesModified).toContain('/a/status.kern');
    expect(summary.toolsSummary.some((t: string) => t.startsWith('Read('))).toBe(true);
    expect(summary.decisions.length).toBeGreaterThan(0);
    expect(summary.messagesCompacted).toBe(old.length);
  });

  it('prefers structured _parts over tool_calls parsing', () => {
    const old = [
      msg('assistant', 'text', {
        _parts: [{ kind: 'tool_call', toolName: 'Write', toolCallId: 'x', args: { file_path: '/b/new.ts' } }],
      }),
    ];
    const summary = buildCompactionSummary(old, null);
    expect(summary.filesModified).toContain('/b/new.ts');
  });

  it('merges with a previous summary and accumulates counts', () => {
    const prev = buildCompactionSummary([msg('user', 'original goal'), msg('assistant', 'ok')], null);
    const next = buildCompactionSummary([msg('user', 'later message'), msg('assistant', 'done')], prev);
    expect(next.goal).toBe(prev.goal); // first goal wins
    expect(next.messagesCompacted).toBe(4);
  });
});

describe('renderCompactionText', () => {
  it('renders only non-empty sections', () => {
    const summary = buildCompactionSummary([msg('user', 'goal here'), msg('assistant', 'progress text')], null);
    const text = renderCompactionText(summary, 2);
    expect(text).toContain('[Context compacted — 2 messages total, 2 this cycle]');
    expect(text).toContain('GOAL: goal here');
    expect(text).not.toContain('FILES MODIFIED');
  });
});

describe('buildSummarizationContext — bounded transcript', () => {
  const caps = { perMessageChars: 50, perToolChars: 20, totalChars: 10_000 };

  it('skips system messages and labels roles', () => {
    const out = buildSummarizationContext(
      [msg('system', 'SECRET SYSTEM'), msg('user', 'hello'), msg('assistant', 'world')],
      caps,
    );
    expect(out).not.toContain('SECRET SYSTEM');
    expect(out).toContain('[user] hello');
    expect(out).toContain('[assistant] world');
  });

  it('caps tool results harder than prose', () => {
    const out = buildSummarizationContext(
      [msg('tool', 'x'.repeat(500), { tool_call_id: 'c' }), msg('assistant', 'y'.repeat(500))],
      caps,
    );
    const toolLine = out.split('\n')[0];
    const proseLine = out.split('\n')[1];
    expect(toolLine.length).toBeLessThan(proseLine.length);
    expect(toolLine).toContain('truncated');
  });

  it('drops the OLDEST messages behind a marker when over the total budget', () => {
    const messages = Array.from({ length: 20 }, (_, i) => msg('user', `message number ${i} ${'pad'.repeat(20)}`));
    const out = buildSummarizationContext(messages, { perMessageChars: 200, perToolChars: 50, totalChars: 400 });
    expect(out).toContain('earlier messages omitted');
    expect(out).toContain('message number 19'); // most recent survives
    expect(out).not.toContain('message number 0 '); // oldest dropped
  });

  it('renders tool-call-only assistant messages as a tool list', () => {
    const out = buildSummarizationContext(
      [msg('assistant', null, { tool_calls: [{ function: { name: 'Bash' } }] })],
      caps,
    );
    expect(out).toContain('(tool calls: Bash)');
  });
});

describe('buildCompactionPrompt', () => {
  it('embeds the transcript and the required sections', () => {
    const p = buildCompactionPrompt('THE-TRANSCRIPT');
    expect(p).toContain('THE-TRANSCRIPT');
    for (const section of ['GOAL:', 'STATE:', 'KEY DECISIONS:', 'FILES:', 'DISCOVERIES:', 'NEXT STEPS:']) {
      expect(p).toContain(section);
    }
  });
});
