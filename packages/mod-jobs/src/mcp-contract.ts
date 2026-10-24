import type { JobToolName, Json } from '@kernlang/agon-mod-api';

export const JOB_TOOLS: Array<{name:JobToolName,description:string,inputSchema:Record<string,Json>}> = [
  { name: 'JobSubmit', description: 'Submit an allowlisted Agon workflow to the long-lived daemon and return immediately with its job id.', inputSchema: { type: 'object', properties: { kind: { type: 'string', description: 'Registered workflow kind, such as brainstorm, review, or forge.' }, payload: { type: 'object', description: 'Structured workflow payload. The daemon rejects unknown fields and never accepts shell or argv.' } }, required: ['kind', 'payload'] } },
  { name: 'JobList', description: 'List autonomous jobs retained by the Agon daemon.', inputSchema: { type: 'object', properties: {} } },
  { name: 'JobStatus', description: 'Get one autonomous job snapshot.', inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] } },
  { name: 'JobEvents', description: 'Replay bounded ordered events for one autonomous job after a sequence cursor.', inputSchema: { type: 'object', properties: { jobId: { type: 'string' }, afterSeq: { type: 'number', minimum: 0 }, limit: { type: 'number', minimum: 1 } }, required: ['jobId'] } },
  { name: 'JobResult', description: 'Read the terminal result for one autonomous job without blocking.', inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] } },
  { name: 'JobCancel', description: 'Request idempotent cancellation of one autonomous job.', inputSchema: { type: 'object', properties: { jobId: { type: 'string' }, reason: { type: 'string' } }, required: ['jobId'] } },
];

export function isJobTool(name: string): boolean {
  return JOB_TOOLS.some((tool) => tool.name === name);
}

export function requiredString(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.startsWith('-')) throw new Error(`${label} must not be a command option`);
  return normalized;
}

export function optionalInteger(value: unknown, label: string, minimum: number): number|undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < minimum) throw new Error(`${label} must be an integer >= ${minimum}`);
  return Number(value);
}

/**
 * Build a fixed agon-job client invocation. Only structured job fields are serialized; executable, shell, and argv are never accepted.
 */
export function buildMcpJobCommand(name: string, args: Record<string,unknown>): string[] {
  if (name === 'JobSubmit') {
    const kind = requiredString(args.kind, 'kind');
    const payload = args.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('payload must be an object');
    return ['job', 'submit', kind, '--payload', JSON.stringify(payload), '--json'];
  }
  if (name === 'JobList') return ['job', 'list', '--json'];
  const jobId = requiredString(args.jobId, 'jobId');
  if (name === 'JobStatus') return ['job', 'status', jobId, '--json'];
  if (name === 'JobResult') return ['job', 'result', jobId, '--json'];
  if (name === 'JobCancel') {
    const reason = typeof args.reason === 'string' && args.reason.trim() ? [`--reason=${args.reason.trim()}`] : [];
    return ['job', 'cancel', jobId, ...reason, '--json'];
  }
  if (name === 'JobEvents') {
    const after = optionalInteger(args.afterSeq, 'afterSeq', 0);
    const limit = optionalInteger(args.limit, 'limit', 1);
    return ['job', 'events', jobId, ...(after === undefined ? [] : ['--after', String(after)]), ...(limit === undefined ? [] : ['--limit', String(limit)]), '--json'];
  }
  throw new Error(`Unknown job tool: ${name}`);
}
