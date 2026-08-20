import { describe, it, expect } from 'vitest';
import { stripNonAssertionSpans, isCompletionClaim } from '../../packages/core/src/guards/evidence.js';

// stripNonAssertionSpans deletes quoted/backticked spans so demonstrated text
// can't read as a completion claim — EXCEPT when the span is itself an active
// first-person/imperative claim. Losing an arm of that carve-out (e.g.
// "I will …") silently blinds the evidence guard to a whole class of hollow
// completion claims.

describe('stripNonAssertionSpans — KEEP_CLAIM carve-out', () => {
  const KEPT = [
    "I will fix the failing test",
    "I've fixed the failing test",
    "I'll rerun the suite",
    "I'm done with the migration",
    'I have implemented the parser',
    'I already fixed it',
    'I fixed the regression',
    'I implemented the guard',
    'I completed the migration',
    'I finished the refactor',
    'let me run the tests',
    'please review this',
  ];

  for (const claim of KEPT) {
    it(`keeps a backticked span that is itself a claim: "${claim}"`, () => {
      expect(stripNonAssertionSpans(`Status: \`${claim}\``)).toContain(claim);
    });

    it(`keeps a double-quoted span that is itself a claim: "${claim}"`, () => {
      expect(stripNonAssertionSpans(`Status: "${claim}"`)).toContain(claim);
    });
  }

  it('still strips spans that are NOT claims', () => {
    const out = stripNonAssertionSpans('Run `npm test` and read "the output" carefully');
    expect(out).not.toContain('npm test');
    expect(out).not.toContain('the output');
  });

  it('strips fenced code blocks and capitalized tool enumerations', () => {
    const out = stripNonAssertionSpans('Here:\n```\nall tests pass\n```\nTools (Read/Edit/Write/Bash) used.');
    expect(out).not.toContain('all tests pass');
    expect(out).not.toContain('Read/Edit/Write/Bash');
  });

  it('keeps a quoted first-person claim visible to the completion-claim detector', () => {
    // A quoted claim that survives the strip is still claim-shaped text; a
    // quoted NON-claim must not be.
    expect(isCompletionClaim('The plan: "I fixed the failing test"')).toBe(true);
    expect(isCompletionClaim('The log said "everything works" in the demo README')).toBe(false);
  });
});
