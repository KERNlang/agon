import type { InvocationContext, Json, ModServices } from '@kernlang/agon-mod-api';
import {
  canStartRepair,
  dispatchCost,
  dispatchText,
  parseFindings,
  REVIEW_SENTINEL,
  reportSeatCeiling,
  runRepair,
  UNREPORTED_REVIEW_TIMEOUT_SECONDS,
  type Finding,
  type ReviewDeadline,
} from './repair.js';

export type SeatStatus = 'ok' | 'timeout' | 'length' | 'empty' | 'rate_limit' | 'auth' | 'error' | 'failed';

type DispatchFault = Exclude<SeatStatus, 'ok' | 'failed'>;

const FAULTS: readonly DispatchFault[] = ['timeout', 'length', 'empty', 'rate_limit', 'auth', 'error'];
const TERMINAL_FAULTS: readonly DispatchFault[] = ['timeout', 'rate_limit', 'auth', 'error'];

export interface SeatResult {
  readonly engineId: string;
  readonly role?: string;
  readonly status: SeatStatus;
  readonly ok: boolean;
  readonly costUsd: number;
  readonly output: string;
  readonly findings: Finding[];
  readonly error: string;
  readonly repaired: boolean;
  readonly timeoutSeconds?: number;
  readonly ceilingSeconds?: number;
  readonly extendedSeconds?: number;
  readonly timeoutKind?: TimeoutKind;
  readonly partial?: true;
}

export interface SeatRequest {
  readonly engineId: string;
  readonly role?: string;
  readonly prompt: string;
  readonly timeoutSeconds?: number;
  readonly maxWallSeconds?: number;
  readonly deadline: ReviewDeadline;
}

type TimeoutKind = 'base' | 'ceiling' | 'idle';
const TIMEOUT_KINDS: readonly TimeoutKind[] = ['base', 'ceiling', 'idle'];

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function dispatchFault(out: Record<string, Json>): DispatchFault | undefined {
  const reported = FAULTS.find(fault => fault === out.engineFault);
  if (reported && reported !== 'empty') return reported;
  if (out.timedOut === true) return 'timeout';
  if (out.finishReason === 'length') return 'length';
  if (out.exitCode !== 0) return 'error';
  return undefined;
}

const FAULT_DETAIL: Record<DispatchFault, string> = {
  timeout: 'timed out',
  length: 'output truncated at the token limit (finishReason=length)',
  empty: 'returned no review text',
  rate_limit: 'rate limited',
  auth: 'authentication failed',
  error: 'dispatch failed',
};

function seat(request: SeatRequest, status: SeatStatus, fields: Partial<SeatResult>): SeatResult {
  const timeoutSeconds = fields.timeoutSeconds ?? request.timeoutSeconds;
  return {
    engineId: request.engineId,
    ...(request.role ? { role: request.role } : {}),
    status,
    ok: status === 'ok' || fields.partial === true,
    costUsd: fields.costUsd ?? 0,
    output: fields.output ?? '',
    findings: fields.findings ?? [],
    error: fields.error ?? '',
    repaired: fields.repaired ?? false,
    ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
    ...(fields.ceilingSeconds !== undefined ? { ceilingSeconds: fields.ceilingSeconds } : {}),
    ...(fields.extendedSeconds !== undefined ? { extendedSeconds: fields.extendedSeconds } : {}),
    ...(fields.timeoutKind ? { timeoutKind: fields.timeoutKind } : {}),
    ...(fields.partial ? { partial: true } : {}),
  };
}

async function dispatchSeat(
  request: SeatRequest,
  context: InvocationContext,
  services: ModServices,
  maxTokens?: number,
): Promise<Record<string, Json> | Error> {
  try {
    return (await services.engines.dispatch(request.engineId, request.prompt, context, {
      ...(request.timeoutSeconds !== undefined ? { timeoutSeconds: request.timeoutSeconds } : {}),
      ...(request.maxWallSeconds !== undefined ? { maxWallSeconds: request.maxWallSeconds } : {}),
      mode: 'review',
      systemPrompt: 'Perform a non-interactive evidence-grounded code review. Do not modify files or use tools.',
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    })) as Record<string, Json>;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function positive(value: Json | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function wallClockFields(out: Record<string, Json>): Partial<SeatResult> {
  const ceilingSeconds = positive(out.appliedCeilingSeconds);
  const extendedSeconds = typeof out.extendedSeconds === 'number' && Number.isFinite(out.extendedSeconds) ? out.extendedSeconds : undefined;
  const timeoutKind = TIMEOUT_KINDS.find(kind => kind === out.timeoutKind);
  return {
    ...(ceilingSeconds !== undefined ? { ceilingSeconds } : {}),
    ...(extendedSeconds !== undefined ? { extendedSeconds } : {}),
    ...(timeoutKind ? { timeoutKind } : {}),
  };
}

function budgetRetryTokens(out: Record<string, Json>): number | undefined {
  const applied = positive(out.appliedMaxTokens);
  return applied === undefined ? undefined : Math.floor(applied * 2);
}

function timedOutFindings(out: Record<string, Json>): Pick<SeatResult, 'output' | 'findings' | 'error'> | undefined {
  const output = dispatchText(out);
  if (!output.includes(REVIEW_SENTINEL)) return undefined;
  const parsed = parseFindings(output);
  if (!parsed.valid) return undefined;
  const reason = text(out.stderr) || FAULT_DETAIL.timeout;
  return { output, findings: parsed.findings, error: `${reason}; findings parsed from the partial output` };
}

export async function runSeat(request: SeatRequest, context: InvocationContext, services: ModServices): Promise<SeatResult> {
  let out = await dispatchSeat(request, context, services);
  if (out instanceof Error) return seat(request, 'error', { error: out.message });
  const appliedTimeout = request.timeoutSeconds ?? positive(out.appliedTimeoutSeconds);
  const seatTimeout = appliedTimeout ?? UNREPORTED_REVIEW_TIMEOUT_SECONDS;
  const appliedCeiling = positive(out.appliedCeilingSeconds);
  if (appliedCeiling !== undefined) reportSeatCeiling(request.deadline, appliedCeiling);
  let fields: Partial<SeatResult> = { ...(appliedTimeout !== undefined ? { timeoutSeconds: appliedTimeout } : {}), ...wallClockFields(out) };
  let costUsd = dispatchCost(out);
  let fault = dispatchFault(out);
  const retryTokens = budgetRetryTokens(out);
  if (fault === 'length' && !dispatchText(out) && retryTokens !== undefined
    && canStartRepair(request.deadline, seatTimeout, context.signal)) {
    const retried = await dispatchSeat({ ...request, timeoutSeconds: appliedTimeout }, context, services, retryTokens);
    if (retried instanceof Error) return seat(request, 'error', { ...fields, costUsd, error: `budget retry failed: ${retried.message}` });
    out = retried;
    costUsd += dispatchCost(out);
    fault = dispatchFault(out);
    fields = { ...(appliedTimeout !== undefined ? { timeoutSeconds: appliedTimeout } : {}), ...wallClockFields(out) };
  }
  if (fault === 'timeout') {
    const partial = timedOutFindings(out);
    if (partial) return seat(request, 'timeout', { ...fields, ...partial, costUsd, partial: true });
  }
  if (fault && TERMINAL_FAULTS.includes(fault)) {
    return seat(request, fault, { ...fields, costUsd, error: text(out.stderr) || FAULT_DETAIL[fault] });
  }
  const output = dispatchText(out);
  if (!output) {
    const status = fault === 'length' ? 'length' : 'empty';
    return seat(request, status, { ...fields, costUsd, error: text(out.stderr) || FAULT_DETAIL[status] });
  }
  const parsed = parseFindings(output);
  if (parsed.valid && fault !== 'length') return seat(request, 'ok', { ...fields, costUsd, output, findings: parsed.findings });
  const unrepaired: SeatStatus = fault === 'length' ? 'length' : 'failed';
  const unrepairedFields = { ...fields, costUsd, output, findings: parsed.findings, ...(parsed.valid ? { partial: true as const } : {}) };
  const reason = fault === 'length' ? FAULT_DETAIL.length : 'missing or invalid findings block';
  if (!canStartRepair(request.deadline, seatTimeout, context.signal)) {
    return seat(request, unrepaired, { ...unrepairedFields, error: `${reason}; repair skipped: aggregate review deadline too close` });
  }
  const repair = await runRepair(request.engineId, output, appliedTimeout, context, services, request.maxWallSeconds);
  costUsd += repair.costUsd;
  if (repair.block && repair.findings) {
    return seat(request, 'ok', { ...fields, costUsd, output: `${output}\n\n${repair.block}`, findings: repair.findings, repaired: true });
  }
  return seat(request, unrepaired, { ...unrepairedFields, costUsd, error: `${reason}; ${repair.error ?? 'repair failed'}` });
}
