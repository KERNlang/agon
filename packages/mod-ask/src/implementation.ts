import type { AgonModFactory, CommandResult, Dispose, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';
const inputSchema = Object.freeze({
  type: 'object', additionalProperties: true,
  properties: {
    engine: { type: 'string' }, prompt: { type: 'string' }, _: { type: 'array', items: { type: 'string' } },
    timeout: { type: 'string', default: '120' }, system: { type: 'string' }, quiet: { type: 'boolean' }, label: { type: 'string' },
  },
}) as Readonly<Record<string, Json>>;
function strings(value: unknown): string[] { return Array.isArray(value) ? value.map(String) : []; }
export function resolveAskInput(input: Record<string, Json>): { engineId: string; prompt: string } {
  const engine = typeof input.engine === 'string' ? input.engine : ''; const namedPrompt = typeof input.prompt === 'string' ? input.prompt : ''; const extras = strings(input._).join(' ').trim();
  if (!namedPrompt) return { engineId: '', prompt: [engine, extras].filter(Boolean).join(' ').trim() };
  return { engineId: engine.trim(), prompt: [namedPrompt, extras].filter(Boolean).join(' ').trim() };
}
export const createMod: AgonModFactory = (services: ModServices) => Object.freeze({ apiVersion: '1' as const,
  async activate(registrar: Registrar): Promise<Dispose> { return registrar.command('cli', { id: 'cliCommands:0001', description: 'Ask one engine a single question', inputSchema, cli: { positionals: ['engine', 'prompt'], descriptions: { engine: 'Engine id; omit to use the default active engine', prompt: 'Question to ask' } },
    async run(raw, context): Promise<CommandResult> {
      const input = raw as Record<string, Json>; const resolved = resolveAskInput(input);
      if (!resolved.prompt) return { exitCode: 1, stderr: 'Provide a prompt. Usage: agon ask [engine] "your question"\n' };
      const timeoutSeconds = Math.max(1, Number.parseInt(typeof input.timeout === 'string' ? input.timeout : '120', 10) || 120);
      try { const dispatched = await services.engines.dispatch(resolved.engineId, resolved.prompt, context, { timeoutSeconds, systemPrompt: typeof input.system === 'string' ? input.system : undefined }) as Record<string, Json>;
        const answer = typeof dispatched.stdout === 'string' ? dispatched.stdout.trim() : ''; const ok = dispatched.exitCode === 0 && dispatched.timedOut !== true && answer.length > 0;
        await services.receipts.record('ask', { engineId: dispatched.engineId ?? resolved.engineId, ok, durationMs: dispatched.durationMs ?? null });
        if (!ok) return { exitCode: 1, stderr: dispatched.timedOut === true ? `${String(dispatched.engineId)} timed out after ${timeoutSeconds}s\n` : `${String(dispatched.engineId)} exited ${String(dispatched.exitCode)} with no answer\n` };
        return { exitCode: 0, stdout: `${answer}\n` };
      } catch (error) { return { exitCode: 1, stderr: `${error instanceof Error ? error.message : String(error)}\n` }; }
    } }); }
});
export default createMod;
