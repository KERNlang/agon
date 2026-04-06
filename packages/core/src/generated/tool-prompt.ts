// @kern-source: tool-prompt:5
import type { ToolDefinition, ToolHandler } from './tool-types.js';

// @kern-source: tool-prompt:7
export const TOOL_USE_FORMAT: string = `Tool format: <tool name="X">{"param":"value"}</tool> → result arrives as <tool_result name="X">...</tool_result>. Use tools — don't guess.`;

// @kern-source: tool-prompt:12
function toolDefinitionToPrompt(def: ToolDefinition): string {
  const schema = def.inputSchema as any;
  const props = schema.properties ?? schema;
  const requiredFields = new Set(Array.isArray(schema.required) ? schema.required : []);
  const params = Object.entries(props)
    .filter(([key]) => key !== 'type' && key !== 'required' && key !== 'properties')
    .map(([key, spec]) => {
      const s = spec as any;
      const opt = requiredFields.has(key) || s.required === true ? '' : '?';
      return `${key}${opt}:${s.type ?? 'string'}`;
    })
    .join(', ');
  return `${def.name}(${params}) — ${def.description}`;
}

// @kern-source: tool-prompt:28
export function generateToolPrompt(handlers: ToolHandler[]): string {
  const sections: string[] = [TOOL_USE_FORMAT, '\n## Available Tools\n'];
  
  for (const handler of handlers) {
    sections.push(toolDefinitionToPrompt(handler.definition));
  }
  
  sections.push(`Rules: Read before Edit. Edit for changes, Write for new files. Grep/Glob to find files. One action per call.`);
  
  return sections.join('\n\n');
}

// @kern-source: tool-prompt:42
function generateReadToolSchema(): Record<string,unknown> {
  return {
    file_path: { type: 'string', required: true, description: 'Absolute or relative path to file' },
    offset: { type: 'number', required: false, description: 'Line number to start reading from (0-based)' },
    limit: { type: 'number', required: false, description: 'Max lines to read (default 2000)' },
  };
}

// @kern-source: tool-prompt:51
function generateEditToolSchema(): Record<string,unknown> {
  return {
    file_path: { type: 'string', required: true, description: 'Path to file to edit' },
    old_string: { type: 'string', required: true, description: 'Exact text to find and replace' },
    new_string: { type: 'string', required: true, description: 'Replacement text' },
    replace_all: { type: 'boolean', required: false, description: 'Replace all occurrences (default false)' },
  };
}

// @kern-source: tool-prompt:61
function generateWriteToolSchema(): Record<string,unknown> {
  return {
    file_path: { type: 'string', required: true, description: 'Path to file to write' },
    content: { type: 'string', required: true, description: 'Complete file content' },
  };
}

// @kern-source: tool-prompt:69
function generateBashToolSchema(): Record<string,unknown> {
  return {
    command: { type: 'string', required: true, description: 'Shell command to execute' },
    timeout: { type: 'number', required: false, description: 'Timeout in ms (default 120000)' },
  };
}

// @kern-source: tool-prompt:77
function generateGrepToolSchema(): Record<string,unknown> {
  return {
    pattern: { type: 'string', required: true, description: 'Regex pattern to search for' },
    path: { type: 'string', required: false, description: 'Directory or file to search (default: cwd)' },
    glob: { type: 'string', required: false, description: 'Glob filter (e.g. "*.ts")' },
    output_mode: { type: 'string', required: false, description: 'files_with_matches | count | content (default: files_with_matches)' },
  };
}

// @kern-source: tool-prompt:87
function generateGlobToolSchema(): Record<string,unknown> {
  return {
    pattern: { type: 'string', required: true, description: 'Glob pattern (e.g. "**/*.ts")' },
    path: { type: 'string', required: false, description: 'Base directory (default: cwd)' },
  };
}

