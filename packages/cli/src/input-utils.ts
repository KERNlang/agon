// Ink strips a leading ESC from pasted chunks, so tolerate both raw ANSI and bare markers.
const BRACKETED_PASTE_MARKER_RE = /(?:\x1b)?\[20(?:0|1)~/g;
const MOUSE_REPORT_PREFIX = '\x1b[<';
const MOUSE_REPORT_RE = /\x1b\[<(\d+);(\d+);(\d+)([mM])/g;
const MAX_MOUSE_BUFFER_CHARS = 64;

export function stripBracketedPasteMarkers(value: string): string {
  return value.replace(BRACKETED_PASTE_MARKER_RE, '');
}

export interface MouseScrollParseResult {
  nextBuffer: string;
  scrollUpEvents: number;
  scrollDownEvents: number;
}

export function parseMouseScrollChunk(previousBuffer: string, chunk: string): MouseScrollParseResult {
  const buffer = previousBuffer + chunk;
  if (!buffer) {
    return { nextBuffer: '', scrollUpEvents: 0, scrollDownEvents: 0 };
  }

  let scrollUpEvents = 0;
  let scrollDownEvents = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  MOUSE_REPORT_RE.lastIndex = 0;
  while ((match = MOUSE_REPORT_RE.exec(buffer)) !== null) {
    lastIndex = MOUSE_REPORT_RE.lastIndex;
    const code = Number(match[1]);
    if (code === 64) scrollUpEvents++;
    else if (code === 65) scrollDownEvents++;
  }

  let nextBuffer = '';
  if (lastIndex > 0) {
    nextBuffer = buffer.slice(lastIndex);
  } else {
    const prefixIndex = buffer.lastIndexOf(MOUSE_REPORT_PREFIX);
    if (prefixIndex !== -1) nextBuffer = buffer.slice(prefixIndex);
  }

  if (!nextBuffer.includes(MOUSE_REPORT_PREFIX)) nextBuffer = '';
  if (nextBuffer.length > MAX_MOUSE_BUFFER_CHARS) {
    nextBuffer = nextBuffer.slice(-MAX_MOUSE_BUFFER_CHARS);
  }

  return { nextBuffer, scrollUpEvents, scrollDownEvents };
}
