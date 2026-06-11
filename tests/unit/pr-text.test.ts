// runPrText — engine-written PR title/body for branches agon pushes.
// Contract: TITLE:-line reply format, tolerant parsing (think-blocks, fences,
// preamble), and fail-open dispatch (ok:false on any engine miss — the push
// already succeeded, callers fall back to their template).

import { describe, expect, it } from 'vitest';

import { buildPrTextPrompt, parsePrText, runPrText } from '../../packages/forge/src/index.js';

describe('buildPrTextPrompt', () => {
  it('includes intent, run facts, commits, diff and the TITLE: reply contract', () => {
    const p = buildPrTextPrompt({ intent: 'build the widget', context: 'Gate: npm test (passed)', commits: 'abc123 feat: widget', diff: 'diff --git a/x b/x' });
    expect(p).toContain('build the widget');
    expect(p).toContain('Gate: npm test (passed)');
    expect(p).toContain('abc123 feat: widget');
    expect(p).toContain('diff --git a/x b/x');
    expect(p).toContain('TITLE: <the title>');
    expect(p).toContain('## Verification');
  });

  it('tells the writer to work from commits/facts when the diff is unavailable', () => {
    const p = buildPrTextPrompt({ intent: 'x', commits: 'abc', diff: '' });
    expect(p).toContain('diff unavailable');
  });
});

describe('parsePrText', () => {
  it('parses the canonical TITLE: + body reply', () => {
    const out = parsePrText('TITLE: feat: add widget\n\n## Summary\nAdds the widget.');
    expect(out).toEqual({ title: 'feat: add widget', body: '## Summary\nAdds the widget.' });
  });

  it('drops preamble before the TITLE line and strips <think> blocks', () => {
    const raw = '<think>let me see</think>Sure, here is the PR text:\nTITLE: fix: bug\n\n## Summary\nFixes it.';
    expect(parsePrText(raw)).toEqual({ title: 'fix: bug', body: '## Summary\nFixes it.' });
  });

  it('unwraps a whole-reply markdown fence', () => {
    const raw = '```markdown\nTITLE: feat: x\n\nbody here\n```';
    expect(parsePrText(raw)).toEqual({ title: 'feat: x', body: 'body here' });
  });

  it('strips a leading BODY: label', () => {
    expect(parsePrText('TITLE: t\n\nBODY: the body')).toEqual({ title: 't', body: 'the body' });
  });

  it('returns null on empty input, missing TITLE line, or empty body', () => {
    expect(parsePrText('')).toBeNull();
    expect(parsePrText('just prose with no title line')).toBeNull();
    expect(parsePrText('TITLE: only a title')).toBeNull();
  });
});

describe('runPrText (fail-open dispatch)', () => {
  const registry = { get: (id: string) => ({ id }), list: () => [] } as any;
  const opts = { engineId: 'fake', intent: 'x', commits: '', diff: '', registry, timeout: 30, outputDir: '/tmp/pr-text-test', cwd: '/tmp' };
  const adapterReturning = (stdout: string) =>
    ({ dispatch: async () => ({ exitCode: 0, stdout, stderr: '', durationMs: 1, timedOut: false }) }) as any;

  it('ok:true with parsed title/body on a clean reply', async () => {
    const res = await runPrText({ ...opts, adapter: adapterReturning('TITLE: feat: y\n\n## Summary\nok') } as any);
    expect(res).toEqual({ ok: true, title: 'feat: y', body: '## Summary\nok', engineId: 'fake' });
  });

  it('ok:false on an unparseable reply (caller falls back to its template)', async () => {
    const res = await runPrText({ ...opts, adapter: adapterReturning('no title here') } as any);
    expect(res.ok).toBe(false);
  });

  it('ok:false (never throws) when the dispatch itself throws', async () => {
    const adapter = { dispatch: async () => { throw new Error('engine exploded'); } } as any;
    const res = await runPrText({ ...opts, adapter } as any);
    expect(res.ok).toBe(false);
  });
});
