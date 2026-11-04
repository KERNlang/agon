import { z } from 'zod';
import { validRange } from 'semver';
import { CONTENT_HASH_PATTERN, MOD_ID_PATTERN } from './manifest.js';

const ModId = z.string().max(256).regex(MOD_ID_PATTERN);
const Hash = z.string().regex(CONTENT_HASH_PATTERN);
const ProfileId = z.string().regex(/^[a-z][a-z0-9-]*$/);
const Timestamp = z.string().datetime({ offset: false });
const JsonValue: z.ZodType<unknown> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(JsonValue), z.record(z.string(), JsonValue),
]));

function asciiSortedUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length
    && values.every((value, index) => index === 0 || values[index - 1]! < value);
}

const ModIds = z.array(ModId).refine(asciiSortedUnique, 'mod IDs must be unique and ASCII-sorted');
const Constraints = z.record(ModId, z.string().refine((value) => validRange(value) !== null, 'invalid semver range'))
  .refine((value) => asciiSortedUnique(Object.keys(value)), 'constraint keys must be ASCII-sorted');
const SettingsDefaults = z.record(ModId, JsonValue);

const ProfileDefinitionObject = z.object({
  schemaVersion: z.literal(1),
  id: ProfileId,
  revision: z.number().int().nonnegative(),
  selected: ModIds,
  disabled: ModIds,
  constraints: Constraints,
  settingsDefaults: SettingsDefaults,
}).strict();

export const ProfileDefinitionSchema = ProfileDefinitionObject
  .refine((value) => !value.selected.some((id) => value.disabled.includes(id)), 'selected and disabled mod IDs must be disjoint');

export const AppliedProfileSnapshotSchema = ProfileDefinitionObject.omit({ schemaVersion: true })
  .extend({ definitionHash: Hash }).strict()
  .refine((value) => !value.selected.some((id) => value.disabled.includes(id)), 'selected and disabled mod IDs must be disjoint');

export const DesiredStateSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  previousHash: Hash.nullable(),
  updatedAt: Timestamp,
  selected: ModIds,
  disabled: ModIds,
  constraints: Constraints,
  profile: AppliedProfileSnapshotSchema.nullable(),
}).strict().refine((value) => !value.selected.some((id) => value.disabled.includes(id)), 'selected and disabled mod IDs must be disjoint');

export type ProfileDefinitionDocument = Readonly<z.infer<typeof ProfileDefinitionSchema>>;
export type AppliedProfileSnapshotDocument = Readonly<z.infer<typeof AppliedProfileSnapshotSchema>>;
export type DesiredStateDocument = Readonly<z.infer<typeof DesiredStateSchema>>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export function validateProfileDefinition(input: unknown): ProfileDefinitionDocument {
  return deepFreeze(ProfileDefinitionSchema.parse(input));
}

export function validateDesiredState(input: unknown): DesiredStateDocument {
  return deepFreeze(DesiredStateSchema.parse(input));
}
