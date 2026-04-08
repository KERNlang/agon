// @kern-source: tool-permissions:4
import { resolve, relative, isAbsolute } from 'node:path';

// @kern-source: tool-permissions:5
import { realpathSync } from 'node:fs';

// @kern-source: tool-permissions:6
import type { PermissionDecision, ToolContext } from '../models/tool-types.js';

// @kern-source: tool-permissions:8
export interface PermissionRule {
  tool: string;
  behavior: 'allow'|'ask'|'deny';
  pattern?: string;
  reason?: string;
}

// @kern-source: tool-permissions:16
export const DANGEROUS_COMMANDS: string[] = [
  'rm -rf /', 'rm -rf ~', 'rm -rf *',
  'dd if=', 'mkfs.',
  '> /dev/sd', '> /dev/nv',
  'chmod 777 /',
  ':(){:|:&};:', // fork bomb
];

// @kern-source: tool-permissions:27
export const DANGEROUS_PREFIXES: string[] = ['sudo ', 'su ', 'doas '];

// @kern-source: tool-permissions:32
export const SAFE_SHELL_WRAPPERS: string[] = ['timeout', 'time', 'nice', 'nohup', 'env', 'command'];

// @kern-source: tool-permissions:37
export const READONLY_COMMANDS: Set<string> = new Set([
  'ls', 'cat', 'head', 'tail', 'less', 'more', 'wc', 'file', 'stat',
  'pwd', 'echo', 'printf', 'date', 'which', 'whereis', 'type',
  'find', 'grep', 'rg', 'ag', 'fd', 'fzf',
  'git status', 'git log', 'git diff', 'git branch', 'git show', 'git blame',
  'npm test', 'npm run test', 'npx vitest', 'npx tsc',
  'node --version', 'npm --version', 'python --version',
  'tree', 'du', 'df',
]);

// @kern-source: tool-permissions:52
export function stripShellWrappers(command: string): string {
  let cmd = command.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const wrapper of SAFE_SHELL_WRAPPERS) {
      if (cmd.startsWith(wrapper + ' ')) {
        cmd = cmd.slice(wrapper.length + 1).trim();
        // Skip any flags
        while (cmd.startsWith('-')) {
          const spaceIdx = cmd.indexOf(' ');
          if (spaceIdx === -1) break;
          cmd = cmd.slice(spaceIdx + 1).trim();
        }
        changed = true;
      }
    }
  }
  return cmd;
}

// @kern-source: tool-permissions:74
export function extractBaseCommand(command: string): string {
  const stripped = stripShellWrappers(command);
  // Get first word (the actual command)
  const parts = stripped.split(/\s+/);
  return parts[0] ?? '';
}

// @kern-source: tool-permissions:82
export function isDangerousCommand(command: string): boolean {
  const lower = command.toLowerCase().trim();
  for (const dangerous of DANGEROUS_COMMANDS) {
    if (lower.includes(dangerous)) return true;
  }
  for (const prefix of DANGEROUS_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  return false;
}

// @kern-source: tool-permissions:94
export function isReadOnlyCommand(command: string): boolean {
  const stripped = stripShellWrappers(command).trim();
  // Split on compound operators FIRST: &&, ||, ;, &  (but NOT single |)
  if (/&&|\|\||;|&(?!&)/.test(stripped) && !/^\|/.test(stripped)) {
    const parts = stripped.split(/\s*(?:&&|\|\||;|&(?!&))\s*/);
    return parts.every((p: string) => p.trim() && isReadOnlyCommand(p.trim()));
  }
  // Pipe chains: all commands must be read-only
  if (stripped.includes('|')) {
    const parts = stripped.split('|').map((p: string) => p.trim());
    return parts.every((p: string) => p && isReadOnlyCommand(p));
  }
  // Check against known read-only commands
  for (const safe of READONLY_COMMANDS) {
    if (stripped === safe || stripped.startsWith(safe + ' ')) return true;
  }
  return false;
}

// @kern-source: tool-permissions:114
export function checkBashPermission(command: string, ctx: ToolContext): PermissionDecision {
  if (isDangerousCommand(command)) {
    return { behavior: 'deny', message: `Dangerous command blocked: ${command.slice(0, 50)}`, reason: 'dangerous_pattern' };
  }
  if (ctx.permissionMode === 'deny-all') {
    return { behavior: 'deny', message: 'All tool execution is denied' };
  }
  // Check per-tool permission from settings.json
  if (ctx.toolPermissions?.['Bash']) {
    const tp = ctx.toolPermissions['Bash'];
    if (tp === 'allow') return { behavior: 'allow' };
    if (tp === 'deny') return { behavior: 'deny', message: 'Bash denied in settings' };
    // tp === 'ask' — fall through to normal checks
  }
  // Read-only commands always auto-approved
  if (isReadOnlyCommand(command)) {
    return { behavior: 'allow' };
  }
  // Check saved allowed commands (from settings.json)
  if (ctx.allowedCommands) {
    const base = command.trim().split(/\s+/)[0];
    if (ctx.allowedCommands.some(ac => command.startsWith(ac) || base === ac)) {
      return { behavior: 'allow' };
    }
  }
  if (ctx.permissionMode === 'auto') {
    return { behavior: 'allow' };
  }
  // Non-read-only: always ask user for approval
  return { behavior: 'ask', message: `This command requires approval`, reason: 'bash_mutating' };
}

// @kern-source: tool-permissions:147
export function isPathUnderCwd(filePath: string, cwd: string): boolean {
  const resolved = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
  // Resolve symlinks to prevent traversal via symlinks
  let realPath: string;
  let realCwd: string;
  try {
    realPath = realpathSync(resolved);
  } catch {
    // File doesn't exist yet — use unresolved path (safe for new files)
    realPath = resolved;
  }
  try {
    realCwd = realpathSync(cwd);
  } catch {
    realCwd = cwd;
  }
  const rel = relative(realCwd, realPath);
  return !rel.startsWith('..');
}

// @kern-source: tool-permissions:168
export function checkFileReadPermission(filePath: string, ctx: ToolContext): PermissionDecision {
  if (ctx.permissionMode === 'deny-all') {
    return { behavior: 'deny', message: 'All tool execution is denied' };
  }
  // Check per-tool permission from settings.json
  if (ctx.toolPermissions?.['Read'] === 'deny') {
    return { behavior: 'deny', message: 'Read denied in settings' };
  }
  const resolved = isAbsolute(filePath) ? filePath : resolve(ctx.cwd, filePath);
  if (isPathUnderCwd(resolved, ctx.cwd)) {
    return { behavior: 'allow' };
  }
  if (ctx.toolPermissions?.['Read'] === 'ask') {
    return { behavior: 'ask', message: `Read file outside workspace: ${resolved}` };
  }
  if (ctx.permissionMode === 'auto') {
    return { behavior: 'allow' };
  }
  return { behavior: 'ask', message: `Read file outside workspace: ${resolved}` };
}

// @kern-source: tool-permissions:190
export function checkFileWritePermission(filePath: string, ctx: ToolContext): PermissionDecision {
  if (ctx.permissionMode === 'deny-all') {
    return { behavior: 'deny', message: 'All tool execution is denied' };
  }
  // Check per-tool permission from settings.json
  if (ctx.toolPermissions?.['Edit']) {
    const tp = ctx.toolPermissions['Edit'];
    if (tp === 'deny') return { behavior: 'deny', message: 'Edit/Write denied in settings' };
    if (tp === 'ask') return { behavior: 'ask', message: `Edit requires approval: ${filePath}` };
  }
  const resolved = isAbsolute(filePath) ? filePath : resolve(ctx.cwd, filePath);
  
  // Block writing to sensitive files
  const basename = resolved.split('/').pop() ?? '';
  const sensitivePatterns = ['.env', 'credentials', 'secrets', '.pem', '.key', 'id_rsa'];
  for (const pat of sensitivePatterns) {
    if (basename.includes(pat)) {
      return { behavior: 'ask', message: `Write to sensitive file: ${basename}` };
    }
  }
  
  if (isPathUnderCwd(resolved, ctx.cwd)) {
    return { behavior: 'allow' };
  }
  return { behavior: 'ask', message: `Write file outside workspace: ${resolved}` };
}

