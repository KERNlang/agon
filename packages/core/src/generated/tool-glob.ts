// @kern-source: tool-glob:4
import type { ToolResult, ToolContext, ToolDefinition, PermissionDecision, ToolHandler } from './tool-types.js';

// @kern-source: tool-glob:5
import { spawnWithTimeout } from './process.js';

// @kern-source: tool-glob:7
export const DEFAULT_MAX_FILES: number = 100;

// @kern-source: tool-glob:10
export const GLOB_TIMEOUT: number = 15000;

// @kern-source: tool-glob:13
export function createGlobTool(): ToolHandler {
  const definition: ToolDefinition = {
    name: 'Glob',
    description: 'Fast file pattern matching. Returns file paths sorted by modification time.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern to match files (e.g. "**/*.ts", "src/**/*.kern")' },
        path:    { type: 'string', description: 'Directory to search in (defaults to cwd)' },
        limit:   { type: 'number', description: 'Max number of file entries to return (default 100)' },
      },
      required: ['pattern'],
    },
    maxResultSizeChars: 30000,
    isReadOnly: true,
    isConcurrencySafe: true,
  };
  
  function validate(input: Record<string, unknown>, _ctx: ToolContext): string | null {
    if (typeof input.pattern !== 'string' || input.pattern.trim() === '') {
      return 'pattern is required and must be a non-empty string';
    }
    return null;
  }
  
  function checkPermission(_input: Record<string, unknown>, _ctx: ToolContext): PermissionDecision {
    return { behavior: 'allow' };
  }
  
  async function execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const pattern = input.pattern as string;
    const searchPath = typeof input.path === 'string' ? input.path : ctx.cwd;
    const maxFiles = typeof input.limit === 'number' ? input.limit : DEFAULT_MAX_FILES;
  
    const args: string[] = [
      '--files',
      '--hidden',
      '--glob', '!.git',
      '--sort=modified',
      '--glob', pattern,
      searchPath,
    ];
  
    const result = await spawnWithTimeout({
      command: 'rg',
      args,
      cwd: ctx.cwd,
      timeout: GLOB_TIMEOUT,
      signal: ctx.abortSignal,
    });
  
    // rg --files exits 1 when no files match — not an error
    if (result.exitCode > 1) {
      return {
        ok: false,
        content: '',
        error: result.stderr || `ripgrep exited with code ${result.exitCode}`,
        metadata: { exitCode: result.exitCode, durationMs: result.durationMs },
      };
    }
  
    const stdout = result.stdout.trim();
  
    if (result.exitCode === 1 || stdout === '') {
      return {
        ok: true,
        content: 'No files found.',
        metadata: { exitCode: result.exitCode, durationMs: result.durationMs, fileCount: 0 },
      };
    }
  
    // Apply file limit
    const lines = stdout.split('\n');
    const totalFiles = lines.length;
    const limited = lines.slice(0, maxFiles);
    let output = limited.join('\n');
  
    if (totalFiles > maxFiles) {
      output += `\n\n[Truncated: showing ${maxFiles} of ${totalFiles} files]`;
    }
  
    return {
      ok: true,
      content: output,
      metadata: { exitCode: result.exitCode, durationMs: result.durationMs, fileCount: totalFiles },
    };
  }
  
  return { definition, validate, checkPermission, execute };
}

