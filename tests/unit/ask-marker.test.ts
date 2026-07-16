import { describe, expect, it } from 'vitest';
import { parseAskMarker } from '../../packages/cli/src/generated/cesar/ask-marker.js';
import { createAskDisplayStripper } from '../../packages/cli/src/generated/cesar/brain-helpers.js';

const block = (body: string) => `[ASK]\n${body}\n[/ASK]`;

describe('parseAskMarker — structured [ASK] marker parser', () => {
  it('parses a well-formed block and strips it from rest', () => {
    const text = [
      'Two viable backends here.',
      block('{"question":"Which storage backend?","options":[{"label":"SQLite","description":"zero deps"},{"label":"Postgres","description":"needs a server"}]}'),
    ].join('\n');
    const r = parseAskMarker(text);
    expect(r.found).toBe(true);
    expect(r.ask).not.toBeNull();
    expect(r.ask!.question).toBe('Which storage backend?');
    expect(r.ask!.options).toHaveLength(2);
    expect(r.ask!.options[0]).toEqual({ label: 'SQLite', description: 'zero deps' });
    expect(r.rest).toBe('Two viable backends here.');
    expect(r.rest).not.toContain('[ASK]');
  });

  it('returns found:false and untouched rest when no block present', () => {
    const text = 'Just a normal answer.';
    const r = parseAskMarker(text);
    expect(r.found).toBe(false);
    expect(r.ask).toBeNull();
    expect(r.rest).toBe(text);
  });

  it('treats malformed JSON as found-but-null so the caller can warn', () => {
    const r = parseAskMarker(block('{question: "oops", options: [}'));
    expect(r.found).toBe(true);
    expect(r.ask).toBeNull();
    expect(r.rest).not.toContain('[ASK]');
  });

  it('rejects a block with fewer than 2 valid options', () => {
    const r = parseAskMarker(block('{"question":"Pick?","options":[{"label":"Only one"}]}'));
    expect(r.found).toBe(true);
    expect(r.ask).toBeNull();
  });

  it('rejects a block with a missing or empty question', () => {
    const r = parseAskMarker(block('{"options":[{"label":"A"},{"label":"B"}]}'));
    expect(r.ask).toBeNull();
    const r2 = parseAskMarker(block('{"question":"  ","options":[{"label":"A"},{"label":"B"}]}'));
    expect(r2.ask).toBeNull();
  });

  it('skips invalid option entries and keeps valid ones', () => {
    const r = parseAskMarker(block('{"question":"Pick?","options":[{"label":"A"},null,{"nope":1},{"label":"B","description":42}]}'));
    expect(r.ask).not.toBeNull();
    expect(r.ask!.options).toHaveLength(2);
    // Non-string description is stringified, not dropped.
    expect(r.ask!.options[1]).toEqual({ label: 'B', description: '42' });
  });

  it('caps options at 6', () => {
    const options = Array.from({ length: 9 }, (_, i) => ({ label: `Option ${i + 1}` }));
    const r = parseAskMarker(block(JSON.stringify({ question: 'Pick?', options })));
    expect(r.ask!.options).toHaveLength(6);
    expect(r.ask!.options[5].label).toBe('Option 6');
  });

  it('last well-formed block wins; all blocks are stripped', () => {
    const text = [
      block('{"question":"First?","options":[{"label":"A"},{"label":"B"}]}'),
      'some prose',
      block('{"question":"Second?","options":[{"label":"C"},{"label":"D"}]}'),
    ].join('\n');
    const r = parseAskMarker(text);
    expect(r.ask!.question).toBe('Second?');
    expect(r.rest).toBe('some prose');
  });

  it('a later malformed block does not clobber an earlier well-formed one', () => {
    const text = [
      block('{"question":"Good?","options":[{"label":"A"},{"label":"B"}]}'),
      block('{broken'),
    ].join('\n');
    const r = parseAskMarker(text);
    expect(r.ask).not.toBeNull();
    expect(r.ask!.question).toBe('Good?');
  });

  it('clamps overlong question, label, and description', () => {
    const long = 'x'.repeat(500);
    const r = parseAskMarker(block(JSON.stringify({
      question: long,
      options: [{ label: long, description: long }, { label: 'B' }],
    })));
    expect(r.ask!.question.length).toBeLessThanOrEqual(300);
    expect(r.ask!.question.endsWith('…')).toBe(true);
    expect(r.ask!.options[0].label.length).toBeLessThanOrEqual(100);
    expect(r.ask!.options[0].description!.length).toBeLessThanOrEqual(200);
  });

  it('is case-insensitive on the marker tags', () => {
    const r = parseAskMarker('[ask]{"question":"Q?","options":[{"label":"A"},{"label":"B"}]}[/ask]');
    expect(r.found).toBe(true);
    expect(r.ask!.question).toBe('Q?');
  });
});

describe('createAskDisplayStripper — native-path streaming stripper', () => {
  it('strips a complete block within one chunk', () => {
    const strip = createAskDisplayStripper();
    expect(strip('before [ASK]{"q":1}[/ASK] after')).toBe('before  after');
  });

  it('suppresses an open block across chunks and resumes after the close tag', () => {
    const strip = createAskDisplayStripper();
    expect(strip('text [ASK]{"question":')).toBe('text ');
    expect(strip('"Q?","options":[]}')).toBe('');
    expect(strip('[/ASK] tail')).toBe(' tail');
  });

  it('holds a partial open marker split across chunks', () => {
    const strip = createAskDisplayStripper();
    expect(strip('see [AS')).toBe('see ');
    expect(strip('K]hidden[/ASK]visible')).toBe('visible');
  });

  it('holds a partial close marker split across chunks without latching open', () => {
    const strip = createAskDisplayStripper();
    strip('[ASK]body [/AS');
    expect(strip('K]done')).toBe('done');
  });

  it('force flush returns a held legit prefix verbatim at stream end', () => {
    const strip = createAskDisplayStripper();
    expect(strip('trailing [')).toBe('trailing ');
    expect(strip('', true)).toBe('[');
  });
});
