import type { InvocationContext, Json, ModServices } from '@kernlang/agon-mod-api';
import {
  assignReviewRoles,
  buildReviewPrompt,
  formatReviewProjectContext,
  gatherReviewFileContext,
} from '@kernlang/agon-support-verification';

export interface ReviewPromptContext {
  readonly fileContext: string;
  readonly projectContext: string;
  readonly warnings: string[];
}

export async function gatherReviewPromptContext(
  diff: string,
  context: InvocationContext,
  services: ModServices,
): Promise<ReviewPromptContext> {
  const config = context.config as Record<string, Json> | undefined;
  const fileContext = config?.reviewFileContext === false ? '' : gatherReviewFileContext(diff, context.cwd);
  let projectContext = '';
  const warnings: string[] = [];
  if (!services.context) {
    warnings.push('host provides no project context service; reviewing without project context');
  } else {
    try {
      projectContext = formatReviewProjectContext(await services.context.projectContext(context.cwd, context));
    } catch (error) {
      warnings.push(`project context unavailable (${error instanceof Error ? error.message : String(error)}); reviewing without it`);
    }
  }
  for (const warning of warnings) await services.logger?.warn(`review: ${warning}`);
  return { fileContext, projectContext, warnings };
}

export function assignSeatRoles(engines: readonly string[], rolesInput: Json | undefined): Map<string, string> {
  const raw = typeof rolesInput === 'string' ? rolesInput.trim().toLowerCase() : '';
  if (!raw) return new Map();
  const roleIds = raw === 'auto' ? undefined : raw.split(',').map(id => id.trim()).filter(Boolean);
  return new Map([...assignReviewRoles([...engines], roleIds)].map(([engineId, role]) => [engineId, role.id]));
}

const REDACTION_MARKER = '[REDACTED-SECRET]';
const REDACTION_NOTE = `NOTE: Agon replaced credential-looking values with ${REDACTION_MARKER} before this review. The real code contains the original value; do not report the marker itself as a bug.`;

export function buildSeatPrompt(
  input: { label: string; diff: string; roleId?: string; mutationEvidence?: string },
  grounding: ReviewPromptContext,
): string {
  const prompt = buildReviewPrompt({
    label: input.label,
    diff: input.diff,
    fileContext: grounding.fileContext,
    projectContext: grounding.projectContext,
    ...(input.roleId ? { roleId: input.roleId } : {}),
    ...(input.mutationEvidence ? { mutationEvidence: input.mutationEvidence } : {}),
  });
  return prompt.includes(REDACTION_MARKER) ? `${REDACTION_NOTE}\n\n${prompt}` : prompt;
}
