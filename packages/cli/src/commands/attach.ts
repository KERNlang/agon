import { defineCommand } from 'citty';
import { escapeLiteralText } from '../blocks/literal-text.js';

import { ensureAgonHome } from '@kernlang/agon-core';
import { getSessionHost } from '@kernlang/agon-support-persistence';

import type { SessionDescriptor, LoggedEvent } from '@kernlang/agon-support-persistence';

import { header, info, table, bold, dim, green, cyan, yellow, red } from '../blocks/output-format.js';

/**
 * Render an ISO createdAt as a coarse relative age for the session list. Returns '?' when the timestamp is missing/unparseable (a session whose meta.json never landed).
 */
function formatSessionAge(iso: string): string {
  if (!iso) return '?';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '?';
  const s = Math.floor((Date.now() - then) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Return a recency-sorted copy (newest createdAt first). A session with no parseable createdAt sorts last (treated as epoch 0) so live, dated sessions surface at the top. Pure + exported so the unit test can assert ordering without driving the whole command.
 */
export function sortSessionsByRecency(sessions: SessionDescriptor[]): SessionDescriptor[] {
  const ts = (s: SessionDescriptor): number => {
    const t = Date.parse(s.createdAt ?? '');
    return Number.isFinite(t) ? t : 0;
  };
  return [...sessions].sort((a, b) => ts(b) - ts(a));
}

/**
 * Format one ledger entry as a single transcript line, or null to skip it (pure structural events like separators/clears that add only noise to a flat dump). Exported pure so the unit test can assert the formatting without a live session. The payload is `unknown` on disk; we narrow by the `type` discriminant defensively (a replayed event may be a placeholder { event: '[unserializable]' } from a bad write).
 */
export function renderLoggedEvent(entry: LoggedEvent): string | null {
  const ev = entry?.event as Record<string, unknown> | null | undefined;
  if (!ev || typeof ev !== 'object') return null;
  const type = String((ev as { type?: unknown }).type ?? '');
  const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const oneLine = (v: unknown): string => str(v).replace(/\s+/g, ' ').trim();
  switch (type) {
    case 'user-message':
      return `${bold(green('› you'))} ${oneLine((ev as { content?: unknown }).content)}`;
    case 'text':
      return oneLine((ev as { content?: unknown }).content) || null;
    case 'engine-block': {
      if (ev.format === 'diff') {
        const eid = oneLine(escapeLiteralText(str(ev.engineId))) || 'patch';
        return `${bold(cyan(`◆ ${eid}`))} ${oneLine(escapeLiteralText(str(ev.content)))}`;
      }
      const eid = oneLine((ev as { engineId?: unknown }).engineId) || 'engine';
      return `${bold(cyan(`◆ ${eid}`))} ${oneLine((ev as { content?: unknown }).content)}`;
    }
    case 'streaming-chunk':
    case 'thinking-chunk':
      // Chunks are dumped verbatim (no aggregation) — the flat replay shows the
      // raw stream shape; a richer attach reducer is out of M2's read-only scope.
      return oneLine((ev as { chunk?: unknown }).chunk) || null;
    case 'header': {
      const title = oneLine((ev as { title?: unknown }).title);
      // A header with no title is structural noise — skip it (null) rather than
      // print a blank bold line, matching how the empty-`text` case collapses.
      return title ? bold(title) : null;
    }
    case 'success':
      return green(`✓ ${oneLine((ev as { message?: unknown }).message)}`);
    case 'error':
      return red(`✗ ${oneLine((ev as { message?: unknown }).message)}`);
    case 'warning':
      return yellow(`▲ ${oneLine((ev as { message?: unknown }).message)}`);
    case 'info':
      return dim(oneLine((ev as { message?: unknown }).message));
    case 'verdict':
      return `${bold('Verdict:')} ${oneLine((ev as { summary?: unknown }).summary)}`;
    case 'tool-call': {
      const tool = oneLine((ev as { tool?: unknown }).tool) || 'tool';
      const input = oneLine((ev as { input?: unknown }).input);
      const status = oneLine((ev as { status?: unknown }).status) || 'done';
      return dim(`  ⚒ ${tool}(${input.slice(0, 60)})${status === 'done' ? '' : ` [${status}]`}`);
    }
    case '':
      // A placeholder line from a poisoned write keeps seq monotonic but has
      // no `type` — surface it faintly so the tail count still adds up.
      return dim('· (unserializable event)');
    default:
      return dim(`· ${type}`);
  }
}

/**
 * Render the session picker: every session the host knows, newest first, with its event count (lastSeq) and age. Empty-state nudges toward starting a REPL.
 */
function printSessionList(): void {
  const host = getSessionHost();
  const sessions = sortSessionsByRecency(host.listSessions());
  if (sessions.length === 0) {
    info('No sessions yet. Start `agon` to create one, then `agon attach --self <id>`.');
    return;
  }
  header(`Sessions (${sessions.length})`);
  const rows: string[][] = sessions.map((s) => [
    s.id.length > 28 ? s.id.slice(0, 28) + '…' : s.id,
    String(s.lastSeq),
    formatSessionAge(s.createdAt),
    s.kind,
  ]);
  table(['Session', 'Events', 'Age', 'Kind'], rows);
  console.log('');
  info(dim('Attach with `agon attach --self <session>` (or `--latest` for the newest).'));
}

/**
 * Replay the ledger, then follow events after its last sequence number.
 * Resume stdin to keep the command alive while the subscription timer is unref'd.
 * On SIGINT, stop the subscription and release the command's stdin hold.
 */
async function attachToSession(sessionId: string): Promise<void> {
  const host = getSessionHost();
  // replay delegates to the ledger, which is documented never to throw (it
  // tolerates corrupt/partial lines). Guard anyway: the session could be
  // deleted between the run()-time existence check and here (TOCTOU), and a
  // read-only dev tool should print a clean message, not a stack trace.
  let history: LoggedEvent[];
  try {
    history = host.replay(sessionId, 0);
  } catch (err) {
    info(`Could not read session "${sessionId}": ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  header(`Attached to ${bold(sessionId)} ${dim(`(${history.length} events)`)}`);
  let lastSeq = 0;
  for (const entry of history) {
    const line = renderLoggedEvent(entry);
    if (line !== null) console.log(line);
    if (typeof entry.seq === 'number' && entry.seq > lastSeq) lastSeq = entry.seq;
  }
  
  await new Promise<void>((resolve) => {
    const unsubscribe = host.subscribe(sessionId, lastSeq, (entry: LoggedEvent) => {
      const line = renderLoggedEvent(entry);
      if (line !== null) console.log(line);
    });
    // Hold the event loop open until Ctrl+C. The poll timer is unref'd, so we
    // need our OWN ref'd handle; a resumed stdin both keeps Node alive and is
    // the idiomatic interactive-CLI hold. Release it on detach. A new pipe can
    // report isPaused() as false before resume(), so that flag cannot track ownership.
    try { process.stdin.resume(); } catch { /* non-tty / closed stdin */ }
    const onSigint = (): void => {
      try { unsubscribe(); } catch { /* best-effort */ }
      process.removeListener('SIGINT', onSigint);
      try { process.stdin.pause(); } catch { /* best-effort */ }
      console.log(dim('\n— detached —'));
      resolve();
    };
    process.on('SIGINT', onSigint);
    console.log(dim('─'.repeat(48) + ' following live (Ctrl+C to detach) '));
  });
}

export const attachCommand: any = defineCommand({
  meta: {
    name: 'attach',
    description: 'Attach (read-only) to a session: replay its EventLog and follow live (client/server split M2)',
  },
  args: {
    sessionId: {
      type: 'positional',
      description: 'Session id to attach to (omit to list sessions)',
      required: false,
    },
    self: {
      type: 'boolean',
      description: 'Attach to a local session via the in-process host (required in M2 — remote attach lands with the M3 daemon)',
      default: false,
    },
    latest: {
      type: 'boolean',
      description: 'Attach to the most recently created session',
      default: false,
    },
  },
  async run({ args }: { args: { sessionId?: string; self?: boolean; latest?: boolean } }) {
    ensureAgonHome();

    // M2 is in-process only. Require --self so the flag's meaning is explicit
    // now and a future `agon attach <remote>` doesn't silently change behavior.
    if (!args.self) {
      info('agon attach is read-only and currently in-process only — pass `--self`.');
      info(dim('  `agon attach --self`            list sessions'));
      info(dim('  `agon attach --self <id>`       replay + follow a session'));
      info(dim('  `agon attach --self --latest`   attach to the newest session'));
      return;
    }

    const host = getSessionHost();

    // Resolve the target session: explicit id wins, then --latest, else list.
    let target = typeof args.sessionId === 'string' ? args.sessionId.trim() : '';
    if (!target && args.latest) {
      const newest = sortSessionsByRecency(host.listSessions())[0];
      if (!newest) {
        info('No sessions yet. Start `agon` to create one.');
        return;
      }
      target = newest.id;
    }

    if (!target) {
      printSessionList();
      return;
    }

    // Validate the session exists so a typo lists instead of tailing an
    // empty phantom that never prints anything.
    const known = host.listSessions().some((s) => s.id === target);
    if (!known) {
      info(`No session "${target}". Known sessions:`);
      printSessionList();
      return;
    }

    await attachToSession(target);
  },
});
