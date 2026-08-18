import { describe, expect, it } from 'vitest';

import {
  scanMetadata,
  stripMetadata,
  countsByChannelMetadata,
} from '../../packages/core/src/generated/text/metadata-forensics.js';

// ── fixtures (hand-built, deterministic) ────────────────────────────────────

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4); // CRC value is not validated by our scanner
  return Buffer.concat([len, typeBuf, data, crc]);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makePng(withProvenance: boolean): Buffer {
  const ihdr = pngChunk('IHDR', Buffer.alloc(13));
  const idat = pngChunk('IDAT', Buffer.from([1, 2, 3]));
  const iend = pngChunk('IEND', Buffer.alloc(0));
  if (!withProvenance) return Buffer.concat([PNG_SIG, ihdr, idat, iend]);
  const cabx = pngChunk('caBX', Buffer.from('fake-jumbf-c2pa-manifest', 'latin1'));
  const xmpKeyword = Buffer.from('XML:com.adobe.xmp', 'latin1');
  const itxt = pngChunk('iTXt', Buffer.concat([xmpKeyword, Buffer.from([0]), Buffer.from('<x:xmpmeta/>', 'latin1')]));
  const exif = pngChunk('eXIf', Buffer.from('Exif-payload', 'latin1'));
  return Buffer.concat([PNG_SIG, ihdr, cabx, itxt, exif, idat, iend]);
}

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2, 0);
  return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
}

function makeJpeg(withProvenance: boolean): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x02]);
  const scanData = Buffer.from([0x11, 0x22, 0x33]);
  if (!withProvenance) return Buffer.concat([soi, sos, scanData]);
  const exif = jpegSegment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.alloc(8)]));
  const xmp = jpegSegment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\u0000<x:xmpmeta/>', 'latin1'));
  const c2pa = jpegSegment(0xeb, Buffer.from('..jumbf....c2pa-manifest', 'latin1'));
  return Buffer.concat([soi, exif, xmp, c2pa, sos, scanData]);
}

const SVG_PROVENANCE = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
<metadata>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description xmp:CreatorTool="Claude"/></rdf:RDF></x:xmpmeta>
</metadata>
<rect width="10" height="10" fill="red"/>
</svg>`;

const SVG_CLEAN = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>`;

// ── PNG ─────────────────────────────────────────────────────────────────────

describe('metadata-forensics — PNG', () => {
  it('clean PNG scans clean', () => {
    const report = scanMetadata(makePng(false));
    expect(report.format).toBe('png');
    expect(report.clean).toBe(true);
    expect(report.findings).toHaveLength(0);
  });

  it('detects caBX (C2PA), XMP iTXt, and eXIf chunks', () => {
    const report = scanMetadata(makePng(true));
    expect(report.clean).toBe(false);
    const channels = report.findings.map((f) => f.channel).sort();
    expect(channels).toEqual(['c2pa-manifest', 'exif-metadata', 'xmp-packet']);
  });

  it('strip removes provenance chunks and re-scan verifies clean', () => {
    const input = makePng(true);
    const stripped = stripMetadata(input);
    expect(stripped.output.length).toBeLessThan(input.length);
    const verify = scanMetadata(stripped.output);
    expect(verify.clean).toBe(true);
    // image data chunks survive
    expect(stripped.output.includes('IDAT')).toBe(true);
    expect(stripped.output.includes('IEND')).toBe(true);
  });

  it('strip on clean PNG is byte-identical', () => {
    const input = makePng(false);
    const stripped = stripMetadata(input);
    expect(Buffer.compare(stripped.output, input)).toBe(0);
  });
});

// ── JPEG ────────────────────────────────────────────────────────────────────

describe('metadata-forensics — JPEG', () => {
  it('clean JPEG scans clean', () => {
    const report = scanMetadata(makeJpeg(false));
    expect(report.format).toBe('jpeg');
    expect(report.clean).toBe(true);
  });

  it('detects Exif APP1, XMP APP1, and C2PA APP11/JUMBF segments', () => {
    const report = scanMetadata(makeJpeg(true));
    expect(report.clean).toBe(false);
    const channels = report.findings.map((f) => f.channel).sort();
    expect(channels).toEqual(['c2pa-manifest', 'exif-metadata', 'xmp-packet']);
  });

  it('strip removes provenance segments and preserves scan data', () => {
    const input = makeJpeg(true);
    const stripped = stripMetadata(input);
    const verify = scanMetadata(stripped.output);
    expect(verify.clean).toBe(true);
    // SOI + SOS + entropy data survive
    expect(stripped.output[0]).toBe(0xff);
    expect(stripped.output[1]).toBe(0xd8);
    expect(stripped.output.includes(Buffer.from([0x11, 0x22, 0x33]))).toBe(true);
  });

  it('strip on clean JPEG is byte-identical', () => {
    const input = makeJpeg(false);
    const stripped = stripMetadata(input);
    expect(Buffer.compare(stripped.output, input)).toBe(0);
  });
});

// ── SVG ─────────────────────────────────────────────────────────────────────

describe('metadata-forensics — SVG', () => {
  it('clean SVG scans clean', () => {
    const report = scanMetadata(Buffer.from(SVG_CLEAN, 'utf8'));
    expect(report.format).toBe('svg');
    expect(report.clean).toBe(true);
  });

  it('detects XMP provenance inside <metadata>', () => {
    const report = scanMetadata(Buffer.from(SVG_PROVENANCE, 'utf8'));
    expect(report.clean).toBe(false);
    expect(report.findings.some((f) => f.channel === 'xmp-packet')).toBe(true);
  });

  it('strip removes the metadata block and keeps the drawing', () => {
    const stripped = stripMetadata(Buffer.from(SVG_PROVENANCE, 'utf8'));
    const text = stripped.output.toString('utf8');
    expect(text).not.toContain('<metadata>');
    expect(text).not.toContain('xmpmeta');
    expect(text).toContain('<rect');
    const verify = scanMetadata(stripped.output);
    expect(verify.clean).toBe(true);
  });
});

// ── honesty contract + unknown formats ──────────────────────────────────────

describe('metadata-forensics — honesty contract', () => {
  it('always lists pixel-level watermarks as not assessable', () => {
    const report = scanMetadata(makePng(false));
    expect(report.notAssessable.some((s) => s.includes('pixel'))).toBe(true);
  });

  it('unknown formats are NOT clean — unexamined is not clean (honesty contract)', () => {
    const report = scanMetadata(Buffer.from('plain text file, not an image', 'utf8'));
    expect(report.format).toBe('unknown');
    expect(report.clean).toBe(false);
    expect(report.notAssessable.some((s) => s.includes('unrecognized file format'))).toBe(true);
  });

  it('strip on unknown format is byte-identical passthrough', () => {
    const input = Buffer.from('plain text file', 'utf8');
    const stripped = stripMetadata(input);
    expect(Buffer.compare(stripped.output, input)).toBe(0);
  });

  it('countsByChannelMetadata tallies findings per channel', () => {
    const report = scanMetadata(makePng(true));
    const counts = countsByChannelMetadata(report.findings);
    expect(counts['c2pa-manifest']).toBe(1);
    expect(counts['xmp-packet']).toBe(1);
    expect(counts['exif-metadata']).toBe(1);
  });
});

describe('metadata-forensics — review-fix regressions', () => {
  it('UTF-8 BOM-prefixed SVG is detected as svg, not unknown', () => {
    const bommed = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SVG_PROVENANCE, 'utf8')]);
    const report = scanMetadata(bommed);
    expect(report.format).toBe('svg');
    expect(report.clean).toBe(false);
    expect(report.findings.some((f) => f.channel === 'xmp-packet')).toBe(true);
  });

  it('JPEG with 0xFF fill bytes before markers stays in sync', () => {
    const fill = Buffer.from([0xff, 0xff, 0xff]); // padding before a real segment
    const exif = jpegSegment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.alloc(8)]));
    const sos = Buffer.from([0xff, 0xda, 0x00, 0x02]);
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), fill, exif, sos, Buffer.from([0xaa])]);
    const report = scanMetadata(jpg);
    expect(report.format).toBe('jpeg');
    expect(report.findings.some((f) => f.channel === 'exif-metadata')).toBe(true);
    // strip keeps the fill bytes and scan data intact, removes the Exif segment
    const stripped = stripMetadata(jpg);
    expect(scanMetadata(stripped.output).clean).toBe(true);
    expect(stripped.output.includes(Buffer.from([0xaa]))).toBe(true);
  });

  it('JUMBF superbox detected via 4-char jumb box type', () => {
    const jumb = jpegSegment(0xeb, Buffer.from('xxxxxjumbxxxxxxxx', 'latin1')); // 'jumb' w/o 'c2pa' string
    const sos = Buffer.from([0xff, 0xda, 0x00, 0x02]);
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), jumb, sos, Buffer.from([0xbb])]);
    const report = scanMetadata(jpg);
    expect(report.findings.some((f) => f.channel === 'c2pa-manifest')).toBe(true);
  });

  it('nested <x:xmpmeta> inside <metadata> produces ONE finding, not two', () => {
    const report = scanMetadata(Buffer.from(SVG_PROVENANCE, 'utf8'));
    const xmpFindings = report.findings.filter((f) => f.channel === 'xmp-packet');
    expect(xmpFindings).toHaveLength(1);
  });

  it('truncated APP1 segment (< 6 bytes payload) does not read out of segment', () => {
    const tiny = jpegSegment(0xe1, Buffer.from('Ex', 'latin1'));
    const sos = Buffer.from([0xff, 0xda, 0x00, 0x02]);
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), tiny, sos, Buffer.from([0xcc])]);
    const report = scanMetadata(jpg);
    expect(report.clean).toBe(true); // misclassified, but no crash / no desync
  });
});
