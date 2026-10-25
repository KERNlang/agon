import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { getAgonHome } from '../signals/config.js';
import { MAX_PROJECT_BRIEF_BYTES } from './context-scanner.js';

export const GLOBAL_INSTRUCTIONS_FILE = 'AGENTS.md';
export const MAX_GLOBAL_INSTRUCTIONS_CHARS = 32_000;

function skip(reason: string, path: string): string {
  console.warn(`[agon] global instructions skipped: ${reason} (${path})`);
  return '';
}

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

function nextFence(open: string | null, line: string): string | null {
  const m = FENCE_LINE.exec(line);
  if (!m) return open;
  const marker = m[1];
  if (open === null) return marker;
  const closes = marker[0] === open[0] && marker.length >= open.length && m[2].trim() === '';
  return closes ? null : open;
}

function truncateAtBoundary(content: string): string {
  const total = content.length;
  const markerFor = (kept: number) => `\n... (truncated: showing ${kept} of ${total} chars)`;
  const budget = MAX_GLOBAL_INSTRUCTIONS_CHARS - markerFor(total).length - 64;
  let fence: string | null = null;
  let cut = -1;
  let pos = 0;
  for (const line of content.split('\n')) {
    if (pos > budget) break;
    const wasOpen = fence !== null;
    fence = nextFence(fence, line);
    if (!wasOpen && fence === null && pos >= budget / 2 && /^#{1,6}\s/.test(line)) cut = pos;
    pos += line.length + 1;
  }
  if (cut <= 0) {
    cut = content.lastIndexOf('\n', budget);
    if (cut <= 0) {
      cut = budget;
      const prev = content.charCodeAt(cut - 1);
      if (prev >= 0xd800 && prev <= 0xdbff) cut -= 1;
    }
  }
  let kept = content.slice(0, cut).trimEnd();
  fence = null;
  for (const line of kept.split('\n')) fence = nextFence(fence, line);
  if (fence !== null) kept += `\n${fence}`;
  return `${kept}${markerFor(cut)}`;
}

export function buildGlobalInstructionsBlock(home: string = getAgonHome()): string {
  const path = join(home, GLOBAL_INSTRUCTIONS_FILE);
  try {
    lstatSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    return skip(`unreadable: ${err instanceof Error ? err.message : String(err)}`, path);
  }
  let content: string;
  let fd: number | undefined;
  try {
    // Validate and read through one descriptor so a swapped path cannot bypass the type/size checks; O_NONBLOCK keeps a FIFO from hanging open().
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const st = fstatSync(fd);
    if (!st.isFile()) return skip('not a regular file', path);
    if (st.size > MAX_PROJECT_BRIEF_BYTES) return skip(`file exceeds ${MAX_PROJECT_BRIEF_BYTES} bytes`, path);
    const buf = Buffer.alloc(MAX_PROJECT_BRIEF_BYTES + 1);
    let read = 0;
    while (read < buf.length) {
      const n = readSync(fd, buf, read, buf.length - read, null);
      if (n === 0) break;
      read += n;
    }
    if (read > MAX_PROJECT_BRIEF_BYTES) return skip(`file exceeds ${MAX_PROJECT_BRIEF_BYTES} bytes`, path);
    content = buf.toString('utf-8', 0, read);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return skip(code === 'ENOENT' ? 'dangling symlink' : `unreadable: ${err instanceof Error ? err.message : String(err)}`, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  if (!content.trim()) return '';
  if (content.length > MAX_GLOBAL_INSTRUCTIONS_CHARS) {
    console.warn(`[agon] global instructions truncated: ${content.length} chars > ${MAX_GLOBAL_INSTRUCTIONS_CHARS} (${path})`);
    content = truncateAtBoundary(content);
  }
  return `## GLOBAL INSTRUCTIONS (${path})\nThese apply in every workspace. Where they conflict with the Cesar rules above, the Cesar rules win (e.g. invoke Agon modes through your tools, not via shell). PROJECT CONTEXT below may refine them for this project.\n\n${content}`;
}
