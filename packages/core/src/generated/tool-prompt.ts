import type { ToolDefinition, ToolHandler } from './tool-types.js';

export const TOOL_USE_FORMAT: string = `## How to use tools

When you need to perform an action (read a file, edit code, run a command, search), output a tool call using this exact format:

<tool name="ToolName">
{"param1": "value1", "param2": "value2"}
</tool>

Wait for the result before continuing. The result will appear as:

<tool_result name="ToolName">
... result content ...
</tool_result>

You can call multiple tools in sequence. Always use tools instead of guessing file contents or command outputs.`;

function toolDefinitionToPrompt(def: ToolDefinition): string {
  // inputSchema is JSON Schema: { type:'object', properties:{...}, required:[...] }
      const schema = def.inputSchema as any;
      const props = schema.properties ?? schema;
      const requiredFields = new Set(Array.isArray(schema.required) ? schema.required : []);
      const schemaLines = Object.entries(props)
        .filter(([key]) => key !== 'type' && key !== 'required' && key !== 'properties')
        .map(([key, spec]) => {
          const s = spec as any;
          const isReq = requiredFields.has(key) || s.required === true;
          const reqLabel = isReq ? ' (required)' : ' (optional)';
          const desc = s.description ? ` — ${s.description}` : '';
          return `  - ${key}: ${s.type ?? 'string'}${reqLabel}${desc}`;
        })
        .join('\n');
  
      return `### ${def.name}
  ${def.description}
  Parameters:
  ${schemaLines}`;
}

export function generateToolPrompt(handlers: ToolHandler[]): string {
  const sections: string[] = [TOOL_USE_FORMAT, '\n## Available Tools\n'];
  
      for (const handler of handlers) {
        sections.push(toolDefinitionToPrompt(handler.definition));
      }
  
      sections.push(`
  ## Tool Rules
  - Always Read a file before editing it
  - Use Edit for modifying existing files (not Write)
  - Use Write only for creating new files or complete rewrites
  - Use Grep/Glob to find files before reading them
  - For Bash: prefer read-only commands. Destructive commands need justification.
  - Keep tool calls focused — one action per tool call
  - After editing, verify with Bash (run tests, typecheck) when appropriate`);
  
      return sections.join('\n\n');
}

function generateReadToolSchema(): Record<string,unknown> {
  return {
    file_path: { type: 'string', required: true, description: 'Absolute or relative path to file' },
    offset: { type: 'number', required: false, description: 'Line number to start reading from (0-based)' },
    limit: { type: 'number', required: false, description: 'Max lines to read (default 2000)' },
  };
}

function generateEditToolSchema(): Record<string,unknown> {
  return {
    file_path: { type: 'string', required: true, description: 'Path to file to edit' },
    old_string: { type: 'string', required: true, description: 'Exact text to find and replace' },
    new_string: { type: 'string', required: true, description: 'Replacement text' },
    replace_all: { type: 'boolean', required: false, description: 'Replace all occurrences (default false)' },
  };
}

function generateWriteToolSchema(): Record<string,unknown> {
  return {
    file_path: { type: 'string', required: true, description: 'Path to file to write' },
    content: { type: 'string', required: true, description: 'Complete file content' },
  };
}

function generateBashToolSchema(): Record<string,unknown> {
  return {
    command: { type: 'string', required: true, description: 'Shell command to execute' },
    timeout: { type: 'number', required: false, description: 'Timeout in ms (default 120000)' },
  };
}

function generateGrepToolSchema(): Record<string,unknown> {
  return {
    pattern: { type: 'string', required: true, description: 'Regex pattern to search for' },
    path: { type: 'string', required: false, description: 'Directory or file to search (default: cwd)' },
    glob: { type: 'string', required: false, description: 'Glob filter (e.g. "*.ts")' },
    output_mode: { type: 'string', required: false, description: 'files_with_matches | count | content (default: files_with_matches)' },
  };
}

function generateGlobToolSchema(): Record<string,unknown> {
  return {
    pattern: { type: 'string', required: true, description: 'Glob pattern (e.g. "**/*.ts")' },
    path: { type: 'string', required: false, description: 'Base directory (default: cwd)' },
  };
}

