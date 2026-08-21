/**
 * The typed topological walk: resolves every port's concrete type (including
 * parametric `T` passthrough and the JSON schema it carries), checks every
 * edge nominally, validates declared json field accesses, enforces the
 * multi-edge / coalesce rules, and computes each step's exclusive-route set.
 */
import { flowError, type FlowError } from '../models/errors.js';
import type {
  ElaboratedStep, JsonSchemaNode, PortValueType, ResolvedPort, RouteMarker, StepInputBinding,
} from '../models/types.js';
import { canonicalJson } from '../schema/serialize.js';
import type { FlatEdge, FlatNode } from './flatten.js';
import { indexIncoming, topoSort } from './graph.js';
import { checkFieldPath, describeFieldMiss } from './json-path.js';
import {
  allPairsExclusive, anyPairExclusive, conflictBetween, dedupeRoutes,
  describeConflict, intersectRoutes, unionRoutes,
} from './routes.js';

export interface PortType {
  type: PortValueType;
  jsonSchema?: JsonSchemaNode;
  exclusiveGroup?: string;
}

interface EdgeInfo {
  edge: FlatEdge;
  type?: PortValueType;
  jsonSchema?: JsonSchemaNode;
  route: RouteMarker[];
}

export interface ResolveResult {
  steps: ElaboratedStep[];
  order: string[];
  portTypes: Map<string, Map<string, PortType>>;
}

export function resolveSteps(
  nodes: FlatNode[],
  edges: FlatEdge[],
  errors: FlowError[],
): ResolveResult | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const { order, cycles } = topoSort(nodes, edges);
  if (cycles.length > 0) {
    for (const cycle of cycles) {
      errors.push(flowError('CYCLE', cycle[0], `cycle detected: ${cycle.join(' → ')}`));
    }
    return null;
  }

  const incoming = indexIncoming(edges);
  const portTypes = new Map<string, Map<string, PortType>>();
  const routeSets = new Map<string, RouteMarker[]>();
  const steps: ElaboratedStep[] = [];

  for (const stepId of order) {
    const node = byId.get(stepId);
    if (!node) continue;
    const byPort = incoming.get(stepId) ?? new Map<string, FlatEdge[]>();

    const portEdges = new Map<string, EdgeInfo[]>();
    for (const descriptor of node.descriptor.in) {
      const list = byPort.get(descriptor.name) ?? [];
      portEdges.set(descriptor.name, list.map((edge) => {
        const source = portTypes.get(edge.from.stepId)?.get(edge.from.port);
        const base = routeSets.get(edge.from.stepId) ?? [];
        const route = source?.exclusiveGroup
          ? dedupeRoutes([...base, {
            stepId: edge.from.stepId,
            group: source.exclusiveGroup,
            branch: edge.from.port,
          }])
          : base;
        const info: EdgeInfo = { edge, route };
        if (source?.type) info.type = source.type;
        if (source?.jsonSchema) info.jsonSchema = source.jsonSchema;
        return info;
      }));
    }

    checkFanIn(node, portEdges, errors);
    const parametric = resolveParametric(node, portEdges, errors);
    checkNominalTypes(node, portEdges, parametric.type, errors);
    checkRequiredPorts(node, portEdges, errors);
    checkJsonFieldAccess(node, portEdges, parametric, errors);

    const routeSet = computeRouteSet(node, portEdges, errors);
    routeSets.set(stepId, routeSet);

    const outputs = resolveOutputs(node, parametric);
    portTypes.set(stepId, new Map(outputs.map((port) => {
      const entry: PortType = { type: port.type };
      if (port.jsonSchema) entry.jsonSchema = port.jsonSchema;
      if (port.exclusiveGroup) entry.exclusiveGroup = port.exclusiveGroup;
      return [port.name, entry];
    })));

    steps.push(buildStep(node, portEdges, outputs, routeSet));
  }

  return { steps, order, portTypes };
}

function checkFanIn(
  node: FlatNode,
  portEdges: Map<string, EdgeInfo[]>,
  errors: FlowError[],
): void {
  for (const descriptor of node.descriptor.in) {
    const infos = portEdges.get(descriptor.name) ?? [];
    if (infos.length < 2) continue;
    const routes = infos.map((info) => info.route);
    if (descriptor.variadic) {
      if (anyPairExclusive(routes)) {
        errors.push(flowError(
          'COALESCE_ILLEGAL', node.id,
          `in-port "${descriptor.name}" collects several values and cannot join mutually exclusive routes`,
          { port: descriptor.name, file: node.file },
        ));
      }
      continue;
    }
    if (!allPairsExclusive(routes)) {
      errors.push(flowError(
        'COALESCE_ILLEGAL', node.id,
        `in-port "${descriptor.name}" is fed by ${infos.length} concurrently live edges — only mutually exclusive routes may share a port`,
        { port: descriptor.name, file: node.file },
      ));
      continue;
    }
    if (!descriptor.coalescing) {
      errors.push(flowError(
        'COALESCE_ILLEGAL', node.id,
        `in-port "${descriptor.name}" is fed by mutually exclusive routes but node type "${node.type}" does not declare it coalescing`,
        { port: descriptor.name, file: node.file },
      ));
    }
  }
}

interface Parametric {
  type?: PortValueType;
  jsonSchema?: JsonSchemaNode;
}

function resolveParametric(
  node: FlatNode,
  portEdges: Map<string, EdgeInfo[]>,
  errors: FlowError[],
): Parametric {
  const generic = node.descriptor.in.filter((port) => port.type === 'T');
  if (generic.length === 0) return {};

  const candidates: EdgeInfo[] = [];
  for (const port of generic) candidates.push(...(portEdges.get(port.name) ?? []));
  const typed = candidates.filter((info) => info.type !== undefined);
  const distinct = [...new Set(typed.map((info) => info.type as PortValueType))];

  if (distinct.length > 1) {
    errors.push(flowError(
      'PORT_TYPE_MISMATCH', node.id,
      `passthrough type T is fed by incompatible types (${distinct.join(', ')}) — no implicit coercion`,
      { file: node.file },
    ));
    return {};
  }
  if (distinct.length === 0) {
    if (generic.some((port) => port.required)) {
      errors.push(flowError(
        'PARAMETRIC_UNRESOLVED', node.id,
        `passthrough type T could not be resolved — connect ${generic.map((port) => `"${port.name}"`).join(' or ')}`,
        { file: node.file },
      ));
    }
    return {};
  }

  const result: Parametric = { type: distinct[0] };
  const schemas = typed.filter((info) => info.jsonSchema !== undefined);
  const distinctSchemas = new Set(schemas.map((info) => canonicalJson(info.jsonSchema)));
  if (schemas.length > 0 && distinctSchemas.size === 1) {
    result.jsonSchema = schemas[0].jsonSchema as JsonSchemaNode;
  }
  return result;
}

function checkNominalTypes(
  node: FlatNode,
  portEdges: Map<string, EdgeInfo[]>,
  resolvedT: PortValueType | undefined,
  errors: FlowError[],
): void {
  for (const descriptor of node.descriptor.in) {
    const expected = descriptor.type === 'T' ? resolvedT : descriptor.type;
    if (!expected) continue;
    for (const info of portEdges.get(descriptor.name) ?? []) {
      if (info.type === undefined || info.type === expected) continue;
      errors.push(flowError(
        'PORT_TYPE_MISMATCH', node.id,
        `in-port "${descriptor.name}" expects ${expected} but ${info.edge.from.stepId}.${info.edge.from.port} produces ${info.type} — no implicit coercion`,
        { port: descriptor.name, file: node.file },
      ));
    }
  }
}

function checkRequiredPorts(
  node: FlatNode,
  portEdges: Map<string, EdgeInfo[]>,
  errors: FlowError[],
): void {
  for (const descriptor of node.descriptor.in) {
    if (!descriptor.required) continue;
    if ((portEdges.get(descriptor.name) ?? []).length > 0) continue;
    errors.push(flowError(
      'PORT_UNRESOLVED', node.id,
      `required in-port "${descriptor.name}" of node type "${node.type}" is not connected`,
      { port: descriptor.name, file: node.file },
    ));
  }
  for (const group of node.descriptor.requireAnyOf ?? []) {
    if (group.some((name) => (portEdges.get(name) ?? []).length > 0)) continue;
    errors.push(flowError(
      'PORT_UNRESOLVED', node.id,
      `node type "${node.type}" needs at least one of the in-ports ${group.map((name) => `"${name}"`).join(', ')} connected`,
      { file: node.file },
    ));
  }
}

function checkJsonFieldAccess(
  node: FlatNode,
  portEdges: Map<string, EdgeInfo[]>,
  parametric: Parametric,
  errors: FlowError[],
): void {
  const access = node.descriptor.jsonFieldAccess;
  if (!access) return;
  const raw = node.params[access.param];
  if (typeof raw !== 'string' || raw === '') return;

  const descriptor = node.descriptor.in.find((port) => port.name === access.port);
  if (!descriptor) return;
  const effective = descriptor.type === 'T' ? parametric.type : descriptor.type;
  if (effective === undefined) return;
  if (effective !== 'json') {
    errors.push(flowError(
      'PARAM_INVALID', node.id,
      `params.${access.param} is a JSON field access but in-port "${access.port}" carries ${effective}`,
      { port: access.port, file: node.file },
    ));
    return;
  }
  const schema = descriptor.type === 'T'
    ? parametric.jsonSchema
    : (portEdges.get(access.port) ?? []).find((info) => info.jsonSchema)?.jsonSchema;
  // No declared schema upstream → free-form json, checked at runtime.
  if (!schema) return;
  const miss = checkFieldPath(schema, raw);
  if (miss) {
    errors.push(flowError(
      'JSON_FIELD_MISS', node.id, describeFieldMiss(raw, miss),
      { port: access.port, file: node.file },
    ));
  }
}

function computeRouteSet(
  node: FlatNode,
  portEdges: Map<string, EdgeInfo[]>,
  errors: FlowError[],
): RouteMarker[] {
  const perPort: Array<{ name: string; route: RouteMarker[] }> = [];
  for (const descriptor of node.descriptor.in) {
    if (!descriptor.required) continue;
    const infos = portEdges.get(descriptor.name) ?? [];
    if (infos.length === 0) continue;
    const route = infos.length === 1
      ? infos[0].route
      : intersectRoutes(infos.map((info) => info.route));
    perPort.push({ name: descriptor.name, route });
  }
  // A require-any-of group behaves like a coalesce for liveness: the step runs
  // when ANY member is live, so its condition is the intersection.
  for (const group of node.descriptor.requireAnyOf ?? []) {
    const routes: RouteMarker[][] = [];
    for (const name of group) {
      const infos = portEdges.get(name) ?? [];
      if (infos.length === 0) continue;
      routes.push(infos.length === 1 ? infos[0].route : intersectRoutes(infos.map((info) => info.route)));
    }
    if (routes.length === 0) continue;
    perPort.push({ name: `(${group.join('|')})`, route: intersectRoutes(routes) });
  }

  for (let i = 0; i < perPort.length; i += 1) {
    for (let j = i + 1; j < perPort.length; j += 1) {
      const conflict = conflictBetween(perPort[i].route, perPort[j].route);
      if (!conflict) continue;
      errors.push(flowError(
        'MIXED_EXCLUSIVE_ROUTES', node.id,
        `required in-ports "${perPort[i].name}" and "${perPort[j].name}" come from mutually exclusive routes at ${describeConflict(conflict)} — this step could never run`,
        { file: node.file },
      ));
    }
  }
  return unionRoutes(perPort.map((entry) => entry.route));
}

function resolveOutputs(node: FlatNode, parametric: Parametric): ResolvedPort[] {
  const outputs: ResolvedPort[] = [];
  for (const descriptor of node.descriptor.out) {
    const type = descriptor.type === 'T' ? parametric.type : descriptor.type;
    if (!type) continue;
    const port: ResolvedPort = { name: descriptor.name, type, required: false };
    if (descriptor.type === 'T') {
      if (parametric.jsonSchema) port.jsonSchema = parametric.jsonSchema;
    } else if (descriptor.jsonSchemaParam) {
      const raw = node.params[descriptor.jsonSchemaParam];
      if (raw !== null && typeof raw === 'object') port.jsonSchema = raw as JsonSchemaNode;
    }
    if (descriptor.exclusiveGroup) port.exclusiveGroup = descriptor.exclusiveGroup;
    outputs.push(port);
  }
  return outputs;
}

function buildStep(
  node: FlatNode,
  portEdges: Map<string, EdgeInfo[]>,
  outputs: ResolvedPort[],
  routeSet: RouteMarker[],
): ElaboratedStep {
  const inputs: StepInputBinding[] = [];
  const requiredUpstream = new Set<string>();
  const coalescingPorts: string[] = [];

  for (const descriptor of node.descriptor.in) {
    const infos = portEdges.get(descriptor.name) ?? [];
    if (descriptor.coalescing && infos.length > 0) coalescingPorts.push(descriptor.name);
    for (const info of infos) {
      const binding: StepInputBinding = {
        port: descriptor.name,
        fromStep: info.edge.from.stepId,
        fromPort: info.edge.from.port,
        type: info.type ?? 'json',
        routeSet: info.route,
      };
      if (info.jsonSchema) binding.jsonSchema = info.jsonSchema;
      inputs.push(binding);
      // Skip propagates through required inputs. A coalescing port survives as
      // long as ONE of its exclusive sources ran, so it never propagates skip.
      if (descriptor.required && !descriptor.coalescing) {
        requiredUpstream.add(info.edge.from.stepId);
      }
    }
  }

  const step: ElaboratedStep = {
    id: node.id,
    nodeId: node.nodeId,
    path: node.path,
    type: node.type,
    params: node.params,
    effect: node.descriptor.effect === true,
    inputs,
    outputs,
    routeSet,
    requiredUpstream: [...requiredUpstream],
    coalescingPorts,
  };
  if (node.label !== undefined) step.label = node.label;
  return step;
}
