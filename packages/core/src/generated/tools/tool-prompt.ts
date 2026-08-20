import type { ToolDefinition, ToolHandler } from '../models/tool-types.js';

import { ToolRegistry } from '../signals/tool-registry.js';

export const TOOL_USE_FORMAT: string = `Tool format — output this exact XML to call tools:

<tool name="Read">{"file_path":"src/index.ts"}</tool>

Result arrives as: <tool_result name="Read">file content here</tool_result>

Example — to run a command:
<tool name="Bash">{"command":"npm test"}</tool>

ALWAYS use tools. NEVER say "let me look at" without calling Read/Grep. NEVER describe edits without calling Edit.
NEVER use Bash for searching — use Grep for content search, Glob for file search. Bash is ONLY for running commands (build, test, git).
Keep going until the task is DONE. Don't stop after reading one file — chain tool calls: Read → analyze → Read more → Edit → Bash to verify. Complete the full task in one turn.`;

/**
 * Describe a schema property including nested array/object structures for XML prompt.
 */
function describeSchemaProperty(key: string, spec: any, required: boolean): string {
  const opt = required ? '' : '?';
  const s = spec as any;

  // Array of objects — show the item structure
  if (s.type === 'array' && s.items?.type === 'object' && s.items?.properties) {
    const itemProps = Object.entries(s.items.properties)
      .map(([k, v]: [string, any]) => {
        const itemReq = Array.isArray(s.items.required) && s.items.required.includes(k);
        const enumHint = v.enum ? ` (${v.enum.join('|')})` : '';
        return `${k}${itemReq ? '' : '?'}:${v.type ?? 'string'}${enumHint}`;
      })
      .join(', ');
    return `${key}${opt}:[{${itemProps}}]`;
  }

  // Object with properties
  if (s.type === 'object' && s.properties) {
    const subProps = Object.entries(s.properties)
      .map(([k, v]: [string, any]) => `${k}:${v.type ?? 'string'}`)
      .join(', ');
    return `${key}${opt}:{${subProps}}`;
  }

  const enumHint = s.enum ? ` (${s.enum.join('|')})` : '';
  return `${key}${opt}:${s.type ?? 'string'}${enumHint}`;
}

function toolDefinitionToPrompt(def: ToolDefinition): string {
  const schema = def.inputSchema as any;
  const props = schema.properties ?? schema;
  const requiredFields = new Set(Array.isArray(schema.required) ? schema.required : []);
  const params = Object.entries(props)
    .filter(([key]) => key !== 'type' && key !== 'required' && key !== 'properties')
    .map(([key, spec]) => {
      const s = spec as any;
      const isReq = requiredFields.has(key) || s.required === true;
      return describeSchemaProperty(key, s, isReq);
    })
    .join(', ');
  return `${def.name}(${params}) — ${def.description}`;
}

/**
 * Generate the complete tool system prompt section for any LLM.
 */
export function generateToolPrompt(handlers: ToolHandler[]): string {
  const sections: string[] = [TOOL_USE_FORMAT, '\n## Available Tools\n'];
  for (const handler of handlers) {
    sections.push(toolDefinitionToPrompt(handler.definition));
  }
  sections.push(`Rules: Read before Edit. Edit for changes, Write for new files. Grep/Glob to find files. One action per call.`);
  return sections.join('\n\n');
}







/**
 * Recursively convert a JSON Schema property, preserving nested structures for arrays/objects.
 */
function convertSchemaProperty(spec: any): Record<string,unknown> {
  const result: Record<string, unknown> = { type: spec.type ?? 'string' };
  if (spec.description) {
    result.description = spec.description;
  }
  if (spec.enum) {
    result.enum = spec.enum;
  }
  // Array with items — preserve the nested item schema
  if (spec.type === 'array' && spec.items) {
    result.items = convertSchemaProperty(spec.items);
  }
  // Object with properties — recursively convert each property
  if (spec.type === 'object' && spec.properties) {
    const nested: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(spec.properties)) {
      nested[k] = convertSchemaProperty(v as any);
    }
    result.properties = nested;
    if (Array.isArray(spec.required)) {
      result.required = spec.required;
    }
  }
  return result;
}

/**
 * Convert Agon tool definitions to OpenAI function calling format.
 */
export function toolsToOpenAIFormat(registry: ToolRegistry): Array<{type:string,function:{name:string,description:string,parameters:Record<string,unknown>}}> {
  const handlers = Array.from((registry as any).tools.values()) as ToolHandler[];
  return handlers.map((h: ToolHandler) => {
    const schema = h.definition.inputSchema as any;
    const props = schema.properties ?? schema;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, spec] of Object.entries(props)) {
      if (key === 'type' || key === 'required' || key === 'properties') continue;
      const s = spec as any;
      properties[key] = convertSchemaProperty(s);
      if (s.required === true) required.push(key);
    }
    // Also check schema-level required array
    if (Array.isArray(schema.required)) {
      for (const r of schema.required) { if (!required.includes(r)) required.push(r); }
    }

    return {
      type: 'function' as const,
      function: {
        name: h.definition.name,
        description: h.definition.description,
        parameters: { type: 'object', properties, required },
      },
    };
  });
}
