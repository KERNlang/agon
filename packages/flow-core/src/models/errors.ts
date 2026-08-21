/**
 * Agon Flow — elaboration diagnostics. EVERY error is node-id-addressed
 * (path-qualified for inlined subflow nodes) and carries a human-readable
 * message, so `agon flow validate` can point at the offending node.
 */
import type { ElaboratedFlow } from './types.js';

export type FlowErrorCode =
  /** The document failed `.agon-flow.json` schema validation. */
  | 'SCHEMA_INVALID'
  /** schemaVersion is newer than this build understands. */
  | 'SCHEMA_VERSION_UNSUPPORTED'
  /** Node type is not in the descriptor registry. */
  | 'UNKNOWN_NODE_TYPE'
  /** Node params failed the descriptor's param schema. */
  | 'PARAM_INVALID'
  /** Two flows/nodes claim the same effective param key. */
  | 'PARAM_KEY_COLLISION'
  /** The entry flow file could not be read. */
  | 'FLOW_FILE_UNRESOLVED'
  /** A subflow ref could not be read/parsed. */
  | 'SUBFLOW_UNRESOLVED'
  /** A subflow (transitively) references itself. */
  | 'SUBFLOW_RECURSION'
  /** The referenced flow's `version` is outside the declared range. */
  | 'SUBFLOW_VERSION_MISMATCH'
  /** An edge names a node or port that does not exist. */
  | 'PORT_UNRESOLVED'
  /** Edge source type does not equal target type (no coercion). */
  | 'PORT_TYPE_MISMATCH'
  /** A parametric `T` port had no incoming edge to resolve it from. */
  | 'PARAMETRIC_UNRESOLVED'
  /** The graph contains a cycle. */
  | 'CYCLE'
  /** A `field` access is absent from the upstream declared JSON schema. */
  | 'JSON_FIELD_MISS'
  /** A step takes required inputs from two mutually exclusive routes. */
  | 'MIXED_EXCLUSIVE_ROUTES'
  /** A non-coalescing port is fed by two edges (exclusive or both-live). */
  | 'COALESCE_ILLEGAL'
  /** A declared flow output points nowhere. */
  | 'OUTPUT_UNRESOLVED';

export interface FlowError {
  code: FlowErrorCode;
  /** Path-qualified step id, or null for document-level problems. */
  nodeId: string | null;
  message: string;
  /** Port name when the error is port-scoped. */
  port?: string;
  /** Flow file the offending node was defined in. */
  file?: string;
}

export function flowError(
  code: FlowErrorCode,
  nodeId: string | null,
  message: string,
  extra: { port?: string; file?: string } = {},
): FlowError {
  const error: FlowError = { code, nodeId, message };
  if (extra.port !== undefined) error.port = extra.port;
  if (extra.file !== undefined) error.file = extra.file;
  return error;
}

export function formatFlowError(error: FlowError): string {
  const where = error.nodeId
    ? `${error.nodeId}${error.port ? `.${error.port}` : ''}`
    : 'flow';
  return `[${error.code}] ${where}: ${error.message}`;
}

export type ElaborationResult =
  | { ok: true; flow: ElaboratedFlow; errors: [] }
  | { ok: false; errors: FlowError[] };

/** Thrown by the `*OrThrow` helpers so callers can `catch` instead of branch. */
export class FlowValidationError extends Error {
  readonly errors: FlowError[];

  constructor(errors: FlowError[]) {
    super(errors.map(formatFlowError).join('\n'));
    this.name = 'FlowValidationError';
    this.errors = errors;
  }
}
