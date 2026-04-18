// Ink strips a leading ESC from pasted chunks, so tolerate both raw ANSI and bare markers.
const BRACKETED_PASTE_MARKER_RE = /(?:\x1b)?\[20(?:0|1)~/g;
const FOCUS_REPORT_MARKER_RE = /(?:\x1b)?\[(?:I|O)/g;
const MOUSE_REPORT_PREFIX = '\x1b[<';
const MOUSE_REPORT_RE = /\x1b\[<(\d+);(\d+);(\d+)([mM])/g;
const MAX_MOUSE_BUFFER_CHARS = 64;

function normalizeMouseButtonCode(code: number): number {
  if (!Number.isFinite(code)) return -1;
  const baseButton = code & 0b11;
  const isWheel = (code & 0b1000000) !== 0;
  return isWheel ? 64 + baseButton : baseButton;
}

export function stripBracketedPasteMarkers(value: string): string {
  return value.replace(BRACKETED_PASTE_MARKER_RE, '');
}

export function stripTerminalInputMarkers(value: string): string {
  return stripBracketedPasteMarkers(value).replace(FOCUS_REPORT_MARKER_RE, '');
}

export function isTerminalFocusReport(value: string): boolean {
  return value === '\x1b[I' || value === '\x1b[O' || value === '[I' || value === '[O';
}

export interface MouseScrollParseResult {
  nextBuffer: string;
  scrollUpEvents: number;
  scrollDownEvents: number;
}

export interface MousePointerEvent {
  kind: 'down' | 'drag' | 'up';
  button: 'left' | 'middle' | 'right' | 'unknown';
  x: number;
  y: number;
}

export interface MouseParseResult extends MouseScrollParseResult {
  pointerEvents: MousePointerEvent[];
}

function mouseButtonName(code: number): MousePointerEvent['button'] {
  if (code === 0) return 'left';
  if (code === 1) return 'middle';
  if (code === 2) return 'right';
  return 'unknown';
}

export function parseMouseChunk(previousBuffer: string, chunk: string): MouseParseResult {
  const buffer = previousBuffer + chunk;
  if (!buffer) {
    return { nextBuffer: '', scrollUpEvents: 0, scrollDownEvents: 0, pointerEvents: [] };
  }

  let scrollUpEvents = 0;
  let scrollDownEvents = 0;
  const pointerEvents: MousePointerEvent[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  MOUSE_REPORT_RE.lastIndex = 0;
  while ((match = MOUSE_REPORT_RE.exec(buffer)) !== null) {
    lastIndex = MOUSE_REPORT_RE.lastIndex;
    const rawCode = Number(match[1]);
    const code = normalizeMouseButtonCode(rawCode);
    const x = Number(match[2]);
    const y = Number(match[3]);
    const suffix = match[4];
    if (code === 64) scrollUpEvents++;
    else if (code === 65) scrollDownEvents++;
    else if (Number.isFinite(x) && Number.isFinite(y)) {
      const baseButton = rawCode & 0b11;
      const isMotion = (rawCode & 0b100000) !== 0;
      pointerEvents.push({
        kind: suffix === 'm' ? 'up' : isMotion ? 'drag' : 'down',
        button: mouseButtonName(baseButton),
        x,
        y,
      });
    }
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

  return { nextBuffer, scrollUpEvents, scrollDownEvents, pointerEvents };
}

export function parseMouseScrollChunk(previousBuffer: string, chunk: string): MouseScrollParseResult {
  const parsed = parseMouseChunk(previousBuffer, chunk);
  return {
    nextBuffer: parsed.nextBuffer,
    scrollUpEvents: parsed.scrollUpEvents,
    scrollDownEvents: parsed.scrollDownEvents,
  };
}
