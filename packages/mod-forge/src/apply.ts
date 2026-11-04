import type { CommandResult, InvocationContext, Json, ModServices } from '@kernlang/agon-mod-api';
import { resolve } from 'node:path';
import { preflightApply, applyPatchToTree, inspectWorkingTree } from '@kernlang/agon-support-worktree';

export const applyInputSchema = Object.freeze({ type: 'object', additionalProperties: false,
  properties: { type: { type: 'string', const: 'apply' }, patchPath: { type: 'string' }, force: { type: 'boolean' } },
});

export function parseApply(input: string): Json | undefined {
  const match = input.match(/^\/?apply(?:\s+([\s\S]*))?$/i);
  if (!match) return undefined;
  const rest = match[1] ?? '';
  const force = /(?:^|\s)--force(?:\s|$)/.test(rest);
  const patchPath = rest.replace(/(?:^|\s)--force(?=\s|$)/g, ' ').trim();
  return { type: 'apply', ...(patchPath ? { patchPath } : {}), force };
}

export async function runApply(input: Json, context: InvocationContext, services: ModServices): Promise<CommandResult> {
  context.signal.throwIfAborted();
  const cwd = context.cwd;
  const interaction = await services.patchApplication?.open(context);
  if (!interaction) return { exitCode: 2, stderr: 'Patch application requires an interactive approval host.\n' };
  const assertActive = () => {
    context.signal.throwIfAborted();
    interaction.assertActive();
  };
  assertActive();
  const request = input as { patchPath?: string; force?: boolean };
  let patchPath = request.patchPath;
  let manifestPath: string | null = null;
  if (!patchPath) {
    for (const artifacts of interaction.artifacts) {
      const patch = artifacts.find(artifact => artifact.type === 'patch');
      if (patch) { patchPath = patch.path; break; }
      const manifest = artifacts.find(artifact => artifact.type === 'manifest');
      if (manifest) manifestPath = manifest.path;
    }
  }
  const preflight = preflightApply(cwd, patchPath ? resolve(cwd, patchPath) : null,
    manifestPath ? resolve(cwd, manifestPath) : null, { allowDirty: request.force === true });
  if (!preflight.ok) {
    interaction.notify('error', preflight.error ?? 'Preflight failed.');
    return { exitCode: 1 };
  }
  if (preflight.dirtyTree) interaction.notify('warning', 'Working tree is dirty — applying anyway (--force).');
  const target = preflight.workspace ?? cwd;
  const patch = preflight.patch!;
  interaction.notify('info', `Patch: ${patch.path}`);
  interaction.notify('info', `Engine: ${patch.engineId}`);
  if (patch.content.trim()) interaction.preview({ engineId: patch.engineId, content: patch.content });
  interaction.notify('info', `Total: ~${patch.lineCount} lines changed`);
  const answer = await interaction.confirm(target);
  assertActive();
  if (!['y', 'yes'].includes(answer.trim().toLowerCase())) {
    interaction.notify('info', 'Cancelled.');
    return { exitCode: 0, result: { applied: false } };
  }
  const current = inspectWorkingTree(target);
  if (!current.ok || (current.dirtyTree && request.force !== true)) {
    interaction.notify('error', current.ok
      ? 'Working tree has uncommitted changes since preview. Review them and retry, or use /apply --force.'
      : current.error);
    return { exitCode: 1, result: { applied: false } };
  }
  assertActive();
  const result = applyPatchToTree(target, patch.content);
  const outcome = { exitCode: result.ok ? 0 : 1, result: { applied: result.ok } };
  const message = result.ok ? 'Patch applied. Review changes with git diff.' : `Apply failed: ${result.error}`;
  try {
    interaction.notify(result.ok ? 'success' : 'error', message);
  } catch (error) {
    // Reporting cannot turn an already completed Git write into an unknown
    // outcome. Preserve the effect receipt even if the UI lease has expired.
    return { ...outcome, stderr: `${message}\nStatus display failed: ${error instanceof Error ? error.message : String(error)}\n` };
  }
  return outcome;
}
