import { describe, expect, it } from 'vitest';
import { parseImageDimensions } from './image.js';

function pngFixture(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8;
  buf[25] = 2;
  buf[26] = 0;
  buf[27] = 0;
  buf[28] = 0;
  return buf;
}

function jpegFixture(width: number, height: number): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x00,
    0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

describe('parseImageDimensions', () => {
  it('parses a PNG IHDR width/height pair', () => {
    expect(parseImageDimensions(pngFixture(1280, 800))).toEqual({ width: 1280, height: 800 });
  });

  it('parses a JPEG SOF0 width/height pair', () => {
    expect(parseImageDimensions(jpegFixture(1280, 800))).toEqual({ width: 1280, height: 800 });
  });

  it('returns null for truncated or unsupported buffers', () => {
    expect(parseImageDimensions(pngFixture(1280, 800).subarray(0, 20))).toBeNull();
    expect(parseImageDimensions(jpegFixture(1280, 800).subarray(0, 14))).toBeNull();
    expect(parseImageDimensions(Buffer.from('GIF89a'))).toBeNull();
  });
});
