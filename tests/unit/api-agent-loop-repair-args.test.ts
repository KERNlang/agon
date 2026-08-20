import { describe, it, expect } from 'vitest';
import { repairToolArgs } from '../../packages/core/src/api/agent-loop.js';

// repairToolArgs rescues malformed tool-call JSON. The single-quote rewrite
// is deliberately gated on "there are NO double quotes at all" — running it on
// well-formed JSON that merely CONTAINS an apostrophe (`{"path":"it's.ts"}`)
// corrupts the payload and the whole tool call is dropped.

describe('repairToolArgs', () => {
  it('leaves well-formed JSON containing apostrophes intact', () => {
    expect(repairToolArgs(`{"file": "it's-fine.ts", "note": "don't touch"}`)).toEqual({
      file: "it's-fine.ts",
      note: "don't touch",
    });
  });

  it('still rewrites single quotes when there are no double quotes at all', () => {
    expect(repairToolArgs(`{'file': 'a.ts'}`)).toEqual({ file: 'a.ts' });
  });

  it('parses plain valid JSON untouched', () => {
    expect(repairToolArgs('{"a": 1, "b": [2, 3]}')).toEqual({ a: 1, b: [2, 3] });
  });

  it('strips markdown fences', () => {
    expect(repairToolArgs('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it('removes trailing commas', () => {
    expect(repairToolArgs('{"a": 1, "b": [2, 3,],}')).toEqual({ a: 1, b: [2, 3] });
  });

  it('extracts an embedded object as a last resort', () => {
    expect(repairToolArgs('Sure! {"a": 1} — hope that helps')).toEqual({ a: 1 });
  });

  it('returns null when nothing is salvageable', () => {
    expect(repairToolArgs('not json at all')).toBeNull();
  });
});
