import type { CommandResult, InvocationContext, Json, ModServices } from '@kernlang/agon-mod-api';

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
  if (!services.patchApplication) return { exitCode: 2, stderr: 'Patch application requires an interactive approval host.\n' };
  const request = input as { patchPath?: string; force?: boolean };
  return services.patchApplication.apply({ ...(request.patchPath ? { patchPath: request.patchPath } : {}), force: request.force === true }, context);
}
