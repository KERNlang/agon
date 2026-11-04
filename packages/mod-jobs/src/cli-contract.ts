import { resolve } from 'node:path';
import type { JobOutcome, JobSnapshot } from './job-service.js';

export interface JobClientTiming {
  pollMs: number;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
}

export interface JobClientConnection {
  ok: boolean;
  message?: string;
}

export function positiveJobCliInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? ''));
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

export function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? ''));
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer`);
  return parsed;
}

export function parsePayload(raw: unknown): Record<string,unknown> {
  if (raw === undefined || raw === null || raw === '') return {};
  let parsed: unknown;
  try { parsed = JSON.parse(String(raw)); }
  catch (error) { throw new Error(`--payload must be valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--payload must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function buildSubmitPayload(args: Record<string,unknown>): Record<string,unknown> {
  const payload = parsePayload(args.payload);
  const fields: Array<[string, unknown]> = [
    ['input', args.input], ['cwd', args.cwd], ['engines', args.engines],
    ['engineTimeout', args.timeout],
  ];
  for (const [key, value] of fields) {
    if (typeof value === 'string' && value.trim()) payload[key] = value.trim();
  }
  // Resolve before IPC. The daemon can serve a different workspace.
  if (payload.cwd === undefined || typeof payload.cwd === 'string') {
    payload.cwd = resolve(typeof payload.cwd === 'string' ? payload.cwd.trim() : '.');
  }
  return payload;
}

export function jobsCapability<T extends { type: string; capabilities?: unknown }>(response: T|null): boolean {
  return response?.type === 'pong' && Array.isArray(response.capabilities) && response.capabilities.includes('jobs-v1');
}

export function jobOutcomeExitCode(outcome: JobOutcome): number {
  if (outcome.state === 'succeeded') return 0;
  if (outcome.state === 'cancelled') return 130;
  return 1;
}

export function jobSnapshotExitCode(job: JobSnapshot): number {
  if (job.state === 'failed') return 1;
  if (job.state === 'cancelled') return 130;
  return 0;
}

export function timingFromArgs(args: Record<string,unknown>): JobClientTiming {
  return {
    pollMs: positiveJobCliInteger(args.pollMs ?? 500, '--poll-ms'),
    connectTimeoutMs: positiveJobCliInteger(args.connectTimeoutMs ?? 5000, '--connect-timeout-ms'),
    requestTimeoutMs: positiveJobCliInteger(args.requestTimeoutMs ?? 2000, '--request-timeout-ms'),
  };
}
