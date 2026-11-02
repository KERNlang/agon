export type ApiFailureKind = 'timeout' | 'rate_limit' | 'auth' | 'error';

export interface ApiFailure {
  readonly kind: ApiFailureKind;
  readonly message: string;
}

const TIMEOUT_RE = /headers? timeout|UND_ERR_(?:HEADERS|BODY|CONNECT)_TIMEOUT|ETIMEDOUT|ESOCKETTIMEDOUT|timed? ?out|TimeoutError/i;
const RATE_RE = /\b429\b|rate.?limit|too many requests/i;
const AUTH_RE = /\b40[13]\b|unauthori[sz]ed|forbidden|invalid (?:api )?key|authentication/i;

function lastUnderlyingCause(err: unknown): unknown {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const record = current as { lastError?: unknown; errors?: unknown };
    if (record.lastError !== undefined) { current = record.lastError; continue; }
    if (Array.isArray(record.errors) && record.errors.length > 0) { current = record.errors[record.errors.length - 1]; continue; }
    break;
  }
  return current;
}

function describeChain(err: unknown): string {
  const seen: string[] = [];
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current != null; depth++) {
    if (typeof current === 'object') {
      const record = current as { name?: unknown; code?: unknown; message?: unknown; statusCode?: unknown; cause?: unknown };
      seen.push([record.name, record.code, record.statusCode, record.message].filter(v => v !== undefined && v !== '').map(String).join(' '));
      current = record.cause;
    } else {
      seen.push(String(current));
      break;
    }
  }
  return seen.join(' | ');
}

export function classifyApiFailure(err: unknown): ApiFailure {
  const cause = lastUnderlyingCause(err);
  const message = err instanceof Error ? err.message : String(err);
  const statusCode = cause && typeof cause === 'object' ? Number((cause as { statusCode?: unknown }).statusCode) : NaN;
  const chain = describeChain(cause);
  if (statusCode === 429 || (!Number.isFinite(statusCode) && RATE_RE.test(chain))) return { kind: 'rate_limit', message };
  if (statusCode === 401 || statusCode === 403) return { kind: 'auth', message };
  if (TIMEOUT_RE.test(chain)) return { kind: 'timeout', message };
  if (RATE_RE.test(chain)) return { kind: 'rate_limit', message };
  if (AUTH_RE.test(chain)) return { kind: 'auth', message };
  return { kind: 'error', message };
}
