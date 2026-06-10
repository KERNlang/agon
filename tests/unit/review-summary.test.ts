import { describe, it, expect } from 'vitest';
import {
  stripMachineBlock,
  reviewOutcome,
  buildReviewConsensusLines,
  formatReviewCounts,
} from '../../packages/cli/src/generated/handlers/review.js';
import { buildConsensus } from '../../packages/cli/src/generated/blocks/consensus.js';

const SENTINEL = '<!--AGON_REVIEW_FINDINGS_v1-->';

describe('stripMachineBlock', () => {
  it('removes the sentinel + JSON tail so the pager shows clean prose', () => {
    const full = `Here is my review.\nLooks good.\n\n${SENTINEL}\n\`\`\`json\n[{"severity":"nit","problem":"x"}]\n\`\`\``;
    const stripped = stripMachineBlock(full);
    expect(stripped).toContain('Here is my review.');
    expect(stripped).toContain('Looks good.');
    expect(stripped).not.toContain(SENTINEL);
    expect(stripped).not.toContain('"severity"');
  });

  it('is a no-op when there is no sentinel', () => {
    const prose = 'Just prose, no machine block.';
    expect(stripMachineBlock(prose)).toBe(prose);
  });

  it('strips from the LAST sentinel (repair-appended blocks)', () => {
    const full = `prose ${SENTINEL} junk ${SENTINEL}\n[]`;
    expect(stripMachineBlock(full)).toBe(`prose ${SENTINEL} junk`);
  });
});

describe('reviewOutcome', () => {
  it('parses structured findings for an ok engine', () => {
    const response = `review\n\n${SENTINEL}\n\`\`\`json\n[{"file":"a.ts","lines":"1","severity":"important","blocking":false,"confidence":0.8,"problem":"p"}]\n\`\`\``;
    const outcome = reviewOutcome('codex', response, 'ok');
    expect(outcome.status).toBe('ok');
    expect(outcome.findings).toHaveLength(1);
    expect(outcome.findings[0].engine).toBe('codex');
    expect(outcome.findings[0].file).toBe('a.ts');
    expect(outcome.findings[0].severity).toBe('important');
  });

  it('routes a non-ok engine to the failure lane with no findings, carrying the note', () => {
    const outcome = reviewOutcome('claude', 'whatever', 'timeout', 'exceeded 600s');
    expect(outcome.status).toBe('timeout');
    expect(outcome.findings).toEqual([]);
    expect(outcome.note).toBe('exceeded 600s');
  });

  it('feeds buildConsensus so a single ok engine produces a tiered report', () => {
    const response = `review\n\n${SENTINEL}\n[{"file":"a.ts","lines":"5","severity":"nit","blocking":false,"confidence":0.5,"problem":"trivial"}]`;
    const consensus = buildConsensus([reviewOutcome('codex', response, 'ok')] as any);
    expect(consensus.okCount).toBe(1);
    expect(consensus.nits).toHaveLength(1);
    expect(consensus.autoBlock).toBe(false);
  });
});

describe('buildReviewConsensusLines', () => {
  it('renders the tiered summary header', () => {
    const response = `review\n\n${SENTINEL}\n[{"file":"a.ts","lines":"5","severity":"nit","blocking":false,"confidence":0.5,"problem":"trivial nit here"}]`;
    const consensus = buildConsensus([reviewOutcome('codex', response, 'ok')] as any);
    const lines = buildReviewConsensusLines(consensus);
    expect(lines[0]).toContain('Consensus —');
    expect(lines.join('\n')).toContain('NITS: 1.');
  });

  it('attributes a verified finding with engine badges (not ×N) and keeps the tier label backward-compatible', () => {
    // Two engines pair-block the same anchored important finding → verified row.
    const block = (engine: string) =>
      `review\n\n${SENTINEL}\n[{"file":"a.ts","lines":"42","severity":"important","blocking":false,"confidence":0.75,"problem":"missing null guard on user object"}]`;
    const consensus = buildConsensus([
      reviewOutcome('codex', block('codex'), 'ok'),
      reviewOutcome('kimi-for-coding-k2p6', block('kimi-for-coding-k2p6'), 'ok'),
    ] as any);
    const text = buildReviewConsensusLines(consensus).join('\n');
    expect(text).toContain('VERIFIED (actionable):');   // tier label unchanged
    expect(text).toContain('[codex]');                   // engine attribution
    expect(text).toContain('[kimi]');
    expect(text).not.toMatch(/×\d/);                     // ×N replaced by badges
  });

  it('renders a disputed cluster with a ⚠ DISPUTED prefix and indented per-engine stances', () => {
    const blocking = `review\n\n${SENTINEL}\n[{"file":"a.ts","lines":"42","severity":"blocking","blocking":true,"confidence":0.9,"problem":"unbounded recursion on cyclic input"}]`;
    const nit = `review\n\n${SENTINEL}\n[{"file":"a.ts","lines":"42","severity":"nit","blocking":false,"confidence":0.4,"problem":"unbounded recursion on cyclic input"}]`;
    const consensus = buildConsensus([
      reviewOutcome('claude', blocking, 'ok'),
      reviewOutcome('codex', nit, 'ok'),
    ] as any);
    const text = buildReviewConsensusLines(consensus).join('\n');
    expect(text).toContain('⚠ DISPUTED');
    expect(text).toContain('↳ claude: blocking');
    expect(text).toContain('↳ codex: nit');
  });
});

describe('formatReviewCounts', () => {
  it('omits zero categories and pluralizes nits', () => {
    expect(formatReviewCounts({ blocking: 0, important: 2, nit: 3, total: 5 })).toBe('2 important, 3 nits');
    expect(formatReviewCounts({ blocking: 1, important: 0, nit: 1, total: 2 })).toBe('1 blocking, 1 nit');
  });

  it('returns "no findings" for an empty or missing count', () => {
    expect(formatReviewCounts({ blocking: 0, important: 0, nit: 0, total: 0 })).toBe('no findings');
    expect(formatReviewCounts(undefined)).toBe('no findings');
  });
});
