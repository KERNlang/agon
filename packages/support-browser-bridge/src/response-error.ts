import { stripVTControlCharacters } from 'node:util';

/** Read optional bridge guidance without letting a failed response stall cleanup. */
export async function readBrowserResponseError(response: Response, signal?: AbortSignal): Promise<string | undefined> {
  if (!response.body || response.body.locked || response.bodyUsed || signal?.aborted) return undefined;
  const reader = response.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  const stopped = new Promise<never>((_, reject) => {
    abort = () => reject(new Error('Browser error read cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(abort, 1000);
  });
  try {
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), stopped]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_384) return undefined;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('error' in body) || typeof body.error !== 'string') return undefined;
    // Keep server text on one line and remove terminal control sequences.
    const message = stripVTControlCharacters(body.error)
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
      .replace(/\s+/g, ' ').trim();
    return message ? message.slice(0, 2048) : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    // A remote stream can delay cancel acknowledgement. Do not wait for it.
    void reader.cancel().catch(() => {});
  }
}
