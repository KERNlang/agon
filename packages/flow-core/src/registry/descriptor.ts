/**
 * Agon Flow — TYPE-LEVEL node descriptors.
 *
 * A descriptor declares everything the elaborator needs to type-check a node
 * without running it: its ports (including parametric `T` passthrough,
 * exclusive out-port routes, coalescing in-ports and json-schema-annotated
 * out-ports), its param schema, and whether it touches the world (`effect`).
 *
 * `execute` is intentionally OPTIONAL and unimplemented in slice 1 — the
 * runtime lands in slice 2. Only the interface and the ctx types exist here so
 * slice 2 can fill them in without moving anything.
 */
import type { z } from 'zod';

import type { ElaboratedStep, PortTypeExpr } from '../models/types.js';

// ── Runtime value model (interfaces only in slice 1) ──────────────────────

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface FlowFileRef {
  kind: 'file';
  path: string;
  sha256?: string;
}

export interface FlowFolderRef {
  kind: 'folder';
  path: string;
}

export interface FlowFileSetRef {
  kind: 'fileset';
  files: FlowFileRef[];
}

export interface FlowArtifactRef {
  kind: 'artifact';
  sha256: string;
  mediaType?: string;
}

export type FlowValue =
  | JsonValue
  | FlowFileRef
  | FlowFolderRef
  | FlowFileSetRef
  | FlowArtifactRef;

// ── Services injected into execute() by the slice-2 runtime ───────────────
// Declared STRUCTURALLY on purpose: flow-core must never import
// @kernlang/agon-adapter-cli (or any engine code), so `agon flow validate`
// provably cannot dispatch an engine.

export interface FlowEngineDispatchRequest {
  engineId: string;
  prompt: string;
  mode?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface FlowEngineDispatchResult {
  ok: boolean;
  output: string;
  error?: string;
}

export interface FlowEngineService {
  listEngineIds(): string[];
  dispatch(request: FlowEngineDispatchRequest): Promise<FlowEngineDispatchResult>;
}

export interface FlowArtifactStore {
  put(bytes: Uint8Array, mediaType?: string): Promise<FlowArtifactRef>;
  read(ref: FlowArtifactRef): Promise<Uint8Array>;
}

export interface FlowServices {
  engine?: FlowEngineService;
  artifacts?: FlowArtifactStore;
}

export interface FlowStepEvent {
  type: string;
  stepId: string;
  data?: JsonValue;
}

export interface NodeExecuteContext {
  step: ElaboratedStep;
  params: Record<string, unknown>;
  /** Resolved in-port values; variadic ports carry an array. */
  inputs: Record<string, FlowValue | FlowValue[]>;
  services: FlowServices;
  signal?: AbortSignal;
  emit(event: FlowStepEvent): void;
}

/** Slice 2. Absent on every descriptor in slice 1. */
export type NodeExecute = (
  context: NodeExecuteContext,
) => Promise<Record<string, FlowValue>>;

// ── Descriptors ───────────────────────────────────────────────────────────

export interface PortDescriptor {
  name: string;
  type: PortTypeExpr;
  description?: string;
  /** In-ports: an unconnected required port is an elaboration error. */
  required?: boolean;
  /**
   * In-ports: may be fed by several MUTUALLY EXCLUSIVE routes
   * (first-active-wins). v1: Chat Output only.
   */
  coalescing?: boolean;
  /** In-ports: accepts several concurrently-live edges (Template `text[]`). */
  variadic?: boolean;
  /**
   * Out-ports: name of the exclusive-route group. Exactly one port of a group
   * is live per run; downstream steps on the other branch are SKIPPED.
   */
  exclusiveGroup?: string;
  /**
   * Out-ports of type `json`: the node param whose value IS the JSON schema
   * this port carries, so downstream field accesses can be checked statically.
   */
  jsonSchemaParam?: string;
}

export type NodeCategory = 'input' | 'io' | 'ai' | 'control' | 'output' | 'composite';

export interface NodeDescriptor {
  type: string;
  title: string;
  description: string;
  category: NodeCategory;
  in: PortDescriptor[];
  out: PortDescriptor[];
  /** Validated against `node.params` at elaboration. */
  paramSchema: z.ZodType;
  /** Touches the world — never restored-as-done without a journal (slice 2). */
  effect?: boolean;
  /**
   * Groups of in-ports where AT LEAST ONE must be connected. The closed
   * nominal port types cannot express "text OR file", so a node that accepts
   * either declares both ports optional and lists them here.
   */
  requireAnyOf?: string[][];
  /**
   * Input-source node: its `paramKeyParam` param is auto-promoted into the
   * flow's effective params, typed by the named out-port.
   */
  inputSource?: { paramKeyParam: string; port: string };
  /**
   * Name of a param holding a dotted field path that must exist in the JSON
   * schema carried by the named in-port (If/Compare `field`).
   */
  jsonFieldAccess?: { param: string; port: string };
  /** Slice 2. */
  execute?: NodeExecute;
}

/** The Subflow node's ports are generated per instance, not declared. */
export const SUBFLOW_NODE_TYPE = 'subflow';

export class NodeRegistry {
  private readonly descriptors = new Map<string, NodeDescriptor>();

  register(descriptor: NodeDescriptor): this {
    this.descriptors.set(descriptor.type, descriptor);
    return this;
  }

  get(type: string): NodeDescriptor | undefined {
    return this.descriptors.get(type);
  }

  has(type: string): boolean {
    return this.descriptors.has(type);
  }

  list(): NodeDescriptor[] {
    return [...this.descriptors.values()].sort((a, b) => (a.type < b.type ? -1 : 1));
  }

  get size(): number {
    return this.descriptors.size;
  }
}
