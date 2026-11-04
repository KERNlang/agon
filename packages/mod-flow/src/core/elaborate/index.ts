/**
 * Elaborate-then-execute, phase one: turn a `.agon-flow.json` document into a
 * FLAT, TYPED step-DAG — or into node-id-addressed errors. Nothing here
 * dispatches an engine; this core deliberately has no adapter dependency, so
 * `agon flow validate` provably spends zero subscription tokens.
 */
import { flowError, FlowValidationError, type ElaborationResult, type FlowError } from '../models/errors.js';
import type { ElaboratedFlow, ElaboratedOutput, ElaboratedStep, FlowDocument } from '../models/types.js';
import { createDefaultNodeRegistry } from '../registry/catalog.js';
import type { NodeRegistry } from '../registry/descriptor.js';
import { parseFlowJson } from '../schema/flow-schema.js';
import { flattenDocument, type FlattenContext } from './flatten.js';
import { createFsFlowLoader, type FlowLoader } from './loader.js';
import { resolveSteps } from './resolve.js';

export interface ElaborateOptions {
  /** Node descriptor registry. Defaults to the v1 catalog. */
  registry?: NodeRegistry;
  /** Subflow file resolution. Defaults to the real filesystem. */
  loader?: FlowLoader;
  /**
   * Path the document was read from — relative subflow refs resolve against
   * its directory. Required when the flow references subflows.
   */
  file?: string;
}

export function elaborateDocument(
  document: FlowDocument,
  options: ElaborateOptions = {},
): ElaborationResult {
  const errors: FlowError[] = [];
  const context: FlattenContext = {
    registry: options.registry ?? createDefaultNodeRegistry(),
    loader: options.loader ?? createFsFlowLoader(),
    errors,
  };
  const file = options.file ?? '<memory>/flow.agon-flow.json';

  const flat = flattenDocument(document, file, [], [file], context);
  const resolved = resolveSteps(flat.nodes, flat.edges, errors);
  if (!resolved) return { ok: false, errors };

  const stepsById = new Map(resolved.steps.map((step) => [step.id, step]));
  const outputs: ElaboratedOutput[] = [];
  for (const [name, ref] of flat.outputs) {
    const type = resolved.portTypes.get(ref.stepId)?.get(ref.port);
    if (!type) {
      errors.push(flowError(
        'OUTPUT_UNRESOLVED', ref.stepId,
        `flow output "${name}" points at ${ref.stepId}.${ref.port}, whose type could not be resolved`,
        { port: ref.port, file },
      ));
      continue;
    }
    const output: ElaboratedOutput = { name, stepId: ref.stepId, port: ref.port, type: type.type };
    if (type.jsonSchema) output.jsonSchema = type.jsonSchema;
    outputs.push(output);
  }

  // Promoted params carry their effective (possibly namespaced/aliased) key
  // back onto the step that consumes them, so the Use-tab form and
  // `--param k=v` bind to the same name the runtime looks for.
  for (const param of flat.params) {
    if (param.source !== 'promoted' || !param.stepId) continue;
    const step = stepsById.get(param.stepId);
    if (step) step.paramKey = param.key;
  }

  if (errors.length > 0) return { ok: false, errors };

  const elaborated: ElaboratedFlow = {
    schemaVersion: document.schemaVersion,
    id: document.id,
    name: document.name,
    version: document.version,
    params: flat.params,
    steps: resolved.steps,
    order: resolved.order,
    outputs,
    effects: resolved.steps.filter((step: ElaboratedStep) => step.effect).map((step) => step.id),
  };
  if (document.description !== undefined) elaborated.description = document.description;
  if (options.file !== undefined) elaborated.sourcePath = options.file;
  return { ok: true, flow: elaborated, errors: [] };
}

export function elaborateFlowText(
  text: string,
  file: string,
  options: Omit<ElaborateOptions, 'file'> = {},
): ElaborationResult {
  const parsed = parseFlowJson(text, file);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  return elaborateDocument(parsed.document, { ...options, file });
}

export function elaborateFlowFile(
  file: string,
  options: Omit<ElaborateOptions, 'file'> = {},
): ElaborationResult {
  const loader = options.loader ?? createFsFlowLoader();
  const resolvedPath = loader.resolveEntry(file);
  const text = loader.read(resolvedPath);
  if (text === null) {
    return {
      ok: false,
      errors: [flowError('FLOW_FILE_UNRESOLVED', null, `flow file not found: ${file}`)],
    };
  }
  return elaborateFlowText(text, resolvedPath, { ...options, loader });
}

/** Convenience wrapper for callers that prefer exceptions. */
export function elaborateOrThrow(
  document: FlowDocument,
  options: ElaborateOptions = {},
): ElaboratedFlow {
  const result = elaborateDocument(document, options);
  if (!result.ok) throw new FlowValidationError(result.errors);
  return result.flow;
}
