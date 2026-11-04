export type HostEventLevel = 'debug' | 'info' | 'warning' | 'error';

export interface HostEvent {
  readonly schemaVersion: 1;
  readonly event: string;
  readonly level: HostEventLevel;
  readonly at: string;
  readonly ownerId: string;
  readonly generation: number | null;
  readonly transactionId: string | null;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface HostBlockedReason {
  readonly code: string;
  readonly ownerId: string;
  readonly message: string;
  readonly recovery: string;
}

export interface HostDoctorReport {
  readonly schemaVersion: 1;
  readonly status: 'healthy' | 'degraded' | 'safe-mode';
  readonly generation: number | null;
  readonly graphHash: string | null;
  readonly reason: string | null;
  readonly journalRecovery: readonly string[];
  readonly blocked: readonly HostBlockedReason[];
  readonly failures: readonly HostEvent[];
}

function redactString(value: string, secrets: readonly string[]): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret.length > 0) redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted;
}

export function redactHostValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactHostValue(item, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      (key.toLowerCase() === 'token' || /secret|password|credential|authorization|api.?key|access.?token|refresh.?token/i.test(key)) ? '[REDACTED]' : redactHostValue(item, secrets),
    ]));
  }
  return value;
}

export function createHostEvent(
  input: Omit<HostEvent, 'schemaVersion' | 'details'> & { readonly details?: Readonly<Record<string, unknown>> },
  secrets: readonly string[] = [],
): HostEvent {
  return Object.freeze({
    schemaVersion: 1,
    ...input,
    details: Object.freeze(redactHostValue(input.details ?? {}, secrets) as Record<string, unknown>),
  });
}

export function createDoctorReport(input: Omit<HostDoctorReport, 'schemaVersion'>, secrets: readonly string[] = []): HostDoctorReport {
  return Object.freeze(redactHostValue({ schemaVersion: 1, ...input }, secrets) as unknown as HostDoctorReport);
}
