import { describe, expect, it } from 'vitest';

import { buildConsensus } from '../../packages/mod-review/src/consensus.js';
import type { EngineOutcome, RawFinding } from '../../packages/mod-review/src/consensus.js';

const at = (file: string, lines: string, problem: string, over: Partial<RawFinding> = {}): Omit<RawFinding, 'engine'> => ({
  severity: 'important', confidence: 0.75, file, lines, problem, ...over,
});
const seat = (engine: string, ...findings: Omit<RawFinding, 'engine'>[]): EngineOutcome => ({
  engine, status: 'ok', findings: findings.map((f) => ({ engine, ...f })),
});

const SQLI = [
  'Caller-controlled name is interpolated directly into the SQL statement, enabling SQL injection.',
  'SQL injection: user-controlled name is interpolated directly into the SQL string instead of a bound parameter.',
  'Direct interpolation of name into SQL permits SQL injection and breaks names containing quotes.',
];

describe('mod-review fuzzy clustering', () => {
  it('merges differently worded reports of one bug on the same line into one pair-voted finding', () => {
    const report = buildConsensus(SQLI.map((p, i) => seat(`e${i}`, at('src/users.ts', '5', p))));
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ engines: ['e0', 'e1', 'e2'], pairVotes: 3, blocks: true });
  });

  it('merges reports whose line ranges touch within two lines', () => {
    const report = buildConsensus([
      seat('a', at('src/store.ts', '4', 'saveAll does not await writeFile so it resolves before the write completes')),
      seat('b', at('src/store.ts', '5-6', 'The writeFile promise is not awaited so saveAll resolves before the write completes')),
    ]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].engines).toEqual(['a', 'b']);
  });

  it('keeps two distinct bugs on the same line apart', () => {
    const report = buildConsensus([
      seat('a', at('src/pager.ts', '3', "Off-by-one: '<=' includes i === items.length, appending an empty page whenever items.length is a multiple of size.")),
      seat('b', at('src/pager.ts', '3', 'The inclusive loop bound appends an extra empty page for empty input and whenever the item count divides evenly.')),
      seat('c', at('src/pager.ts', '3', 'Off-by-one: <= emits trailing empty page when items.length % size === 0 and [[]] for empty input.')),
      seat('d', at('src/pager.ts', '3', 'A zero or negative page size is not rejected and can make the loop non-terminating.')),
      seat('e', at('src/pager.ts', '3', 'size <= 0 makes i += size never advance, causing an infinite loop.')),
    ]);
    expect(report.findings).toHaveLength(2);
    expect(report.findings.map((f) => f.engines).sort()).toEqual([['a', 'b', 'c'], ['d', 'e']]);
  });

  it('never merges across files or far-apart lines', () => {
    const report = buildConsensus([
      seat('a', at('src/users.ts', '5', SQLI[0])),
      seat('b', at('src/admin.ts', '5', SQLI[1])),
      seat('c', at('src/users.ts', '40', SQLI[2])),
    ]);
    expect(report.findings).toHaveLength(3);
    expect(report.blockers).toHaveLength(0);
  });

  it('does not merge short findings that share only generic words', () => {
    const report = buildConsensus([
      seat('a', at('src/x.ts', '5', 'missing return value check')),
      seat('b', at('src/x.ts', '5', 'missing bounds check')),
    ]);
    expect(report.findings).toHaveLength(2);
    expect(report.blockers).toHaveLength(0);
  });

  it('reads line:column as one line, not a range', () => {
    const report = buildConsensus([
      seat('a', at('src/x.ts', '40:3', SQLI[0])),
      seat('b', at('src/x.ts', '10', SQLI[1])),
    ]);
    expect(report.findings).toHaveLength(2);
  });

  it('does not let a chain of nearby findings drag the window to far lines', () => {
    const report = buildConsensus([
      seat('a', at('src/x.ts', '10', SQLI[0])),
      seat('b', at('src/x.ts', '12', SQLI[1])),
      seat('c', at('src/x.ts', '14', SQLI[2])),
    ]);
    expect(report.findings.map((f) => f.engines)).toEqual([['a', 'b'], ['c']]);
  });

  it('keeps two nearby findings from the same engine apart', () => {
    const report = buildConsensus([seat('a', at('src/users.ts', '5', SQLI[0]), at('src/users.ts', '6', SQLI[1]))]);
    expect(report.findings).toHaveLength(2);
  });

  it('matches inflected forms of the same word', () => {
    const report = buildConsensus([
      seat('a', at('src/store.ts', '4', 'saveAll writes the file but resolves early, losing promises')),
      seat('b', at('src/store.ts', '4', 'saveAll should write the file before it can resolve; the promise is lost')),
    ]);
    expect(report.findings).toHaveLength(1);
  });

  it('keeps exact-key clustering for findings without line numbers', () => {
    const report = buildConsensus([
      seat('a', at('src/a.ts', '', 'missing input validation on the request body')),
      seat('b', at('src/a.ts', '', 'missing input validation on the request body')),
      seat('c', at('src/a.ts', '', 'request body validation is missing for this handler')),
    ]);
    expect(report.findings.map((f) => f.engines)).toEqual([['a', 'b'], ['c']]);
  });

  it('does not let an exact-key match bypass the line limit after a fuzzy merge', () => {
    const problem = 'SQL injection user controlled name enters SQL statement';
    const report = buildConsensus([
      seat('a', at('src/q.ts', '8', problem)),
      seat('b', at('src/q.ts', '10', problem)),
      seat('c', at('src/q.ts', '18', problem)),
    ]);
    expect(report.findings.map((f) => f.engines)).toEqual([['a', 'b'], ['c']]);
  });
});
