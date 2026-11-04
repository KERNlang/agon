/**
 * Agon Flow — v1 node catalog (spec "v1 Node Catalog"). TYPE-LEVEL only:
 * ports, param schemas, effect/coalescing/exclusive-route/json-schema flags.
 * `execute` is deliberately absent on every descriptor — the runtime is slice 2.
 */
import { z } from 'zod';

import { NodeRegistry, type NodeDescriptor } from './descriptor.js';

/**
 * Structural JSON-schema acceptor. Loose on purpose: only the parts the
 * elaborator reads (`type`, `properties`, `items`, `required`) are named; the
 * rest of a user's schema rides along untouched.
 */
const JsonSchemaLike = z.looseObject({
  type: z.union([z.string(), z.array(z.string())]).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  items: z.unknown().optional(),
  required: z.array(z.string()).optional(),
});

const ParamKey = z.string().min(1).regex(
  /^[A-Za-z_][A-Za-z0-9_-]*$/,
  'paramKey must be an identifier (letters, digits, _ and -)',
);

export const COMPARE_OPERATORS = ['>', '<', '==', 'contains', 'length'] as const;
export const OVERWRITE_POLICIES = ['error', 'overwrite', 'rename'] as const;

export const CHAT_INPUT: NodeDescriptor = {
  type: 'chat-input',
  title: 'Chat/Text Input',
  description: 'Free text supplied by the user (Use-tab form or --param).',
  category: 'input',
  in: [],
  out: [{ name: 'text', type: 'text' }],
  paramSchema: z.strictObject({
    paramKey: ParamKey,
    label: z.string().optional(),
    default: z.string().optional(),
  }),
  inputSource: { paramKeyParam: 'paramKey', port: 'text' },
};

export const FILE_PICKER: NodeDescriptor = {
  type: 'file-picker',
  title: 'File Picker',
  description: 'A single file chosen by the user.',
  category: 'input',
  in: [],
  out: [{ name: 'file', type: 'file' }],
  paramSchema: z.strictObject({
    paramKey: ParamKey,
    label: z.string().optional(),
    filters: z.array(z.string()).optional(),
  }),
  inputSource: { paramKeyParam: 'paramKey', port: 'file' },
};

export const FOLDER_PICKER: NodeDescriptor = {
  type: 'folder-picker',
  title: 'Folder Picker',
  description: 'A folder chosen by the user.',
  category: 'input',
  in: [],
  out: [{ name: 'folder', type: 'folder' }],
  paramSchema: z.strictObject({
    paramKey: ParamKey,
    label: z.string().optional(),
  }),
  inputSource: { paramKeyParam: 'paramKey', port: 'folder' },
};

export const READ_FILE: NodeDescriptor = {
  type: 'read-file',
  title: 'Read File',
  description: 'Reads a file into text.',
  category: 'io',
  in: [{ name: 'file', type: 'file', required: true }],
  out: [{ name: 'text', type: 'text' }],
  paramSchema: z.strictObject({ encoding: z.string().optional() }),
};

export const LIST_FOLDER: NodeDescriptor = {
  type: 'list-folder',
  title: 'List Folder',
  description: 'Lists a folder into a fileset.',
  category: 'io',
  in: [{ name: 'folder', type: 'folder', required: true }],
  out: [{ name: 'fileset', type: 'fileset' }],
  paramSchema: z.strictObject({
    glob: z.string().optional(),
    recursive: z.boolean().optional(),
  }),
};

export const ENGINE: NodeDescriptor = {
  type: 'engine',
  title: 'Engine',
  description: "Dispatches a prompt to one of the user's own CLI engines.",
  category: 'ai',
  in: [
    { name: 'prompt', type: 'text', required: true },
    { name: 'context', type: 'json', required: false },
  ],
  out: [{ name: 'text', type: 'text' }],
  paramSchema: z.strictObject({
    engineId: z.string().min(1),
    mode: z.string().optional(),
    systemPreset: z.string().optional(),
    maxRetries: z.number().int().min(0).max(10).optional(),
  }),
};

export const TEMPLATE: NodeDescriptor = {
  type: 'template',
  title: 'Template',
  description: 'Mustache-style template over text and json inputs.',
  category: 'io',
  in: [
    { name: 'text', type: 'text', required: false, variadic: true },
    { name: 'json', type: 'json', required: false },
  ],
  out: [{ name: 'text', type: 'text' }],
  paramSchema: z.strictObject({ template: z.string().min(1) }),
};

export const EXTRACT_STRUCTURED: NodeDescriptor = {
  type: 'extract-structured',
  title: 'Extract Structured',
  description: 'Turns free text into JSON matching a declared schema.',
  category: 'ai',
  in: [{ name: 'text', type: 'text', required: true }],
  out: [{ name: 'json', type: 'json', jsonSchemaParam: 'schema' }],
  paramSchema: z.strictObject({
    schema: JsonSchemaLike,
    engineId: z.string().min(1).optional(),
  }),
};

export const IF_COMPARE: NodeDescriptor = {
  type: 'if-compare',
  title: 'If/Compare',
  description: 'Routes its input down exactly one of two mutually exclusive branches.',
  category: 'control',
  in: [{ name: 'in', type: 'T', required: true }],
  out: [
    { name: 'true', type: 'T', exclusiveGroup: 'route' },
    { name: 'false', type: 'T', exclusiveGroup: 'route' },
  ],
  paramSchema: z.strictObject({
    field: z.string().min(1).optional(),
    operator: z.enum(COMPARE_OPERATORS),
    threshold: z.unknown().optional(),
  }),
  jsonFieldAccess: { param: 'field', port: 'in' },
};

export const NERO_VERIFY: NodeDescriptor = {
  type: 'nero-verify',
  title: 'Nero Verify',
  description: 'Adversarial verification of a draft against a rubric.',
  category: 'ai',
  in: [
    { name: 'draft', type: 'text', required: true },
    { name: 'rubric', type: 'text', required: false },
  ],
  out: [
    { name: 'verified', type: 'text' },
    { name: 'report', type: 'json' },
    { name: 'pass', type: 'boolean' },
  ],
  paramSchema: z.strictObject({
    challengerEngineId: z.string().min(1).optional(),
    maxRounds: z.number().int().min(1).max(5).optional(),
    passThreshold: z.number().min(0).max(1).optional(),
  }),
};

export const APPROVAL: NodeDescriptor = {
  type: 'approval',
  title: 'Approval',
  description: 'Parks the run until the user approves; passes its input through unchanged.',
  category: 'control',
  in: [{ name: 'in', type: 'T', required: true }],
  out: [{ name: 'out', type: 'T' }],
  paramSchema: z.strictObject({
    message: z.string().optional(),
    previewMode: z.enum(['summary', 'full', 'diff']).optional(),
  }),
};

export const WRITE_FILE: NodeDescriptor = {
  type: 'write-file',
  title: 'Write File',
  description: 'Writes text to a file. Touches the world.',
  category: 'io',
  effect: true,
  in: [
    { name: 'content', type: 'text', required: false },
    { name: 'source', type: 'file', required: false },
    { name: 'folder', type: 'folder', required: false },
  ],
  requireAnyOf: [['content', 'source']],
  out: [{ name: 'file', type: 'file' }],
  paramSchema: z.strictObject({
    filename: z.string().min(1).optional(),
    overwrite: z.enum(OVERWRITE_POLICIES).optional(),
    dryRun: z.boolean().optional(),
  }),
};

export const MOVE_FILE: NodeDescriptor = {
  type: 'move-file',
  title: 'Move File',
  description: 'Moves a fileset into a folder under a write-ahead journal. Touches the world.',
  category: 'io',
  effect: true,
  in: [
    { name: 'files', type: 'fileset', required: true },
    { name: 'folder', type: 'folder', required: true },
  ],
  out: [{ name: 'report', type: 'json' }],
  paramSchema: z.strictObject({
    overwrite: z.enum(OVERWRITE_POLICIES).optional(),
    dryRun: z.boolean().optional(),
  }),
};

export const MARKDOWN_TO_PDF: NodeDescriptor = {
  type: 'markdown-to-pdf',
  title: 'Markdown→PDF',
  description: 'Renders markdown text to a PDF file.',
  category: 'io',
  in: [{ name: 'text', type: 'text', required: true }],
  out: [{ name: 'file', type: 'file' }],
  paramSchema: z.strictObject({ cssPreset: z.string().min(1).optional() }),
};

export const CHAT_OUTPUT: NodeDescriptor = {
  type: 'chat-output',
  title: 'Chat Output',
  description: 'Renders a value in the Use tab. Its input port legally coalesces exclusive routes.',
  category: 'output',
  in: [{ name: 'in', type: 'T', required: true, coalescing: true }],
  out: [],
  paramSchema: z.strictObject({
    format: z.enum(['text', 'markdown', 'json']).optional(),
  }),
};

export const V1_NODE_CATALOG: readonly NodeDescriptor[] = [
  CHAT_INPUT,
  FILE_PICKER,
  FOLDER_PICKER,
  READ_FILE,
  LIST_FOLDER,
  ENGINE,
  TEMPLATE,
  EXTRACT_STRUCTURED,
  IF_COMPARE,
  NERO_VERIFY,
  APPROVAL,
  WRITE_FILE,
  MOVE_FILE,
  MARKDOWN_TO_PDF,
  CHAT_OUTPUT,
];

export function createDefaultNodeRegistry(): NodeRegistry {
  const registry = new NodeRegistry();
  for (const descriptor of V1_NODE_CATALOG) registry.register(descriptor);
  return registry;
}
