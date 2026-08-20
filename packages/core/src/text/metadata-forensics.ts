export interface MetadataFinding {
  offset: number;
  length: number;
  channel: string;
  action: string;
  detail: string;
}

export interface MetadataScanReport {
  format: string;
  findings: MetadataFinding[];
  byChannel: Record<string,number>;
  clean: boolean;
  notAssessable: string[];
}

export interface MetadataStripResult {
  output: Buffer;
  report: MetadataScanReport;
}

export const METADATA_NOT_ASSESSABLE: string[] = [
  'pixel/frequency-domain image watermarks (e.g. SynthID-style) — undetectable without the generator key or detector',
  're-encoded or stripped provenance — absence of C2PA metadata is not proof of human origin',
];

export function countsByChannelMetadata(findings: MetadataFinding[]): Record<string,number> {
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.channel] = (counts[f.channel] ?? 0) + 1;
  return counts;
}

/**
 * Sniff the file magic: png | jpeg | unknown.
 */
export function detectBinaryFormat(buf: Buffer): string {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'png';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  return 'unknown';
}

export function scanPng(buf: Buffer): MetadataFinding[] {
  const findings: MetadataFinding[] = [];
  let pos = 8;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const dataStart = pos + 8;
    const chunkEnd = dataStart + len + 4; // + CRC
    if (chunkEnd > buf.length) break;
    if (type === 'caBX') {
      findings.push({ offset: pos, length: chunkEnd - pos, channel: 'c2pa-manifest', action: 'strip', detail: 'C2PA manifest store (caBX chunk) — signed provenance metadata' });
    } else if (type === 'iTXt') {
      const chunkDataEnd = dataStart + len;
      let keywordEnd = buf.indexOf(0x00, dataStart);
      if (keywordEnd < 0 || keywordEnd > Math.min(chunkDataEnd, dataStart + 80)) keywordEnd = Math.min(chunkDataEnd, dataStart + 80);
      const keyword = buf.toString('latin1', dataStart, keywordEnd);
      if (keyword === 'XML:com.adobe.xmp') {
        findings.push({ offset: pos, length: chunkEnd - pos, channel: 'xmp-packet', action: 'strip', detail: 'XMP metadata packet (iTXt chunk) — may carry provenance/creator-tool fields' });
      }
    } else if (type === 'eXIf') {
      findings.push({ offset: pos, length: chunkEnd - pos, channel: 'exif-metadata', action: 'strip', detail: 'Exif metadata (eXIf chunk) — camera/software provenance' });
    }
    pos = chunkEnd;
    if (type === 'IEND') break;
  }
  return findings;
}

export function stripPng(buf: Buffer): Buffer {
  const parts: Buffer[] = [buf.subarray(0, 8)];
  let pos = 8;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const chunkEnd = pos + 8 + len + 4;
    if (chunkEnd > buf.length) { parts.push(buf.subarray(pos)); pos = buf.length; break; }
    const drop = type === 'caBX' || type === 'eXIf' ||
      (type === 'iTXt' && buf.toString('latin1', pos + 8, Math.min(buf.indexOf(0x00, pos + 8), pos + 88)) === 'XML:com.adobe.xmp');
    if (!drop) parts.push(buf.subarray(pos, chunkEnd));
    pos = chunkEnd;
    if (type === 'IEND') break;
  }
  if (pos < buf.length) parts.push(buf.subarray(pos));
  return Buffer.concat(parts);
}

/**
 * Classify a JPEG APPn payload: c2pa | xmp | exif | empty (keep).
 */
export function jpegSegmentKind(buf: Buffer, dataStart: number, payloadLen: number): string {
  if (payloadLen <= 0) return '';
  if (payloadLen >= 6 && buf.toString('latin1', dataStart, dataStart + 4) === 'Exif' &&
      buf[dataStart + 4] === 0 && buf[dataStart + 5] === 0) return 'exif';
  if (payloadLen >= 29 && buf.toString('latin1', dataStart, dataStart + 29) === 'http://ns.adobe.com/xap/1.0/\u0000') return 'xmp';
  // JUMBF (C2PA): the superbox type is the 4-char 'jumb' ('jumd' for the
  // description box); the 'c2pa' label lives in the description box. Match
  // all three in the payload head.
  const head = buf.toString('latin1', dataStart, dataStart + Math.min(payloadLen, 64));
  if (head.includes('jumb') || head.includes('c2pa')) return 'c2pa';
  return '';
}

export function scanJpeg(buf: Buffer): MetadataFinding[] {
  const findings: MetadataFinding[] = [];
  let pos = 2; // after SOI
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) break; // scan data — stop walking segments
    const marker = buf[pos + 1];
    if (marker === 0xff) { pos += 1; continue; } // fill/padding byte before a marker
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
    const len = buf.readUInt16BE(pos + 2);
    const dataStart = pos + 4;
    const segEnd = pos + 2 + len;
    if (segEnd > buf.length) break;
    if (marker === 0xe1) { // APP1
      const kind = jpegSegmentKind(buf, dataStart, len - 2);
      if (kind === 'xmp') findings.push({ offset: pos, length: segEnd - pos, channel: 'xmp-packet', action: 'strip', detail: 'XMP metadata packet (APP1) — may carry provenance/creator-tool fields' });
      else if (kind === 'exif') findings.push({ offset: pos, length: segEnd - pos, channel: 'exif-metadata', action: 'strip', detail: 'Exif metadata (APP1) — camera/software provenance' });
    } else if (marker === 0xeb) { // APP11
      const kind = jpegSegmentKind(buf, dataStart, len - 2);
      if (kind === 'c2pa') findings.push({ offset: pos, length: segEnd - pos, channel: 'c2pa-manifest', action: 'strip', detail: 'C2PA manifest store (APP11/JUMBF) — signed provenance metadata' });
    }
    if (marker === 0xda) break; // start of scan — entropy data follows
    pos = segEnd;
  }
  return findings;
}

export function stripJpeg(buf: Buffer): Buffer {
  const parts: Buffer[] = [buf.subarray(0, 2)];
  let pos = 2;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) { parts.push(buf.subarray(pos)); pos = buf.length; break; }
    const marker = buf[pos + 1];
    if (marker === 0xff) { parts.push(buf.subarray(pos, pos + 1)); pos += 1; continue; } // fill byte
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { parts.push(buf.subarray(pos, pos + 2)); pos += 2; continue; }
    const len = buf.readUInt16BE(pos + 2);
    const segEnd = pos + 2 + len;
    if (segEnd > buf.length) { parts.push(buf.subarray(pos)); pos = buf.length; break; }
    let drop = false;
    if (marker === 0xe1) { const k = jpegSegmentKind(buf, pos + 4, len - 2); drop = k === 'xmp' || k === 'exif'; }
    else if (marker === 0xeb) drop = jpegSegmentKind(buf, pos + 4, len - 2) === 'c2pa';
    if (!drop) parts.push(buf.subarray(pos, segEnd));
    if (marker === 0xda) { parts.push(buf.subarray(segEnd)); pos = buf.length; break; }
    pos = segEnd;
  }
  if (pos < buf.length) parts.push(buf.subarray(pos));
  return Buffer.concat(parts);
}

export function scanSvg(text: string): MetadataFinding[] {
  const findings: MetadataFinding[] = [];
  const metaRe = /<metadata[\s>][\s\S]*?<\/metadata>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(text)) !== null) {
    const body = m[0];
    const isXmp = body.includes('xmp') || body.includes('rdf') || body.includes('c2pa') || body.includes('xmpCreatorTool') || body.includes('dc:creator');
    findings.push({
      offset: m.index,
      length: body.length,
      channel: isXmp ? 'xmp-packet' : 'svg-metadata',
      action: 'strip',
      detail: isXmp ? 'XMP/RDF provenance block inside <metadata> — creator-tool/provenance fields' : 'SVG <metadata> block — may carry provenance/creator fields',
    });
  }
  const xmpRe = /<x:xmpmeta[\s>][\s\S]*?<\/x:xmpmeta>/gi;
  while ((m = xmpRe.exec(text)) !== null) {
    // skip xmpmeta blocks already reported as part of a <metadata> finding
    const nested = findings.some((f) => m!.index >= f.offset && m!.index < f.offset + f.length);
    if (!nested) {
      findings.push({ offset: m.index, length: m[0].length, channel: 'xmp-packet', action: 'strip', detail: 'XMP packet (<x:xmpmeta>) — provenance/creator-tool fields' });
    }
  }
  const procRe = /<\?xpacket[\s\S]*?\?>/gi;
  while ((m = procRe.exec(text)) !== null) {
    findings.push({ offset: m.index, length: m[0].length, channel: 'xmp-packet', action: 'strip', detail: 'XMP xpacket processing instruction' });
  }
  return findings;
}

export function stripSvg(text: string): string {
  return text
    .replace(/<metadata[\s>][\s\S]*?<\/metadata>/gi, '')
    .replace(/<x:xmpmeta[\s>][\s\S]*?<\/x:xmpmeta>/gi, '')
    .replace(/<\?xpacket[\s\S]*?\?>/gi, '');
}

/**
 * Scan a PNG/JPEG/SVG buffer for provenance metadata. SVG must be passed as a Buffer; the format is sniffed (SVG detected by '<' lead + 'svg' marker in the head). Unknown formats return clean with a note.
 */
export function scanMetadata(input: Buffer): MetadataScanReport {
  const format = detectBinaryFormat(input);
  let findings: MetadataFinding[];
  let resolved = format;
  if (format === 'png') {
    findings = scanPng(input);
  } else if (format === 'jpeg') {
    findings = scanJpeg(input);
  } else {
    // decode as utf8 and strip a leading BOM so BOM'd SVGs aren't misclassified
    const head = input.toString('utf8', 0, Math.min(input.length, 512)).replace(/^\uFEFF/, '').trimStart();
    if (head.startsWith('<') && (head.includes('<svg') || head.includes('<?xml'))) {
      resolved = 'svg';
      findings = scanSvg(input.toString('utf8'));
    } else {
      return {
        format: 'unknown',
        findings: [],
        byChannel: {},
        clean: false, // honesty contract: unexamined is not clean
        notAssessable: [...METADATA_NOT_ASSESSABLE, 'unrecognized file format — no metadata scan performed'],
      };
    }
  }
  return {
    format: resolved,
    findings,
    byChannel: countsByChannelMetadata(findings),
    clean: findings.length === 0,
    notAssessable: METADATA_NOT_ASSESSABLE,
  };
}

/**
 * Strip provenance metadata from a PNG/JPEG/SVG buffer. Output re-scans clean by construction (scan(strip(x)) is finding-free for the stripped classes). Unknown formats are returned byte-identical.
 */
export function stripMetadata(input: Buffer): MetadataStripResult {
  const report = scanMetadata(input);
  let output: Buffer;
  if (report.format === 'png') output = stripPng(input);
  else if (report.format === 'jpeg') output = stripJpeg(input);
  else if (report.format === 'svg') output = Buffer.from(stripSvg(input.toString('utf8')), 'utf8');
  else output = input;
  return { output, report };
}
