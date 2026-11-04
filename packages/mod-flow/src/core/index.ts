/**
 * Agon Flow schema, node registry and elaborator.
 *
 * Slice 1 (schema + elaborator + `agon flow validate`). The runtime, artifact
 * store and daemon job wiring land in slice 2; the `execute` interface and its
 * ctx types are already declared here so nothing has to move.
 */
export * from './models/types.js';
export * from './models/errors.js';

export {
  FlowDocumentSchema, FlowNodeSchema, FlowEdgeSchema, FlowParamSchema,
  FlowOutputSchema, FlowPositionSchema, PortValueTypeSchema,
  parseFlowDocument, parseFlowJson, isUlid, ULID_RE,
} from './schema/flow-schema.js';
export type { ParseFlowResult } from './schema/flow-schema.js';
export { canonicalize, canonicalJson, serializeFlow } from './schema/serialize.js';
export {
  parseSemver, isSemver, compareSemver, checkRange, satisfies,
} from './schema/semver.js';
export type { SemVer, RangeCheck } from './schema/semver.js';

export {
  NodeRegistry, SUBFLOW_NODE_TYPE,
} from './registry/descriptor.js';
export type {
  NodeDescriptor, NodeCategory, PortDescriptor, NodeExecute, NodeExecuteContext,
  FlowServices, FlowEngineService, FlowEngineDispatchRequest, FlowEngineDispatchResult,
  FlowArtifactStore, FlowArtifactRef, FlowFileRef, FlowFolderRef, FlowFileSetRef,
  FlowStepEvent, FlowValue, JsonValue,
} from './registry/descriptor.js';
export {
  createDefaultNodeRegistry, V1_NODE_CATALOG, COMPARE_OPERATORS, OVERWRITE_POLICIES,
  CHAT_INPUT, FILE_PICKER, FOLDER_PICKER, READ_FILE, LIST_FOLDER, ENGINE, TEMPLATE,
  EXTRACT_STRUCTURED, IF_COMPARE, NERO_VERIFY, APPROVAL, WRITE_FILE, MOVE_FILE,
  MARKDOWN_TO_PDF, CHAT_OUTPUT,
} from './registry/catalog.js';

export {
  elaborateDocument, elaborateFlowText, elaborateFlowFile, elaborateOrThrow,
} from './elaborate/index.js';
export type { ElaborateOptions } from './elaborate/index.js';
export { createFsFlowLoader, createMemoryFlowLoader } from './elaborate/loader.js';
export type { FlowLoader } from './elaborate/loader.js';
export { checkFieldPath, describeFieldMiss } from './elaborate/json-path.js';
export type { FieldMiss } from './elaborate/json-path.js';
