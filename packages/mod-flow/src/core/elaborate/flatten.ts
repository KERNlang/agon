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
import { applyBindings, rewriteRefs } from './bindings.js';
import type { ParamBinding } from './bindings.js';
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
    // A duplicate id is already reported above; flattening it a second time
    // would put two FlatNodes with the SAME step id in the graph and corrupt
    // the indegree count topoSort builds from them.
    if (nodesById.get(node.id) !== node) continue;
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
    ownParams.push(...promotedParamsOf(node, descriptor, stepId));
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
