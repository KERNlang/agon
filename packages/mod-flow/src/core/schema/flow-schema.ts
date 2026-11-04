/**
 * Zod validation for the canonical `.agon-flow.json` document.
 * External-library binding (zod), so this file stays plain TypeScript.
 */
import { z } from 'zod';

import { flowError, type FlowError } from '../models/errors.js';
import {
  FLOW_SCHEMA_VERSION, PORT_VALUE_TYPES,
  type FlowDocument,
} from '../models/types.js';
import { isSemver } from './semver.js';

/** Crockford base32, 26 chars — the ULID alphabet (no I, L, O, U). */
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: string): boolean {
  return ULID_RE.test(value);
}

const UlidSchema = z.string().regex(ULID_RE, 'must be a ULID (26 Crockford base32 chars)');

/**
 * `nodeId.port`. Split at the FIRST dot — port names of a Subflow node are
 * namespaced effective param keys and may themselves contain dots.
 */
const PortRefSchema = z
  .string()
  .regex(/^[^.]+\..+$/, 'must be a "nodeId.port" reference');

export const PortValueTypeSchema = z.enum(
  PORT_VALUE_TYPES as unknown as [string, ...string[]],
);

export const FlowPositionSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
});

export const FlowNodeSchema = z.strictObject({
  id: UlidSchema,
  type: z.string().min(1),
  label: z.string().optional(),
  params: z.record(z.string(), z.unknown()).default({}),
  position: FlowPositionSchema,
  // Subflow-only fields. Presence on a non-subflow node is rejected by the
  // elaborator (it knows the descriptor), not here.
  flow: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  aliases: z.record(z.string(), z.string().min(1)).optional(),
});

export const FlowEdgeSchema = z.strictObject({
  from: PortRefSchema,
  to: PortRefSchema,
});

export const FlowParamSchema = z.strictObject({
  key: z.string().min(1),
  type: PortValueTypeSchema,
  label: z.string().optional(),
  description: z.string().optional(),
  default: z.unknown().optional(),
  required: z.boolean().optional(),
});

export const FlowOutputSchema = z.strictObject({
  name: z.string().min(1),
  from: PortRefSchema,
});

export const FlowDocumentSchema = z.strictObject({
  schemaVersion: z.number().int().min(1),
  version: z.string().refine(isSemver, 'must be a semver version (x.y.z)'),
  id: UlidSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  params: z.array(FlowParamSchema).default([]),
  nodes: z.array(FlowNodeSchema).default([]),
  edges: z.array(FlowEdgeSchema).default([]),
  outputs: z.array(FlowOutputSchema).default([]),
});

export type ParseFlowResult =
  | { ok: true; document: FlowDocument }
  | { ok: false; errors: FlowError[] };

/**
 * Maps a zod issue path back to the offending node id when the path runs
 * through `nodes[i]`, so schema errors are node-addressed like every other
 * elaboration error.
 */
function nodeIdForIssuePath(input: unknown, path: readonly PropertyKey[]): string | null {
  if (path[0] !== 'nodes' || typeof path[1] !== 'number') return null;
  const nodes = (input as { nodes?: unknown[] } | null)?.nodes;
  if (!Array.isArray(nodes)) return null;
  const node = nodes[path[1]] as { id?: unknown } | undefined;
  return typeof node?.id === 'string' ? node.id : null;
}

export function parseFlowDocument(input: unknown, file?: string): ParseFlowResult {
  const result = FlowDocumentSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues.map((issue) => {
      const where = issue.path.length > 0 ? issue.path.join('.') : 'document';
      return flowError(
        'SCHEMA_INVALID',
        nodeIdForIssuePath(input, issue.path),
        `${where}: ${issue.message}`,
        file ? { file } : {},
      );
    });
    return { ok: false, errors };
  }

  const document = result.data as FlowDocument;
  if (document.schemaVersion > FLOW_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        flowError(
          'SCHEMA_VERSION_UNSUPPORTED',
          null,
          `flow schemaVersion ${document.schemaVersion} is newer than this build understands (${FLOW_SCHEMA_VERSION}) — upgrade agon`,
          file ? { file } : {},
        ),
      ],
    };
  }
  return { ok: true, document };
}

/** Parses `.agon-flow.json` TEXT (JSON syntax errors become SCHEMA_INVALID). */
export function parseFlowJson(text: string, file?: string): ParseFlowResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      errors: [
        flowError(
          'SCHEMA_INVALID',
          null,
          `not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
          file ? { file } : {},
        ),
      ],
    };
  }
  return parseFlowDocument(raw, file);
}
