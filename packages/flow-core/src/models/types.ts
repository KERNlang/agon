/**
 * Agon Flow — canonical `.agon-flow.json` document model + elaborated step-DAG
 * model. Pure data types; no fs, no engine, no adapter.
 *
 * Spec: .claude/specs/agon-flow-phase1/spec.md (packages/flow-core §1-§2).
 */

/** Closed set of port VALUE types. No implicit coercion between any two. */
export type PortValueType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'json'
  | 'file'
  | 'folder'
  | 'fileset'
  | 'artifact';

export const PORT_VALUE_TYPES: readonly PortValueType[] = [
  'text', 'number', 'boolean', 'json', 'file', 'folder', 'fileset', 'artifact',
];

/**
 * A port type as DECLARED by a node descriptor: either a concrete value type
 * or the parametric passthrough marker `T`, resolved per node instance at
 * elaboration from the incoming edge (spec nero-C1a).
 */
export const PARAMETRIC = 'T' as const;
export type ParametricMarker = typeof PARAMETRIC;
export type PortTypeExpr = PortValueType | ParametricMarker;

export function isPortValueType(value: unknown): value is PortValueType {
  return typeof value === 'string' && (PORT_VALUE_TYPES as readonly string[]).includes(value);
}

/**
 * Minimal structural JSON-schema view. Only the parts the elaborator needs to
 * validate a declared field access (`properties`, `items`, `required`, `type`)
 * are modelled; anything else rides along untouched.
 */
export interface JsonSchemaNode {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  required?: string[];
  additionalProperties?: boolean | JsonSchemaNode;
  [key: string]: unknown;
}

// ── Document model ────────────────────────────────────────────────────────

/** The schemaVersion this build of flow-core reads and writes. */
export const FLOW_SCHEMA_VERSION = 1;

export interface FlowPosition {
  x: number;
  y: number;
}

export interface FlowNode {
  /** ULID. */
  id: string;
  /** Node descriptor type id (`engine`, `if-compare`, `subflow`, …). */
  type: string;
  label?: string;
  params: Record<string, unknown>;
  position: FlowPosition;
  /** Subflow nodes only: path to the referenced flow, relative to this file. */
  flow?: string;
  /** Subflow nodes only: semver RANGE checked against the target's `version`. */
  version?: string;
  /**
   * Subflow nodes only: `<subflowNodeId>.<paramKey>` → friendly effective key.
   * Unaliased keys keep their namespaced form (spec nero-2 C2).
   */
  aliases?: Record<string, string>;
}

/** `{from: 'nodeId.port', to: 'nodeId.port'}` */
export interface FlowEdge {
  from: string;
  to: string;
}

export interface FlowParam {
  key: string;
  type: PortValueType;
  label?: string;
  description?: string;
  default?: unknown;
  required?: boolean;
}

export interface FlowOutput {
  name: string;
  /** `nodeId.port` */
  from: string;
}

export interface FlowDocument {
  schemaVersion: number;
  /** semver, bumped on save. */
  version: string;
  /** ULID. */
  id: string;
  name: string;
  description?: string;
  params: FlowParam[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  outputs: FlowOutput[];
}

// ── Port references ───────────────────────────────────────────────────────

export interface PortRef {
  nodeId: string;
  port: string;
}

/**
 * Splits `nodeId.port` at the FIRST dot: node ids are ULIDs (dot-free) and
 * port names are identifiers, so the first dot is unambiguous.
 */
export function parsePortRef(ref: string): PortRef | null {
  const dot = ref.indexOf('.');
  if (dot <= 0 || dot === ref.length - 1) return null;
  return { nodeId: ref.slice(0, dot), port: ref.slice(dot + 1) };
}

export function formatPortRef(ref: PortRef): string {
  return `${ref.nodeId}.${ref.port}`;
}

// ── Elaborated (flat, typed) step-DAG ─────────────────────────────────────

/**
 * One branch decision of an exclusive-route node. Two route sets are mutually
 * exclusive when they carry the same `stepId`+`group` with different `branch`.
 */
export interface RouteMarker {
  stepId: string;
  group: string;
  branch: string;
}

export interface ResolvedPort {
  name: string;
  type: PortValueType;
  required: boolean;
  /** Present when the port carries a declared JSON schema annotation. */
  jsonSchema?: JsonSchemaNode;
  /** Out-ports only: exclusive-route group this port belongs to. */
  exclusiveGroup?: string;
  /** In-ports only: legal coalesce target (first-active-wins). */
  coalescing?: boolean;
  /** In-ports only: accepts several concurrently-live edges. */
  variadic?: boolean;
}

export interface StepInputBinding {
  port: string;
  fromStep: string;
  fromPort: string;
  type: PortValueType;
  jsonSchema?: JsonSchemaNode;
  /** Route conditions under which this particular edge is live. */
  routeSet: RouteMarker[];
}

export interface ElaboratedStep {
  /** Path-qualified, globally unique: `<subflowNodeId>/<innerNodeId>`. */
  id: string;
  /** The node's own id inside its defining flow. */
  nodeId: string;
  /** Subflow instance path (empty for top-level nodes). */
  path: string[];
  type: string;
  label?: string;
  params: Record<string, unknown>;
  /** Nodes that touch the world; never restored-as-done without a journal. */
  effect: boolean;
  inputs: StepInputBinding[];
  outputs: ResolvedPort[];
  /** Route conditions under which this step runs at all. */
  routeSet: RouteMarker[];
  /** Steps whose SKIP propagates to this one (required-input upstreams). */
  requiredUpstream: string[];
  /** In-port names that legally coalesce mutually-exclusive routes. */
  coalescingPorts: string[];
  /** Effective param key this input-source node was promoted to. */
  paramKey?: string;
}

export interface EffectiveParam {
  /** Effective (possibly namespaced or aliased) key. */
  key: string;
  type: PortValueType;
  label?: string;
  description?: string;
  default?: unknown;
  required: boolean;
  /** `promoted` = auto-derived from an input-source node's `paramKey`. */
  source: 'promoted' | 'declared';
  /** Promoted params: the elaborated step that consumes this value. */
  stepId?: string;
  /** Promoted params: the raw `paramKey` before namespacing/aliasing. */
  paramKey?: string;
  /** Aliased params: the namespaced key this alias replaced. */
  aliasOf?: string;
}

export interface ElaboratedOutput {
  name: string;
  stepId: string;
  port: string;
  type: PortValueType;
  jsonSchema?: JsonSchemaNode;
}

export interface ElaboratedFlow {
  schemaVersion: number;
  id: string;
  name: string;
  version: string;
  description?: string;
  /** Absolute path of the root flow file, when elaborated from disk. */
  sourcePath?: string;
  params: EffectiveParam[];
  /** Topologically sorted. */
  steps: ElaboratedStep[];
  order: string[];
  outputs: ElaboratedOutput[];
  /** Step ids of every `effect: true` step, for the Use-tab confirm card. */
  effects: string[];
}
