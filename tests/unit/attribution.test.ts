// appendAttribution / appendPrAttribution — the Claude-Code-1:1 attribution
// block on commits agon creates (Generated-with paragraph + Co-Authored-By
// trailer) and the PR-body footer, both gated by the single commitCoAuthor
// opt-out switch.

import { describe, expect, it } from 'vitest';

import { AGON_ATTRIBUTION, AGON_ATTRIBUTION_PR, appendAttribution, appendPrAttribution } from '../../packages/core/src/git.js';

const id = 'agon (KERN) <noreply@kernlang.dev>';

describe('appendAttribution (commit footer, Claude Code layout)', () => {
  it('appends the Generated-with paragraph then the trailer as the final paragraph', () => {
    const out = appendAttribution('feat: do thing', { commitCoAuthor: id });
    expect(out).toBe(`feat: do thing\n\n${AGON_ATTRIBUTION}\n\nCo-Authored-By: ${id}`);
  });

  it('is a no-op when commitCoAuthor is unset/blank (the single opt-out switch)', () => {
    expect(appendAttribution('feat: do thing', {})).toBe('feat: do thing');
    expect(appendAttribution('feat: do thing', { commitCoAuthor: '' })).toBe('feat: do thing');
    expect(appendAttribution('feat: do thing', { commitCoAuthor: '   ' })).toBe('feat: do thing');
  });

  it('keeps the trailer alone in the last paragraph even on multi-paragraph messages', () => {
    const msg = 'fix: subject\n\nlonger body explaining why.';
    const out = appendAttribution(msg, { commitCoAuthor: id });
    const paragraphs = out.split(/\n\s*\n/);
    expect(paragraphs[paragraphs.length - 1]).toBe(`Co-Authored-By: ${id}`);
    expect(paragraphs[paragraphs.length - 2]).toBe(AGON_ATTRIBUTION);
  });

  it('trims trailing whitespace from the message before appending', () => {
    const out = appendAttribution('feat: do thing\n\n', { commitCoAuthor: id });
    expect(out.startsWith('feat: do thing\n\n⚔️')).toBe(true);
  });

  it('commit footer is plain text (no markdown image — commit messages render as text)', () => {
    expect(AGON_ATTRIBUTION).not.toContain('<img');
  });
});

describe('appendPrAttribution (PR-body footer)', () => {
  it('appends only the Generated-with line — no Co-Authored-By in PR bodies', () => {
    const out = appendPrAttribution('## Summary\nstuff', { commitCoAuthor: id });
    expect(out).toBe(`## Summary\nstuff\n\n${AGON_ATTRIBUTION_PR}`);
    expect(out).not.toContain('Co-Authored-By');
  });

  it('PR footer shows the AGON logo via the KERN-Agon avatar URL (markdown context)', () => {
    expect(AGON_ATTRIBUTION_PR).toContain('https://github.com/KERN-Agon.png');
    expect(AGON_ATTRIBUTION_PR).toContain('[Agon](https://github.com/KERNlang/agon)');
  });

  it('is a no-op when opted out', () => {
    expect(appendPrAttribution('body', { commitCoAuthor: '' })).toBe('body');
    expect(appendPrAttribution('body', {})).toBe('body');
  });
});
