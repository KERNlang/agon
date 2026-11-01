import type { DispatchResult } from '../models/types.js';

type TimeoutKind = NonNullable<DispatchResult['timeoutKind']>;

export interface WallClockOptions {
  readonly baseSeconds: number;
  readonly ceilingSeconds?: number;
  readonly activityWindowMs: number;
  readonly onExpire: () => void;
  readonly now?: () => number;
}

export interface WallClock {
  noteActivity(): void;
  stop(): void;
  timeoutMessage(): string;
  report(): Pick<DispatchResult, 'extendedSeconds' | 'timeoutKind'>;
  extensionReport(): Pick<DispatchResult, 'extendedSeconds'>;
  idleReport(): Pick<DispatchResult, 'extendedSeconds' | 'timeoutKind'>;
}

const TIMEOUT_MESSAGES: Record<TimeoutKind, string> = {
  base: 'Request timed out',
  ceiling: 'Request timed out at ceiling after extending while active',
  idle: 'Request timed out after extending while active: the stream went quiet',
};

/**
 * Per-request wall clock. With a ceiling above the base timeout, expiry at the base is deferred while a productive stream part arrived within the activity window, until the ceiling. Without one, it fires once at the base exactly like a plain setTimeout.
 */
export function startWallClock(options: WallClockOptions): WallClock {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const baseMs = options.baseSeconds * 1000;
  const ceilingMs = options.ceilingSeconds !== undefined && options.ceilingSeconds > options.baseSeconds
    ? options.ceilingSeconds * 1000 : undefined;
  let lastActivityAt: number | undefined;
  let extended = false;
  let firedKind: TimeoutKind | undefined;
  let stoppedAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const expire = (kind: TimeoutKind) => {
    firedKind = kind;
    stoppedAt = now();
    timer = undefined;
    options.onExpire();
  };
  const check = () => {
    const at = now();
    if (ceilingMs === undefined || lastActivityAt === undefined) return expire('base');
    if (at - startedAt >= ceilingMs) return expire(extended ? 'ceiling' : 'base');
    if (at - lastActivityAt >= options.activityWindowMs) return expire(extended ? 'idle' : 'base');
    extended = true;
    const nextCheckAt = Math.min(lastActivityAt + options.activityWindowMs, startedAt + ceilingMs);
    timer = setTimeout(check, Math.max(1, nextCheckAt - at));
  };
  timer = setTimeout(check, baseMs);

  const extendedSeconds = () => (extended ? Math.max(0, (stoppedAt ?? now()) - startedAt - baseMs) / 1000 : 0);

  return {
    noteActivity() { lastActivityAt = now(); },
    stop() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      stoppedAt ??= now();
    },
    timeoutMessage() { return TIMEOUT_MESSAGES[firedKind ?? 'base']; },
    report() {
      return ceilingMs === undefined ? {} : { timeoutKind: firedKind ?? 'base', extendedSeconds: extendedSeconds() };
    },
    extensionReport() {
      return extended ? { extendedSeconds: extendedSeconds() } : {};
    },
    idleReport() {
      return ceilingMs === undefined ? {} : { timeoutKind: 'idle', extendedSeconds: extendedSeconds() };
    },
  };
}
