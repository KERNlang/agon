import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as research from '@kernlang/agon-mod-research';
import { extractCitations, judgeProbe, formatCitationReport } from '../../packages/core/src/tools/research-verifier.js';

const historical = { extractCitations, judgeProbe, formatCitationReport };

describe('Research citation policy ownership', () => {
  it('records the declaration destination without claiming network retirement', () => {
    const ledger = JSON.parse(readFileSync(new URL('../../docs/specs/evidence/modular-agon-slice5-migration-ledger.json', import.meta.url), 'utf8'));
    const row = ledger.assignments.find((entry: { id: string; package: string }) =>
      entry.id === 'CitationVerdict' && entry.package === '@kernlang/agon-mod-research');
    expect(row).toMatchObject({
      implementationPaths: ['packages/mod-research/src/citation-policy.ts'],
      compatibilityAdapter: 'packages/core/src/tools/research-verifier.ts',
      legacyPresent: true,
      authority: 'legacy-runtime-until-s6',
    });
  });

  it.each(['extractCitations', 'judgeProbe', 'formatCitationReport'] as const)(
    'Core delegates %s to its physical Research owner', name => {
      const owned = Reflect.get(research, name);
      expect(owned).toBeTypeOf('function');
      expect(historical[name]).toBe(owned);
    },
  );

  it('preserves literal URLs and historical verdict/report fields', () => {
    const urls = extractCitations('(see https://en.wikipedia.org/wiki/Foo_(bar)). https://example.com/page');
    expect(urls).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)', 'https://example.com/page']);
    const verdict = judgeProbe({ url: urls[1], ok: true, status: 200,
      finalUrl: urls[1], crossHostRedirect: false, sample: 'cooking pasta' }, ['quantum']);
    expect(verdict).toEqual({ url: urls[1], verdict: 'irrelevant', httpStatus: 200,
      finalUrl: urls[1], detail: 'page text does not mention the cited terms' });
    const blocked = judgeProbe({ url: urls[0], ok: true, status: 999,
      finalUrl: urls[0], crossHostRedirect: false, sample: '' });
    expect(blocked.verdict).toBe('blocked');
    const report = { total: 2, verified: 0, rejected: 1, blocked: 1, results: [verdict, blocked] };
    expect(formatCitationReport(report)).toContain('Citations: 0/2 verified · 1 blocked');
    expect(formatCitationReport(report)).toContain('✗ [irrelevant]');
    expect(formatCitationReport(report)).toContain('⚠ [blocked]');
  });
});
