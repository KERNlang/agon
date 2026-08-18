import { describe, expect, it } from 'vitest';

import { scanText, cleanText } from '../../packages/core/src/generated/text/forensics.js';

const ZWSP = '\u{200B}';
const BOM = '\u{FEFF}';
const RLO = '\u{202E}';
const PDF = '\u{202C}';
const TAG_A = '\u{E0041}';
const VS16 = '\u{FE0F}';
const ZWJ = '\u{200D}';
const CYRILLIC_A = '\u{0430}';
const FULLWIDTH_H = '\u{FF48}';

describe('text forensics — scanText', () => {
  it('reports provably clean text as clean with zero findings', () => {
    const report = scanText('Hello world. Plain ASCII, no tricks.\nSecond line.');
    expect(report.clean).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.byChannel).toEqual({});
  });

  it('detects zero-width characters with offset and hex', () => {
    const report = scanText(`ab${ZWSP}c${BOM}d`);
    expect(report.clean).toBe(false);
    const zw = report.findings.filter((f) => f.channel === 'zero-width');
    expect(zw).toHaveLength(2);
    expect(zw[0]).toMatchObject({ offset: 2, hex: 'U+200B', action: 'stripped' });
    expect(zw[1].hex).toBe('U+FEFF');
  });

  it('detects bidi override controls (Trojan-Source class)', () => {
    const report = scanText(`normal ${RLO}derev${PDF} normal`);
    const bidi = report.findings.filter((f) => f.channel === 'bidi-control');
    expect(bidi.map((f) => f.hex)).toEqual(['U+202E', 'U+202C']);
    expect(bidi.every((f) => f.action === 'stripped')).toBe(true);
  });

  it('detects tag-block steganography codepoints', () => {
    const report = scanText(`payload x${TAG_A}y`);
    const tag = report.findings.filter((f) => f.channel === 'tag-stego');
    expect(tag).toHaveLength(1);
    expect(tag[0].hex).toBe('U+E0041');
    expect(tag[0].action).toBe('stripped');
  });

  it('detects fullwidth ASCII as a normalized homoglyph', () => {
    const report = scanText(`${FULLWIDTH_H}\u{FF45}\u{FF4C}\u{FF4C}\u{FF4F}`);
    const full = report.findings.filter((f) => f.channel === 'homoglyph' && f.action === 'normalized');
    expect(full.length).toBeGreaterThanOrEqual(5);
    expect(full[0].hex).toBe('U+FF48');
  });

  it('detects mixed-script homoglyph words as reported-only', () => {
    const report = scanText(`payp${CYRILLIC_A}l`);
    const mixed = report.findings.filter((f) => f.channel === 'homoglyph' && f.action === 'reported');
    expect(mixed.length).toBeGreaterThanOrEqual(1);
    expect(mixed[0].detail).toContain('mixed-script');
  });

  it('detects whitespace-stego payload runs', () => {
    const report = scanText('word  word\ntrailing \n');
    const ws = report.findings.filter((f) => f.channel === 'whitespace-pattern');
    expect(ws.length).toBeGreaterThanOrEqual(2);
    expect(ws.every((f) => f.action === 'normalized')).toBe(true);
  });

  it('treats FE0F variation selector as legitimate (emoji) — not flagged', () => {
    const report = scanText(`emoji ❤${VS16} here`);
    expect(report.findings.filter((f) => f.channel === 'variation-selector')).toEqual([]);
  });

  it('reports text-presentation selector FE0E-adjacent selectors as reported-only', () => {
    const report = scanText(`digit 1\u{FE00} variant`);
    const vs = report.findings.filter((f) => f.channel === 'variation-selector');
    expect(vs).toHaveLength(1);
    expect(vs[0].action).toBe('reported');
  });

  it('preserves ZWJ emoji sequences (not flagged as zero-width)', () => {
    const report = scanText(`family ${ZWJ}❤️${VS16}${ZWJ} emoji`);
    expect(report.clean).toBe(true);
  });

  it('always carries the honesty caveat for keyed statistical watermarks', () => {
    const report = scanText('clean');
    expect(report.notAssessable.join(' ')).toContain('statistical watermarks');
  });
});

describe('text forensics — cleanText', () => {
  it('strips zero-width, bidi, and tag-stego codepoints', () => {
    const { output } = cleanText(`a${ZWSP}b${RLO}c${TAG_A}d`);
    expect(output).toBe('abcd');
  });

  it('folds fullwidth ASCII and collapses whitespace payloads', () => {
    const { output } = cleanText(`\u{FF48}\u{FF49}  there \nnext`);
    expect(output).toBe('hi there\nnext');
  });

  it('is byte-lossless on clean input', () => {
    const clean = `Hello world. Plain ASCII.\nLine two. Emoji ${ZWJ}❤️ ok.`;
    expect(cleanText(clean).output).toBe(clean);
  });

  it('is idempotent', () => {
    const dirty = `wo${ZWSP}rld  x${RLO}y \u{FF46}\u{FF55}\u{FF4C}\u{FF4C} trailing \n`;
    const once = cleanText(dirty).output;
    expect(cleanText(once).output).toBe(once);
  });

  it('leaves no actionable findings on re-scan (verification contract)', () => {
    const dirty = `a${ZWSP}b${RLO}${TAG_A} \u{FF58}  two  spaces \nend`;
    const { output } = cleanText(dirty);
    expect(scanText(output).clean).toBe(true);
  });

  it('returns the original findings report alongside the output', () => {
    const { report } = cleanText(`a${ZWSP}b`);
    expect(report.clean).toBe(false);
    expect(report.byChannel['zero-width']).toBe(1);
  });
});
