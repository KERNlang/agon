import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeDataUrlToImageFile, sniffImageMime } from '@kernlang/agon-core';

// The agon-serve frontend-inspector path: a browser screenshot arrives as a base64
// data URL (no file). decodeDataUrlToImageFile is the security gate that materializes
// it into a turn-scratch file for the path-based pipeline.

const DIR = mkdtempSync(join(tmpdir(), 'agon-img-decode-'));
afterAll(() => { try { rmSync(DIR, { recursive: true, force: true }); } catch { /* best-effort */ } });

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // GIF89a
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]; // RIFF....WEBP
const dataUrl = (mime: string, bytes: number[]): string => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

describe('decodeDataUrlToImageFile — browser base64 → scratch file (security gate)', () => {
  it('writes a valid PNG data URL to a file UNDER the given dir', () => {
    const r = decodeDataUrlToImageFile(dataUrl('image/png', PNG), DIR, 0);
    expect(r.reason).toBeUndefined();
    expect(r.path).toBeTruthy();
    expect(r.path!.startsWith(DIR)).toBe(true); // no traversal — stays in the scratch dir
    expect(existsSync(r.path!)).toBe(true);
    expect(Array.from(readFileSync(r.path!))).toEqual(PNG);
  });

  it('accepts the other allowlisted vision types (jpeg/webp/gif)', () => {
    expect(decodeDataUrlToImageFile(dataUrl('image/jpeg', JPEG), DIR, 1).path).toBeTruthy();
    expect(decodeDataUrlToImageFile(dataUrl('image/webp', WEBP), DIR, 2).path).toBeTruthy();
    expect(decodeDataUrlToImageFile(dataUrl('image/gif', GIF), DIR, 3).path).toBeTruthy();
  });

  it('rejects a non-allowlisted MIME', () => {
    const r = decodeDataUrlToImageFile(`data:text/plain;base64,${Buffer.from('hi').toString('base64')}`, DIR, 0);
    expect(r.path).toBeUndefined();
    expect(r.reason).toMatch(/unsupported image type/);
  });

  it('rejects content that is not a recognized image (garbage behind an image MIME)', () => {
    const r = decodeDataUrlToImageFile(dataUrl('image/png', [1, 2, 3, 4, 5, 6, 7, 8]), DIR, 0);
    expect(r.path).toBeUndefined();
    expect(r.reason).toMatch(/not a recognized image/);
  });

  it('rejects a MIME/content mismatch (declared png, bytes are jpeg)', () => {
    const r = decodeDataUrlToImageFile(dataUrl('image/png', JPEG), DIR, 0);
    expect(r.path).toBeUndefined();
    expect(r.reason).toMatch(/does not match/);
  });

  it('rejects a non-data-URL string (e.g. a smuggled file path)', () => {
    expect(decodeDataUrlToImageFile('/etc/passwd', DIR, 0).reason).toMatch(/not a base64 image data URL/);
  });

  it('rejects oversize via the base64-LENGTH pre-check (before allocating)', () => {
    const big = `data:image/png;base64,${'A'.repeat(7_000_004)}`; // ~5.25MB decoded > 5MB cap
    const r = decodeDataUrlToImageFile(big, DIR, 0);
    expect(r.path).toBeUndefined();
    expect(r.reason).toMatch(/exceeds 5MB/);
  });
});

describe('sniffImageMime', () => {
  it('detects each allowlisted type from magic bytes and rejects unknown', () => {
    expect(sniffImageMime(Buffer.from(PNG))).toBe('image/png');
    expect(sniffImageMime(Buffer.from(JPEG))).toBe('image/jpeg');
    expect(sniffImageMime(Buffer.from(GIF))).toBe('image/gif');
    expect(sniffImageMime(Buffer.from(WEBP))).toBe('image/webp');
    expect(sniffImageMime(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))).toBeNull();
  });
});
