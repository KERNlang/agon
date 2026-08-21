/**
 * Subflow resolution + flattening.
 *
 * Every subflow ref is loaded, version-checked, recursion-checked and INLINED:
 * its nodes join the parent graph under a path-qualified id
 * (`<subflowNodeId>/<innerNodeId>`), its promoted params either bind to a
 * parent edge (the inner input node is dropped and its consumers rewired) or
 * bubble up namespaced as `<subflowNodeId>.<paramKey>` — optionally aliased by
 * the parent Subflow node (spec nero-2 C2).
 */
import { flowError, type FlowError } from '../models/errors.js';
import { parsePortRef, type EffectiveParam, type FlowDocument, type FlowNode, type PortValueType } from '../models/types.js';
import { NodeRegistry, SUBFLOW_NODE_TYPE, type NodeDescriptor } from '../registry/descriptor.js';
import { parseFlowJson } from '../schema/flow-schema.js';
import { checkRange } from '../schema/semver.js';
import type { FlowLoader } from './loader.js';

export interface FlatRef {
  stepId: string;
  port: string;
}

export interface FlatNode {
  id: string;
  nodeId: string;
  path: string[];
  type: string;
  label?: string;
  params: Record<string, unknown>;
  descriptor: NodeDescriptor;
  file: string;
  /** Raw `paramKey` of an input-source node, before namespacing/aliasing. */
  rawParamKey?: string;
}

export interface FlatEdge {
  from: FlatRef;
  to: FlatRef;
  file: string;
}

export interface FlattenOutput {
  nodes: FlatNode[];
  edges: FlatEdge[];
  params: EffectiveParam[];
  outputs: Map<string, FlatRef>;
}

export interface FlattenContext {
  registry: NodeRegistry;
  loader: FlowLoader;
  errors: FlowError[];
}

function qualify(prefix: string[], id: string): string {
  return prefix.length === 0 ? id : `${prefix.join('/')}/${id}`;
}

function readStringParam(node: FlowNode, key: 'flow' | 'version'): string | undefined {
  const own = node[key];
  if (typeof own === 'string' && own !== '') return own;
  const fromParams = node.params[key];
  return typeof fromParams === 'string' && fromParams !== '' ? fromParams : undefined;
}

function loadSubflow(
  node: FlowNode,
  file: string,
  prefix: string[],
  stack: string[],
  context: FlattenContext,
): FlattenOutput | null {
  const nodeAddress = qualify(prefix, node.id);
  const ref = readStringParam(node, 'flow');
  if (!ref) {
    context.errors.push(flowError(
      'SUBFLOW_UNRESOLVED', nodeAddress,
      'subflow node has no `flow` reference', { file },
    ));
    return null;
  }

  const target = context.loader.resolve(file, ref);
  if (stack.includes(target)) {
    context.errors.push(flowError(
      'SUBFLOW_RECURSION', nodeAddress,
      `subflow "${ref}" resolves to ${target}, which is already being elaborated (recursive subflow)`,
      { file },
    ));
    return null;
  }

  const text = context.loader.read(target);
  if (text === null) {
    context.errors.push(flowError(
      'SUBFLOW_UNRESOLVED', nodeAddress,
      `subflow "${ref}" could not be read (resolved to ${target})`, { file },
    ));
    return null;
  }

  const parsed = parseFlowJson(text, target);
  if (!parsed.ok) {
    for (const error of parsed.errors) {
      context.errors.push({
        ...error,
        nodeId: error.nodeId ? qualify([...prefix, node.id], error.nodeId) : nodeAddress,
      });
    }
    return null;
  }

  const range = readStringParam(node, 'version');
  if (range) {
    const check = checkRange(parsed.document.version, range);
    if (!check.valid) {
      context.errors.push(flowError(
        'SUBFLOW_VERSION_MISMATCH', nodeAddress,
        `"${range}" is not a valid version range`, { file },
      ));
    } else if (!check.satisfied) {
      context.errors.push(flowError(
        'SUBFLOW_VERSION_MISMATCH', nodeAddress,
        `subflow "${ref}" is version ${parsed.document.version}, which does not satisfy "${range}"`,
        { file },
      ));
    }
  }

  return flattenDocument(
    parsed.document,
    target,
    [...prefix, node.id],
    [...stack, target],
    context,
  );
}

function promotedParamsOf(
  node: FlowNode,
  descriptor: NodeDescriptor,
  stepId: string,
): EffectiveParam[] {
  if (!descriptor.inputSource) return [];
  const rawKey = node.params[descriptor.inputSource.paramKeyParam];
  if (typeof rawKey !== 'string' || rawKey === '') return [];
  const port = descriptor.out.find((candidate) => candidate.name === descriptor.inputSource!.port);
  if (!port || port.type === 'T') return [];
  const label = typeof node.params.label === 'string' ? node.params.label : node.label;
  const defaultValue = node.params.default;
  const param: EffectiveParam = {
    key: rawKey,
    type: port.type as PortValueType,
    required: defaultValue === undefined,
    source: 'promoted',
    stepId,
    paramKey: rawKey,
  };
  if (label !== undefined) param.label = label;
  if (defaultValue !== undefined) param.default = defaultValue;
  return [param];
}

interface ParamBinding {
  subflowNodeId: string;
  childKey: string;
  source: FlatRef;
}

export function flattenDocument(
  document: FlowDocument,
  file: string,
  prefix: string[],
  stack: string[],
  context: FlattenContext,
): FlattenOutput {
  const nodesById = new Map<string, FlowNode>();
  for (const node of document.nodes) {
    if (nodesById.has(node.id)) {
      context.errors.push(flowError(
        'SCHEMA_INVALID', qualify(prefix, node.id),
        `duplicate node id "${node.id}"`, { file },
      ));
      continue;
    }
    nodesById.set(node.id, node);
  }

  const children = new Map<string, FlattenOutput>();
  const flatNodes: FlatNode[] = [];
  const ownParams: EffectiveParam[] = [];

  for (const node of document.nodes) {
    const stepId = qualify(prefix, node.id);
    if (node.type === SUBFLOW_NODE_TYPE) {
      const child = loadSubflow(node, file, prefix, stack, context);
      if (child) children.set(node.id, child);
      continue;
    }

    if (node.flow !== undefined || node.version !== undefined || node.aliases !== undefined) {
      context.errors.push(flowError(
        'PARAM_INVALID', stepId,
        '`flow`, `version` and `aliases` are only valid on a subflow node', { file },
      ));
    }

    const descriptor = context.registry.get(node.type);
    if (!descriptor) {
      context.errors.push(flowError(
        'UNKNOWN_NODE_TYPE', stepId,
        `unknown node type "${node.type}"`, { file },
      ));
      continue;
    }

    const paramResult = descriptor.paramSchema.safeParse(node.params);
    if (!paramResult.success) {
      for (const issue of paramResult.error.issues) {
        const where = issue.path.length > 0 ? issue.path.join('.') : '(params)';
        context.errors.push(flowError(
          'PARAM_INVALID', stepId,
          `params.${where}: ${issue.message}`, { file },
        ));
      }
    }

    const flat: FlatNode = {
      id: stepId,
      nodeId: node.id,
      path: [...prefix],
      type: node.type,
      params: node.params,
      descriptor,
      file,
    };
    if (node.label !== undefined) flat.label = node.label;
    const promoted = promotedParamsOf(node, descriptor, stepId);
    if (promoted.length > 0) {
      flat.rawParamKey = promoted[0].paramKey;
      ownParams.push(...promoted);
    }
    flatNodes.push(flat);
  }

  const flatById = new Map(flatNodes.map((node) => [node.id, node]));

  const resolveSource = (ref: string, context_: string): FlatRef | null => {
    const parsed = parsePortRef(ref);
    if (!parsed) {
      context.errors.push(flowError('PORT_UNRESOLVED', null, `${context_}: "${ref}" is not a nodeId.port reference`, { file }));
      return null;
    }
    const node = nodesById.get(parsed.nodeId);
    if (!node) {
      context.errors.push(flowError(
        'PORT_UNRESOLVED', qualify(prefix, parsed.nodeId),
        `${context_}: no node "${parsed.nodeId}" in this flow`, { file, port: parsed.port },
      ));
      return null;
    }
    if (node.type === SUBFLOW_NODE_TYPE) {
      const child = children.get(node.id);
      if (!child) return null; // subflow already failed to load; error reported
      const output = child.outputs.get(parsed.port);
      if (!output) {
        context.errors.push(flowError(
          'PORT_UNRESOLVED', qualify(prefix, parsed.nodeId),
          `${context_}: subflow exposes no output "${parsed.port}"`, { file, port: parsed.port },
        ));
        return null;
      }
      return output;
    }
    const flat = flatById.get(qualify(prefix, parsed.nodeId));
    if (!flat) return null; // unknown node type; error reported
    if (!flat.descriptor.out.some((port) => port.name === parsed.port)) {
      context.errors.push(flowError(
        'PORT_UNRESOLVED', flat.id,
        `${context_}: node type "${flat.type}" has no out-port "${parsed.port}"`, { file, port: parsed.port },
      ));
      return null;
    }
    return { stepId: flat.id, port: parsed.port };
  };

  const edges: FlatEdge[] = [];
  const bindings: ParamBinding[] = [];
  const boundPorts = new Set<string>();

  for (const edge of document.edges) {
    const source = resolveSource(edge.from, 'edge source');
    const target = parsePortRef(edge.to);
    if (!target) {
      context.errors.push(flowError('PORT_UNRESOLVED', null, `edge target: "${edge.to}" is not a nodeId.port reference`, { file }));
      continue;
    }
    const targetNode = nodesById.get(target.nodeId);
    if (!targetNode) {
      context.errors.push(flowError(
        'PORT_UNRESOLVED', qualify(prefix, target.nodeId),
        `edge target: no node "${target.nodeId}" in this flow`, { file, port: target.port },
      ));
      continue;
    }
    if (!source) continue;

    if (targetNode.type === SUBFLOW_NODE_TYPE) {
      const child = children.get(targetNode.id);
      if (!child) continue;
      const entry = child.params.find(
        (param) => param.key === target.port && param.source === 'promoted',
      );
      if (!entry) {
        context.errors.push(flowError(
          'PORT_UNRESOLVED', qualify(prefix, target.nodeId),
          `edge target: subflow exposes no input port "${target.port}"`, { file, port: target.port },
        ));
        continue;
      }
      const bindKey = `${targetNode.id}.${target.port}`;
      if (boundPorts.has(bindKey)) {
        context.errors.push(flowError(
          'COALESCE_ILLEGAL', qualify(prefix, target.nodeId),
          `subflow input port "${target.port}" is fed by more than one edge`, { file, port: target.port },
        ));
        continue;
      }
      boundPorts.add(bindKey);
      bindings.push({ subflowNodeId: targetNode.id, childKey: target.port, source });
      continue;
    }

    const targetFlat = flatById.get(qualify(prefix, target.nodeId));
    if (!targetFlat) continue;
    if (!targetFlat.descriptor.in.some((port) => port.name === target.port)) {
      context.errors.push(flowError(
        'PORT_UNRESOLVED', targetFlat.id,
        `edge target: node type "${targetFlat.type}" has no in-port "${target.port}"`,
        { file, port: target.port },
      ));
      continue;
    }
    edges.push({ from: source, to: { stepId: targetFlat.id, port: target.port }, file });
  }

  const rewires = applyBindings(bindings, children);

  const outputs = new Map<string, FlatRef>();
  for (const output of document.outputs) {
    if (outputs.has(output.name)) {
      // Outputs are a MAP keyed by name — a second declaration would silently
      // overwrite the first (and a parent edge reading it would follow the
      // wrong port), so the collision is an elaboration error.
      context.errors.push(flowError(
        'OUTPUT_NAME_COLLISION', null,
        `flow output "${output.name}" is declared more than once — output names must be unique`,
        { file },
      ));
      continue;
    }
    const resolved = resolveSource(output.from, `output "${output.name}"`);
    if (!resolved) {
      context.errors.push(flowError(
        'OUTPUT_UNRESOLVED', null,
        `flow output "${output.name}" does not resolve to a live port`, { file },
      ));
      continue;
    }
    outputs.set(output.name, resolved);
  }
  // Refs resolved above captured their source BEFORE the bindings deleted the
  // promoted input nodes they may transit — re-point them at the live port.
  rewriteRefs(edges, outputs, rewires);

  // Merge children (post-binding) into this level.
  const params: EffectiveParam[] = [...ownParams, ...declaredParams(document)];
  for (const node of document.nodes) {
    if (node.type !== SUBFLOW_NODE_TYPE) continue;
    const child = children.get(node.id);
    if (!child) continue;
    flatNodes.push(...child.nodes);
    edges.push(...child.edges);
    for (const childParam of child.params) {
      const namespaced = `${node.id}.${childParam.key}`;
      const alias = node.aliases?.[namespaced] ?? node.aliases?.[childParam.key];
      const promotedUp: EffectiveParam = { ...childParam, key: alias ?? namespaced };
      if (alias) promotedUp.aliasOf = namespaced;
      params.push(promotedUp);
    }
  }

  reportParamCollisions(params, file, context);

  return { nodes: flatNodes, edges, params, outputs };
}

function declaredParams(document: FlowDocument): EffectiveParam[] {
  return document.params.map((param) => {
    const effective: EffectiveParam = {
      key: param.key,
      type: param.type,
      required: param.required ?? param.default === undefined,
      source: 'declared',
    };
    if (param.label !== undefined) effective.label = param.label;
    if (param.description !== undefined) effective.description = param.description;
    if (param.default !== undefined) effective.default = param.default;
    return effective;
  });
}

/**
 * `stepId` + out-port of a promoted input node that an edge binding deleted.
 * `*` stands for "every port of that step" (used when the input node itself
 * could not be found, so its source port is unknown).
 */
type RewireMap = Map<string, FlatRef>;

function rewireKey(stepId: string, port: string | undefined): string {
  return `${stepId}\u0000${port ?? '*'}`;
}

function lookupRewire(rewires: RewireMap, ref: FlatRef): FlatRef | undefined {
  return rewires.get(rewireKey(ref.stepId, ref.port)) ?? rewires.get(rewireKey(ref.stepId, undefined));
}

/**
 * A binding source may itself be a port of a step that ANOTHER binding at this
 * level deletes (subflow A fed from subflow B's output, where B's output
 * transits B's own edge-bound input node). Chase every target to its final
 * live port before anything is rewritten; a cycle is left untouched and caught
 * by the dangling-edge invariant instead of looping forever.
 */
function collapseRewireChains(rewires: RewireMap): void {
  for (const [key, target] of rewires) {
    let current = target;
    const seen = new Set<string>([key]);
    for (;;) {
      const next = lookupRewire(rewires, current);
      if (!next) break;
      const nextKey = rewireKey(current.stepId, current.port);
      if (seen.has(nextKey)) return;
      seen.add(nextKey);
      current = next;
    }
    rewires.set(key, current);
  }
}

/**
 * Rewires a subflow's inner graph for every param that the parent supplies by
 * EDGE: the promoted input node disappears and its consumers read straight
 * from the parent's source port. The param stops being a form param.
 *
 * Returns the rewire map so the CALLER can fix up its own already-resolved
 * refs — a parent edge or output that reads a subflow output which transits a
 * promoted input node captured that inner step id before it was deleted, and
 * would otherwise stay dangling in an `ok:true` DAG.
 */
function applyBindings(bindings: ParamBinding[], children: Map<string, FlattenOutput>): RewireMap {
  const rewires: RewireMap = new Map();
  for (const binding of bindings) {
    const child = children.get(binding.subflowNodeId);
    if (!child) continue;
    const index = child.params.findIndex(
      (param) => param.key === binding.childKey && param.source === 'promoted',
    );
    if (index === -1) continue;
    const [entry] = child.params.splice(index, 1);
    if (entry.stepId === undefined) continue;
    const inputNode = child.nodes.find((node) => node.id === entry.stepId);
    const sourcePort = inputNode?.descriptor.inputSource?.port;
    child.nodes = child.nodes.filter((node) => node.id !== entry.stepId);
    rewires.set(rewireKey(entry.stepId, sourcePort), { ...binding.source });
  }
  if (rewires.size === 0) return rewires;

  collapseRewireChains(rewires);
  for (const child of children.values()) {
    rewriteRefs(child.edges, child.outputs, rewires);
  }
  return rewires;
}

/** Points every edge source and output ref at its post-binding live port. */
function rewriteRefs(edges: FlatEdge[], outputs: Map<string, FlatRef>, rewires: RewireMap): void {
  if (rewires.size === 0) return;
  for (const edge of edges) {
    const target = lookupRewire(rewires, edge.from);
    if (target) edge.from = { ...target };
  }
  for (const [name, ref] of outputs) {
    const target = lookupRewire(rewires, ref);
    if (target) outputs.set(name, { ...target });
  }
}

function reportParamCollisions(
  params: EffectiveParam[],
  file: string,
  context: FlattenContext,
): void {
  const seen = new Map<string, EffectiveParam>();
  for (const param of params) {
    const previous = seen.get(param.key);
    if (previous) {
      context.errors.push(flowError(
        'PARAM_KEY_COLLISION', param.stepId ?? previous.stepId ?? null,
        `effective param key "${param.key}" is claimed twice (${describeParam(previous)} and ${describeParam(param)}) — alias one of them on the Subflow node`,
        { file },
      ));
      continue;
    }
    seen.set(param.key, param);
  }
}

function describeParam(param: EffectiveParam): string {
  if (param.source === 'declared') return 'declared flow param';
  return `promoted from ${param.stepId ?? 'an input node'}`;
}
