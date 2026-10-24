const READ_CHUNK_BYTES = 64 * 1024;

export interface PositionalReadable {
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ readonly bytesRead: number }>;
}

/** Read exactly the stat-observed bytes plus at most one sentinel byte. */
export async function readExactBounded(
  handle: PositionalReadable,
  expectedBytes: number,
  maxBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > maxBytes) {
    throw new RangeError('file exceeds the bounded-read limit');
  }
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset <= expectedBytes) {
    const remainingWithSentinel = expectedBytes + 1 - offset;
    const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remainingWithSentinel));
    const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, offset);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead));
    offset += bytesRead;
  }
  if (offset !== expectedBytes) throw new RangeError('file changed during bounded read');
  return Buffer.concat(chunks, expectedBytes);
}
