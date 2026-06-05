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

  it('routes a non-ok engine to the failure lane with no findings', () => {
    const outcome = reviewOutcome('claude', 'whatever', 'timeout');
    expect(outcome.status).toBe('timeout');
    expect(outcome.findings).toEqual([]);
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
