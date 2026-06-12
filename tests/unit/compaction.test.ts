import { describe, it, expect } from 'vitest';
import {
  findSafeKeepStart,
  buildCompactionSummary,
  renderCompactionText,
  renderWorkingSet,
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

  // codex FIX 3: MultiEdit must count as a write so its file reaches filesModified
  // (and therefore WorkingSet.filesInPlay) — the old inline Edit||Write check dropped
  // it, so the most-recently changed file could go missing from filesInPlay.
  it('classifies MultiEdit as a write (structured _parts): file in filesModified + workingSet.filesInPlay', () => {
    const old = [
      msg('user', 'refactor the helper'),
      msg('assistant', 'text', {
        _parts: [{ kind: 'tool_call', toolName: 'MultiEdit', toolCallId: 'm1', args: { file_path: '/repo/multi.ts' } }],
      }),
    ];
    const summary = buildCompactionSummary(old, null);
    expect(summary.filesModified).toContain('/repo/multi.ts');
    expect(summary.workingSet).not.toBeNull();
    expect(summary.workingSet!.filesInPlay).toContain('/repo/multi.ts');
    // Modified-first: the MultiEdit'd file leads filesInPlay.
    expect(summary.workingSet!.filesInPlay[0]).toBe('/repo/multi.ts');
  });

  it('classifies MultiEdit as a write (tool_calls fallback path) too', () => {
    const old = [
      msg('user', 'edit it'),
      msg('assistant', null, {
        tool_calls: [{ function: { name: 'MultiEdit', arguments: JSON.stringify({ file_path: '/repo/legacy-multi.ts' }) } }],
      }),
    ];
    const summary = buildCompactionSummary(old, null);
    expect(summary.filesModified).toContain('/repo/legacy-multi.ts');
    expect(summary.workingSet!.filesInPlay).toContain('/repo/legacy-multi.ts');
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

// ── Feature 2: WORKING-SET CARRY-FORWARD (compaction-only) ───────────────
describe('buildCompactionSummary — workingSet carry-forward', () => {
  const editTool = (fp: string) =>
    msg('assistant', null, { tool_calls: [{ function: { name: 'Edit', arguments: JSON.stringify({ file_path: fp }) } }] });
  const readTool = (fp: string) =>
    msg('assistant', null, { tool_calls: [{ function: { name: 'Read', arguments: JSON.stringify({ file_path: fp }) } }] });

  it('builds workingSet from wsInput registry snapshot + pendingVerifier + folded decisions', () => {
    const old = [
      msg('user', 'fix the loop'),
      readTool('/repo/a.ts'),
      msg('assistant', 'I decided to anchor on real usage.'), // a decision (openHypotheses)
      editTool('/repo/b.ts'),
    ];
    const summary = buildCompactionSummary(old, null, {
      filesInPlay: ['/repo/registry-newest.ts', '/repo/registry-older.ts'],
      pendingVerifier: 'packages/core: 2 introduced errors unresolved',
    });
    expect(summary.workingSet).not.toBeNull();
    const ws = summary.workingSet!;
    // Modified-first priority: the edited file leads filesInPlay, then the
    // registry snapshot, then read-only files. Cap 10.
    expect(ws.filesInPlay[0]).toBe('/repo/b.ts'); // modified leads
    expect(ws.filesInPlay).toContain('/repo/registry-newest.ts');
    expect(ws.filesInPlay).toContain('/repo/a.ts');
    expect(ws.filesInPlay.length).toBeLessThanOrEqual(10);
    expect(ws.pendingVerifier).toBe('packages/core: 2 introduced errors unresolved');
    // openHypotheses reuses the already-extracted decisions/discoveries (no new pass).
    expect(ws.openHypotheses.some((h: string) => /anchor on real usage/.test(h))).toBe(true);
    expect(ws.openHypotheses.length).toBeLessThanOrEqual(3);
  });

  it('caps filesInPlay at 10 with modified-first ordering', () => {
    const old = Array.from({ length: 14 }, (_, i) => editTool(`/repo/mod-${i}.ts`));
    const summary = buildCompactionSummary(old, null, { filesInPlay: ['/repo/extra.ts'], pendingVerifier: null });
    const ws = summary.workingSet!;
    expect(ws.filesInPlay.length).toBe(10);
    // All 10 are modified files (modified-first) — the registry extra is crowded out.
    expect(ws.filesInPlay.every((f: string) => f.startsWith('/repo/mod-'))).toBe(true);
  });

  // codex 0.95 regression: within ONE compaction cycle, current-cycle modified
  // files are collected oldest→newest while scanning `old`. The bug emitted them in
  // that insertion order, so past the 10-file cap the OLDEST edits won and the
  // NEWEST edits dropped — the opposite of the intended recency bias. They must now
  // be newest-first so the freshest edits of the cycle survive the cap.
  it('>10 files modified in one cycle: the NEWEST edits survive the cap, not the oldest', () => {
    // 14 edits in chronological order: mod-0 (oldest) … mod-13 (newest).
    const old = Array.from({ length: 14 }, (_, i) => editTool(`/repo/mod-${i}.ts`));
    const ws = buildCompactionSummary(old, null).workingSet!;
    expect(ws.filesInPlay.length).toBe(10);
    // The 10 NEWEST (mod-4 … mod-13) must be present; the 4 oldest (mod-0..3) dropped.
    for (let i = 4; i <= 13; i++) expect(ws.filesInPlay).toContain(`/repo/mod-${i}.ts`);
    for (let i = 0; i <= 3; i++) expect(ws.filesInPlay).not.toContain(`/repo/mod-${i}.ts`);
    // Newest leads the list.
    expect(ws.filesInPlay[0]).toBe('/repo/mod-13.ts');
    // The long-term summary's own filesModified merge is UNCHANGED (insertion order):
    // it still carries every file, oldest-first — the WORKING-SET reorder is view-only.
    const summary = buildCompactionSummary(old, null);
    expect(summary.filesModified[0]).toBe('/repo/mod-0.ts'); // merge order untouched
    expect(summary.filesModified).toContain('/repo/mod-13.ts');
  });

  it('degrades gracefully with NO wsInput: filesInPlay derived from the summary (modified-first), no verifier', () => {
    const old = [
      msg('user', 'goal'),
      readTool('/repo/read-only.ts'),
      editTool('/repo/changed.ts'),
    ];
    const summary = buildCompactionSummary(old, null); // no wsInput
    const ws = summary.workingSet!;
    expect(ws).not.toBeNull();
    expect(ws.filesInPlay[0]).toBe('/repo/changed.ts'); // modified leads
    expect(ws.filesInPlay).toContain('/repo/read-only.ts');
    expect(ws.pendingVerifier).toBeNull(); // no digest → no verifier line
  });

  it('workingSet is null when there are no files, no verifier, and no hypotheses', () => {
    const summary = buildCompactionSummary([msg('user', 'x'), msg('assistant', 'y')], null);
    expect(summary.workingSet).toBeNull();
  });

  it('accumulates across cycles: a later cycle still carries a working set', () => {
    const prev = buildCompactionSummary([msg('user', 'g'), msg('assistant', null, { tool_calls: [{ function: { name: 'Edit', arguments: JSON.stringify({ file_path: '/repo/first.ts' }) } }] })], null);
    const next = buildCompactionSummary(
      [msg('assistant', null, { tool_calls: [{ function: { name: 'Edit', arguments: JSON.stringify({ file_path: '/repo/second.ts' }) } }] })],
      prev,
      { pendingVerifier: 'packages/core: clean' },
    );
    expect(next.workingSet).not.toBeNull();
    // Merged filesModified (first + second) flow into filesInPlay.
    expect(next.workingSet!.filesInPlay).toContain('/repo/second.ts');
    expect(next.workingSet!.filesInPlay).toContain('/repo/first.ts');
    expect(next.workingSet!.pendingVerifier).toBe('packages/core: clean');
  });

  // codex 0.90: recency-first ordering. OLD modified files (carried in
  // prev.filesModified across compactions) must NOT pin to the front and crowd
  // out the newest LIVE registry files when the cap-10 fills. The current-cycle
  // modified file + the live registry snapshot lead; older summary-derived files
  // fall back into any remaining slots.
  it('recency-first: current-cycle + live registry lead, old summary-modified do NOT crowd them out', () => {
    // prev carries 9 OLD modified files (would, modified-first, fill 9 of 10
    // slots and leave room for only one live file under the buggy ordering).
    const oldEdits = Array.from({ length: 9 }, (_, i) =>
      msg('assistant', null, { tool_calls: [{ function: { name: 'Edit', arguments: JSON.stringify({ file_path: `/repo/old-${i}.ts` }) } }] }),
    );
    const prev = buildCompactionSummary([msg('user', 'g'), ...oldEdits], null);

    // This cycle: one fresh edit, plus a live registry snapshot of 8 newest-first files.
    const liveSnapshot = Array.from({ length: 8 }, (_, i) => `/repo/live-${i}.ts`);
    const next = buildCompactionSummary(
      [msg('assistant', null, { tool_calls: [{ function: { name: 'Edit', arguments: JSON.stringify({ file_path: '/repo/fresh.ts' }) } }] })],
      prev,
      { filesInPlay: liveSnapshot, pendingVerifier: null },
    );
    const fip = next.workingSet!.filesInPlay;
    expect(fip.length).toBe(10);
    // Fresh current-cycle modified leads.
    expect(fip[0]).toBe('/repo/fresh.ts');
    // ALL live registry files survive (recency-first) — none crowded out by the
    // 9 old modified files.
    for (const f of liveSnapshot) expect(fip).toContain(f);
    // The fresh + 8 live = 9 slots; only ONE old file fits in the last slot.
    const oldKept = fip.filter((f: string) => f.startsWith('/repo/old-'));
    expect(oldKept.length).toBe(1);
    // The long-term summary still carries every modified file (ordering of the
    // WORKING-SET view does not change the summary's own filesModified merge).
    expect(next.filesModified).toContain('/repo/fresh.ts');
    expect(next.filesModified).toContain('/repo/old-0.ts');
  });
});

describe('renderWorkingSet — compact, ≤6-line block', () => {
  it('renders files (+N more), verifier, and recent on a compact line', () => {
    const out = renderWorkingSet({
      filesInPlay: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts'],
      pendingVerifier: '2 introduced errors unresolved',
      openHypotheses: ['anchor on real usage'],
    });
    expect(out).toContain('WORKING SET:');
    expect(out).toContain('files: a.ts, b.ts, c.ts, d.ts, e.ts (+2 more)');
    expect(out).toContain('verifier: 2 introduced errors unresolved');
    expect(out).toContain('recent: anchor on real usage');
    // Whole section stays within ~6 lines.
    expect(out.split('\n').length).toBeLessThanOrEqual(6);
  });

  it('returns empty string for a null/empty working set (so renderCompactionText drops it)', () => {
    expect(renderWorkingSet(null)).toBe('');
    expect(renderWorkingSet({ filesInPlay: [], pendingVerifier: null, openHypotheses: [] })).toBe('');
  });
});

describe('renderCompactionText — WORKING SET section', () => {
  it('emits the WORKING SET line when the summary has a working set, within cap', () => {
    const summary = buildCompactionSummary(
      [msg('user', 'goal'), msg('assistant', null, { tool_calls: [{ function: { name: 'Edit', arguments: JSON.stringify({ file_path: '/repo/x.ts' }) } }] })],
      null,
      { pendingVerifier: 'packages/core: clean' },
    );
    const text = renderCompactionText(summary, 2);
    expect(text).toContain('WORKING SET:');
    expect(text).toContain('verifier: packages/core: clean');
  });

  it('omits the WORKING SET section entirely when the summary has no working set', () => {
    const summary = buildCompactionSummary([msg('user', 'goal here'), msg('assistant', 'progress')], null);
    const text = renderCompactionText(summary, 2);
    expect(text).not.toContain('WORKING SET:');
  });
});
