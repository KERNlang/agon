import type { AgonModFactory, CommandResult, Dispose, InvocationContext, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createSessionWorktree, listSessionWorktrees, pruneSessionWorktrees, rehydrateSessionWorktree, removeSessionWorktree, sessionWorktreesDir } from '@kernlang/agon-support-worktree';

import { parseDuration, pruneEphemeralWorktrees, repositoryRoot, runDependencyInstall, sessionRuntime } from './runtime.js';
import { addWorkspace, getActiveWorkspace, listWorkspaces, removeWorkspace, switchWorkspace } from './workspaces.js';

const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
const text = (value: Json | undefined): string => typeof value === 'string' ? value : '';
const repeated = (value: Json | undefined): string | undefined => typeof value === 'string' ? value : Array.isArray(value) && value.length ? String(value.at(-1)) : undefined;
const words = (value: Json | undefined): string[] => Array.isArray(value) ? value.map(String) : [];

export async function runWorktree(raw: Json, context: InvocationContext, services: ModServices): Promise<CommandResult> {
  const input = raw as Record<string, Json>;
  const rest = words(input._);
  const action = (repeated(input.action) ?? rest[0] ?? '').toLowerCase();
  const branch = repeated(input.branch) ?? (rest[0] === action ? rest[1] : rest[0]);
  if ((await services.permissions.check('process.spawn', 'git')) !== 'allow') return { exitCode: 1, stderr: 'Permission denied: process.spawn is required.\n' };
  let repoRoot: string;
  try { repoRoot = repositoryRoot(context.cwd); }
  catch { return { exitCode: 1, stderr: 'Not inside a git repository.\n' }; }

  if (action === 'list' || action === 'ls') {
    const worktrees = listSessionWorktrees(repoRoot, sessionRuntime);
    return { exitCode: 0, stdout: `${JSON.stringify(worktrees, null, 2)}\n`, result: { worktrees } as unknown as Json };
  }
  if (!['new', 'rm', 'remove', 'rehydrate', 'prune'].includes(action)) return { exitCode: 1, stderr: 'Use new, list, rm, prune, or rehydrate.\n' };
  if ((await services.permissions.check('fs.write', sessionWorktreesDir(repoRoot, sessionRuntime))) !== 'allow') return { exitCode: 1, stderr: 'Permission denied: fs.write is required.\n' };

  if (action === 'new') {
    if (!branch) return { exitCode: 1, stderr: 'Usage: agon worktree new <branch> [--base <ref>] [--deps link|install|none]\n' };
    const deps = (repeated(input.deps) ?? 'link').toLowerCase();
    if (!['link', 'install', 'none'].includes(deps)) return { exitCode: 1, stderr: `Invalid --deps "${deps}". Use: link, install, or none.\n` };
    if (deps === 'install' && (await services.permissions.check('network', 'package-registry')) !== 'allow') return { exitCode: 1, stderr: 'Permission denied: dependency installation requires network access.\n' };
    try {
      const worktree = createSessionWorktree({ repoRoot, branch, base: repeated(input.base), link: deps === 'link' }, sessionRuntime);
      const install = deps === 'install' ? runDependencyInstall(worktree.packageManager, worktree.path) : null;
      const receiptId = await services.receipts.record('worktree-created', json({ branch, path: worktree.path, deps, install }));
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({ ...worktree, deps, install, receiptId }, null, 2)}\n`,
        result: json({ ...worktree, deps, install, receiptId }),
      };
    } catch (error) {
      return { exitCode: 1, stderr: `${error instanceof Error ? error.message : String(error)}\n` };
    }
  }

  if (action === 'rehydrate') {
    if (!branch) return { exitCode: 1, stderr: 'Usage: agon worktree rehydrate <branch>\n' };
    const rehydrated = rehydrateSessionWorktree(repoRoot, branch, sessionRuntime);
    return rehydrated
      ? { exitCode: 0, stdout: `Re-linked node_modules + dist for ${branch}.\n`, result: { rehydrated: branch } }
      : { exitCode: 1, stderr: `No session worktree found for "${branch}".\n` };
  }

  if (action === 'prune') {
    const olderThan = repeated(input['older-than']) ?? '7d';
    const olderThanMs = parseDuration(olderThan);
    if (olderThanMs === null) return { exitCode: 1, stderr: `Invalid --older-than "${olderThan}". Use e.g. 7d, 24h, 30m.\n` };
    const dryRun = input['dry-run'] === true;
    const session = pruneSessionWorktrees(repoRoot, olderThanMs, dryRun, input.force === true, sessionRuntime);
    const ephemeral = pruneEphemeralWorktrees(repoRoot, olderThanMs, dryRun);
    const receiptId = await services.receipts.record('worktrees-pruned', json({ olderThan, dryRun, force: input.force === true, session, ephemeral }));
    const result = { olderThan, dryRun, session, ephemeral, receiptId };
    return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n`, result: json(result) };
  }

  if (!branch) return { exitCode: 1, stderr: 'Usage: agon worktree rm <branch> [--force]\n' };
  try {
    const removed = removeSessionWorktree(repoRoot, branch, input.force === true, sessionRuntime);
    if (!removed) return { exitCode: 1, stderr: `No session worktree found for "${branch}".\n` };
    const receiptId = await services.receipts.record('worktree-removed', { branch, forced: input.force === true });
    return { exitCode: 0, stdout: `Removed ${branch}.\n`, result: { removed: branch, receiptId } };
  } catch (error) {
    return { exitCode: 1, stderr: `${error instanceof Error ? error.message : String(error)}\n` };
  }
}

export async function runWorkspace(raw: Json, context: InvocationContext, services: ModServices): Promise<CommandResult> {
  const input = raw as Record<string, Json>;
  const action = text(input.action).toLowerCase() || 'list';
  const path = text(input.path).trim();
  if (action === 'list') {
    const workspaces = listWorkspaces();
    const active = getActiveWorkspace();
    return { exitCode: 0, stdout: `${JSON.stringify({ workspaces, active }, null, 2)}\n`, result: json({ workspaces, active }) };
  }
  if (!['add', 'remove', 'switch'].includes(action)) return { exitCode: 1, stderr: 'Workspace action must be add, remove, switch, or list.\n' };
  if (!path) return { exitCode: 1, stderr: `Usage: /workspace ${action} <path-or-id>\n` };
  if ((await services.permissions.check('fs.write', path)) !== 'allow') return { exitCode: 1, stderr: 'Permission denied: fs.write is required.\n' };
  if (action === 'add') {
    const workspace = addWorkspace(path);
    return { exitCode: 0, stdout: `Added ${workspace.name}.\n`, result: json({ added: workspace }) };
  }
  if (action === 'remove') {
    const removed = removeWorkspace(path);
    return removed ? { exitCode: 0, stdout: `Removed ${path}.\n`, result: { removed: path } } : { exitCode: 1, stderr: `Workspace "${path}" not found.\n` };
  }
  const workspace = switchWorkspace(path);
  if (!workspace) return { exitCode: 1, stderr: `Workspace "${path}" not found.\n` };
  if (!services.workspace) return { exitCode: 1, stderr: 'Workspace bookmark selected, but this host cannot change session grounding. Restart in the selected path.\n', result: json({ selected: workspace, restartRequired: true }) };
  await services.workspace.setSessionRoot(workspace.path, context);
  return { exitCode: 0, stdout: `Active: ${workspace.name} ${workspace.path}\n`, result: json({ active: workspace }) };
}

const worktreeSchema = Object.freeze({
  type: 'object', additionalProperties: true, required: ['action'],
  properties: {
    action: { type: 'string' }, branch: { type: 'string' }, base: { type: 'string' },
    deps: { type: 'string', default: 'link' }, 'older-than': { type: 'string', default: '7d' },
    'dry-run': { type: 'boolean', default: false }, force: { type: 'boolean', default: false },
    _: { type: 'array', items: { type: 'string' } },
  },
}) as Readonly<Record<string, Json>>;

const workspaceSchema = Object.freeze({
  type: 'object', additionalProperties: false,
  properties: { action: { type: 'string', default: 'list' }, path: { type: 'string' } },
}) as Readonly<Record<string, Json>>;

const parseWorkspace = (value: string): Record<string, Json> | undefined => {
  const match = value.match(/^\/(?:workspace|ws)(?:\s+([\s\S]*))?$/i);
  if (!match) return undefined;
  const parts = (match[1] ?? '').trim().split(/\s+/).filter(Boolean);
  return { action: parts[0] || 'list', path: parts.slice(1).join(' ') };
};

export const createMod: AgonModFactory = (services) => Object.freeze({
  apiVersion: '1' as const,
  async activate(registrar: Registrar): Promise<Dispose> {
    const disposers: Dispose[] = [];
    const worktree = {
      description: 'Isolated per-session Git worktrees', inputSchema: worktreeSchema,
      cli: { positionals: ['action', 'branch'] },
      run: (input: Json, context: InvocationContext) => runWorktree(input, context, services),
    };
    disposers.push(registrar.command('cli', { id: 'cliCommands:0075', ...worktree }));
    disposers.push(registrar.command('cli', { id: 'cliCommands:0076', ...worktree }));
    const intent = { id: 'intentVariants:0067', description: 'Manage workspace bookmarks and session grounding', inputSchema: workspaceSchema, parse: parseWorkspace, run: (input: Json, context: InvocationContext) => runWorkspace(input, context, services) };
    disposers.push(registrar.intent(intent));
    for (const id of ['builtinCommandMetadata:0051', 'builtinCommandMetadata:0052', 'tuiSlashCommands:0071', 'tuiSlashCommands:0072'] as const) {
      disposers.push(registrar.command('tui', { id, description: 'Manage workspace bookmarks and session grounding', inputSchema: workspaceSchema, parse: parseWorkspace, run: (input, context) => runWorkspace(input, context, services) }));
    }
    return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
  },
});

export default createMod;
