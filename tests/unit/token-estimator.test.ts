import { describe, it, expect } from 'vitest';
import {
  estimateSessionTokens,
  estimateMessageHistoryTokens,
  estimateFlatHistoryTokens,
  estimatePtyTokens,
  estimateMessageTokens,
  effectiveWindow,
  resolveCharsPerToken,
} from '@kernlang/agon-core';
import type { SessionBudget } from '@kernlang/agon-core';

const budget = (over: Partial<SessionBudget> = {}): SessionBudget =>
  ({ contextWindow: 200_000, ...over } as SessionBudget);

describe('resolveCharsPerToken', () => {
  it('defaults to 3.9 when unset', () => {
    expect(resolveCharsPerToken(undefined)).toBeCloseTo(3.9);
    expect(resolveCharsPerToken(budget())).toBeCloseTo(3.9);
  });
  it('honors a configured divisor', () => {
    expect(resolveCharsPerToken(budget({ charsPerToken: 4.2 }))).toBeCloseTo(4.2);
  });
  it('falls back on a non-positive/NaN divisor', () => {
    expect(resolveCharsPerToken(budget({ charsPerToken: 0 }))).toBeCloseTo(3.9);
    expect(resolveCharsPerToken(budget({ charsPerToken: -1 }))).toBeCloseTo(3.9);
    expect(resolveCharsPerToken(budget({ charsPerToken: NaN }))).toBeCloseTo(3.9);
  });
});

describe('effectiveWindow', () => {
  it('subtracts max(15%, 8k) when reserveTokens omitted', () => {
    // 200k * 0.15 = 30k > 8k floor
    expect(effectiveWindow(budget())).toBe(200_000 - 30_000);
  });
  it('uses the 8k floor on a small window where 15% < 8k', () => {
    // 40k * 0.15 = 6k < 8k → reserve 8k
    expect(effectiveWindow(budget({ contextWindow: 40_000 }))).toBe(40_000 - 8_000);
  });
  it('honors an explicit reserveTokens', () => {
    expect(effectiveWindow(budget({ reserveTokens: 5_000 }))).toBe(195_000);
  });
  it('honors reserveTokens of 0', () => {
    expect(effectiveWindow(budget({ reserveTokens: 0 }))).toBe(200_000);
  });
  it('never returns below 1 for a degenerate window', () => {
    expect(effectiveWindow(budget({ contextWindow: 0 }))).toBe(1);
    expect(effectiveWindow(budget({ contextWindow: 100, reserveTokens: 1_000 }))).toBe(1);
  });
});

describe('estimateMessageTokens', () => {
  it('estimates string content as chars / divisor (ceil)', () => {
    // 39 chars / 3.9 = 10
    expect(estimateMessageTokens({ role: 'user', content: 'a'.repeat(39) }, 3.9)).toBe(10);
  });
  it('estimates tool-call-only assistant messages with a 100-token envelope', () => {
    const args = JSON.stringify({ command: 'ls -la' }); // ~24 chars
    const msg = { role: 'assistant', content: null, tool_calls: [{ function: { arguments: args } }] };
    const est = estimateMessageTokens(msg as any, 3.9);
    expect(est).toBe(100 + Math.ceil(args.length / 3.9));
  });
  it('falls back to a small constant for unexpected shapes', () => {
    expect(estimateMessageTokens({ role: 'user', content: 42 as any }, 3.9)).toBe(50);
  });
});

describe('estimateMessageHistoryTokens', () => {
  it('sums across the history', () => {
    const msgs = [
      { role: 'user', content: 'x'.repeat(39) }, // 10
      { role: 'assistant', content: 'y'.repeat(78) }, // 20
    ];
    expect(estimateMessageHistoryTokens(msgs, budget())).toBe(30);
  });
  it('returns 0 for an empty/invalid history', () => {
    expect(estimateMessageHistoryTokens([], budget())).toBe(0);
    expect(estimateMessageHistoryTokens(null as any, budget())).toBe(0);
  });
});

describe('estimatePtyTokens', () => {
  it('sums all orchestrator-known accumulations / divisor', () => {
    const acc = {
      systemPromptChars: 390, // 100
      userTurnsChars: 390, // 100
      toolResultsChars: 390, // 100
      continuityChars: 390, // 100
      pendingInputChars: 39, // 10
    };
    // total chars = 1599 → ceil(1599/3.9) = 410
    expect(estimatePtyTokens(acc, budget())).toBe(Math.ceil(1599 / 3.9));
  });
  it('treats missing fields as 0 and never goes negative', () => {
    expect(estimatePtyTokens({ pendingInputChars: 39 }, budget())).toBe(10);
    expect(estimatePtyTokens({ systemPromptChars: -100, pendingInputChars: 39 }, budget())).toBe(10);
    expect(estimatePtyTokens({}, budget())).toBe(0);
  });
});

describe('estimateSessionTokens', () => {
  it('uses messageHistory when present', () => {
    const inputs = { messageHistory: [{ role: 'user', content: 'z'.repeat(39) }] };
    expect(estimateSessionTokens(inputs, budget())).toBe(10);
  });
  it('uses the PTY accumulation when no messageHistory', () => {
    const inputs = { pty: { pendingInputChars: 78 } };
    expect(estimateSessionTokens(inputs, budget())).toBe(20);
  });
  it('prefers messageHistory over pty when both present', () => {
    const inputs = {
      messageHistory: [{ role: 'user', content: 'q'.repeat(39) }], // 10
      pty: { pendingInputChars: 39000 }, // would be huge
    };
    expect(estimateSessionTokens(inputs, budget())).toBe(10);
  });
  it('returns 0 when neither source is provided', () => {
    expect(estimateSessionTokens({}, budget())).toBe(0);
  });

  it("honors estimator:'message-history' (structured: tool-call envelope counted)", () => {
    const args = JSON.stringify({ command: 'ls' });
    const history = [
      { role: 'user', content: 'q'.repeat(39) }, // 10
      { role: 'assistant', content: null, tool_calls: [{ function: { arguments: args } }] }, // 100 + ceil(args/3.9)
    ];
    const structured = estimateSessionTokens({ messageHistory: history }, budget({ estimator: 'message-history' }));
    expect(structured).toBe(10 + 100 + Math.ceil(args.length / 3.9));
  });

  it("honors estimator:'chars-per-token' (flat: no 100-token envelope)", () => {
    const args = JSON.stringify({ command: 'ls' });
    const history = [
      { role: 'user', content: 'q'.repeat(39) },
      { role: 'assistant', content: null, tool_calls: [{ function: { arguments: args } }] },
    ];
    const flat = estimateSessionTokens({ messageHistory: history }, budget({ estimator: 'chars-per-token' }));
    // flat = ceil((39 + args.length) / 3.9) — no +100 envelope
    expect(flat).toBe(Math.ceil((39 + args.length) / 3.9));
    // structured (default) is strictly larger because of the envelope
    expect(estimateSessionTokens({ messageHistory: history }, budget())).toBeGreaterThan(flat);
  });
});

describe('estimateFlatHistoryTokens', () => {
  it('sums string content lengths / divisor', () => {
    const msgs = [
      { role: 'user', content: 'a'.repeat(39) },
      { role: 'assistant', content: 'b'.repeat(39) },
    ];
    expect(estimateFlatHistoryTokens(msgs, budget())).toBe(Math.ceil(78 / 3.9));
  });
  it('returns 0 for empty', () => {
    expect(estimateFlatHistoryTokens([], budget())).toBe(0);
  });
});
