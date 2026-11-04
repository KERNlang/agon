import { z } from 'zod';
import { valid as validVersion } from 'semver';
import { CONTENT_HASH_PATTERN, MOD_ID_PATTERN } from './manifest.js';

const Uuid = z.string().uuid();
const Timestamp = z.string().datetime({ offset: true });
const ModId = z.string().max(256).regex(MOD_ID_PATTERN);
const Hash = z.string().regex(CONTENT_HASH_PATTERN);
const Semver = z.string().refine((value) => validVersion(value) !== null, 'invalid semantic version');
const JsonValue: z.ZodType<unknown> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(JsonValue), z.record(z.string(), JsonValue),
]));

const CommonEnvelope = z.object({
  schemaVersion: z.literal(1), id: Uuid, createdAt: Timestamp, updatedAt: Timestamp,
  ownerModId: ModId, ownerModVersion: Semver, ownerContentHash: Hash,
  kernelVersion: Semver, graphHash: Hash, contributionId: ModId,
  sessionId: Uuid, traceId: Uuid, payloadVersion: Semver,
  payloadEncoding: z.literal('application/json'), receiptIds: z.array(Uuid), payload: JsonValue,
}).strict();

export const PlanEnvelopeSchema = CommonEnvelope.extend({
  kind: z.literal('plan'), status: z.enum(['draft', 'approved', 'running', 'paused', 'completed', 'failed', 'cancelled']),
}).strict();
export const ResultEnvelopeSchema = CommonEnvelope.extend({
  kind: z.literal('result'), status: z.enum(['succeeded', 'failed', 'cancelled', 'partial']),
}).strict();
export const SessionEnvelopeSchema = CommonEnvelope.extend({
  kind: z.literal('session'), status: z.enum(['active', 'closed', 'crashed']), childEnvelopeIds: z.array(Uuid),
}).strict();
export const JobEnvelopeSchema = CommonEnvelope.extend({
  kind: z.literal('job'), status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted']), leaseId: z.string().optional(),
}).strict();
export const PersistedEnvelopeSchema = z.discriminatedUnion('kind', [PlanEnvelopeSchema, ResultEnvelopeSchema, SessionEnvelopeSchema, JobEnvelopeSchema]);

export type PlanEnvelope = Readonly<z.infer<typeof PlanEnvelopeSchema>>;
export type ResultEnvelope = Readonly<z.infer<typeof ResultEnvelopeSchema>>;
export type SessionEnvelope = Readonly<z.infer<typeof SessionEnvelopeSchema>>;
export type JobEnvelope = Readonly<z.infer<typeof JobEnvelopeSchema>>;
export type PersistedEnvelope = Readonly<z.infer<typeof PersistedEnvelopeSchema>>;

export function validatePersistedEnvelope(input: unknown): PersistedEnvelope {
  return Object.freeze(PersistedEnvelopeSchema.parse(input));
}
