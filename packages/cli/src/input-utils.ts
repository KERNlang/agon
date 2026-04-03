// Ink strips a leading ESC from pasted chunks, so tolerate both raw ANSI and bare markers.
const BRACKETED_PASTE_MARKER_RE = /(?:\x1b)?\[20(?:0|1)~/g;

export function stripBracketedPasteMarkers(value: string): string {
  return value.replace(BRACKETED_PASTE_MARKER_RE, '');
}
