import { readdirSync, readFileSync, existsSync } from 'node:fs';

import { join } from 'node:path';

/**
 * One running serve bridge, read from $AGON_HOME/serve/<id>.json: the loopback url + bearer token a client attaches with, plus its session id / bound engine / start time / source file.
 */
export interface ServeConnection {
  url: string;
  token: string;
  sessionId: string;
  engineId: string;
  startedAt: string;
  file: string;
}

/**
 * Read every well-formed serve connection file in `dir` ($AGON_HOME/serve/). Skips partial/garbled files and any missing url/token/sessionId. Pure given the dir so the test drives it with a temp $AGON_HOME.
 */
export function listServeConnections(dir: string): ServeConnection[] {
  if (!existsSync(dir)) return [];
  let files: string[];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); }
  catch { return []; }
  const out: ServeConnection[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Record<string, unknown>;
      const url = typeof raw.url === 'string' ? raw.url : '';
      const token = typeof raw.token === 'string' ? raw.token : '';
      const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : '';
      if (!url || !token || !sessionId) continue;
      out.push({
        url, token, sessionId,
        engineId: typeof raw.engineId === 'string' ? raw.engineId : '',
        startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '',
        file: join(dir, f),
      });
    } catch { /* unreadable/partial — skip */ }
  }
  return out;
}

/**
 * Pull complete Server-Sent-Events frames (each terminated by a blank line) out of a streamed buffer. JSON.parses each `data:` payload (a serialized LoggedEvent); skips `:` comment pings and unparseable blocks. Returns the parsed frames + the unterminated remainder to carry into the next read. Pure + exported so the test feeds it split/partial chunks.
 */
export function parseSseChunk(buffer: string): { frames: unknown[]; rest: string } {
  const frames: unknown[] = [];
  // Normalize CRLF → LF so the blank-line frame split works whether the source emits
  // `\n\n` (our bridge) or `\r\n\r\n`. Only touch the buffer when a `\r` is actually
  // present (our bridge never emits one) so the common path stays O(n), not O(n²) over
  // a long carried-over buffer.
  let rest = buffer.includes('\r') ? buffer.replace(/\r\n/g, '\n') : buffer;
  let idx = rest.indexOf('\n\n');
  while (idx !== -1) {
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const dataLines = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim());
    if (dataLines.length > 0) {
      try { frames.push(JSON.parse(dataLines.join('\n'))); }
      catch { /* partial/garbled data — drop this block */ }
    }
    idx = rest.indexOf('\n\n');
  }
  return { frames, rest };
}

/**
 * True when this approval-request is the brain awaiting OUR decision: kind === 'approval-request' AND targetClientId is either absent (legacy broadcast — the driver is the submitter, so treat as ours) or equals our clientId. The browser panel runs the same check with ITS id and so skips a terminal-driven turn's prompt.
 */
export function approvalTargetsClient(event: Record<string,unknown>, myClientId: string): boolean {
  if (!event || event.kind !== 'approval-request') return false;
  const target = typeof event.targetClientId === 'string' ? event.targetClientId : '';
  return target === '' || target === myClientId;
}

/**
 * Build the backward-compatible /approval wire body shared by terminal drive and the REPL Chrome handler. `automated` is true only for the unattended --auto-approve path; interactive, non-interactive-deny, and REPL decisions pass false explicitly so audit provenance never has to infer how approval happened.
 */
export function buildApprovalPostBody(requestId: string, clientId: string, decision: 'approve'|'approve-session'|'deny'|'deny-session'|'abort', automated: boolean): { requestId: string; clientId: string; decision: 'approve'|'approve-session'|'deny'|'deny-session'|'abort'; automated: boolean } {
  return { requestId, clientId, decision, automated };
}
