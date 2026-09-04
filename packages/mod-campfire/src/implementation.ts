import type { AgonModFactory, CommandResult, Dispose, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

const schema = Object.freeze({
  type: 'object', additionalProperties: true, required: ['topic'],
  properties: {
    topic: { type: 'string' }, engines: { type: 'string' }, strategy: { type: 'string', default: 'lead-first' },
    lead: { type: 'string' }, timeout: { type: 'string', default: '120' }, label: { type: 'string' }, quiet: { type: 'boolean' },
    _: { type: 'array', items: { type: 'string' } },
  },
}) as Readonly<Record<string, Json>>;
const cesarSchema = Object.freeze({ type: 'object', additionalProperties: false, required: ['topic'], properties: { topic: { type: 'string', minLength: 1 } } }) as Readonly<Record<string, Json>>;
const cli = Object.freeze({ positionals: ['topic'], aliases: { engines: 'e', strategy: 's', lead: 'l' }, descriptions: { topic: 'Topic to discuss' } });
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const extras = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
const engineIds = (value: Json | undefined) => typeof value === 'string' ? value.split(',').map((id) => id.trim()).filter(Boolean) : [];

async function run(raw: Json, context: Parameters<ModServices['engines']['dispatch']>[2], services: ModServices): Promise<CommandResult> {
  const input = raw as Record<string, Json>;
  const topic = [text(input.topic), ...extras(input._).filter((part) => part !== input.topic)].filter(Boolean).join(' ').trim();
  if (!topic) return { exitCode: 1, stderr: 'Provide a topic. Usage: agon campfire "topic"\n' };
  let engines = engineIds(input.engines);
  if (!engines.length && services.engines.listActive) engines = [...await services.engines.listActive(context)];
  if (!engines.length) return { exitCode: 1, stderr: 'Campfire requires at least one active engine.\n' };
  const strategy = text(input.strategy) === 'all-respond' ? 'all-respond' : 'lead-first';
  const requestedLead = text(input.lead);
  const lead = requestedLead && engines.includes(requestedLead) ? requestedLead : engines[0];
  const timeoutSeconds = Math.max(1, Number.parseInt(text(input.timeout) || '120', 10));
  const invoke = async (engineId: string, prompt: string) => {
    try {
      const output = await services.engines.dispatch(engineId, prompt, context, { timeoutSeconds, systemPrompt: 'Join an open technical discussion. Be candid and concrete; there is no winner.' }) as Record<string, Json>;
      const content = output.exitCode === 0 && output.timedOut !== true ? text(output.stdout) : '';
      return { engineId: text(output.engineId) || engineId, content, ok: Boolean(content), error: content ? null : text(output.stderr) || 'no usable response' };
    } catch (error) {
      return { engineId, content: '', ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  const rounds: Awaited<ReturnType<typeof invoke>>[] = [];
  if (strategy === 'all-respond') {
    rounds.push(...await Promise.all(engines.map((engineId) => invoke(engineId, `TOPIC: ${topic}\n\nGive your view and respond to likely alternative views.`))));
  } else {
    const opening = await invoke(lead, `TOPIC: ${topic}\n\nOpen the discussion with a useful framing and your current view.`);
    rounds.push(opening);
    const remaining = engines.filter((engineId) => engineId !== lead);
    rounds.push(...await Promise.all(remaining.map((engineId) => invoke(engineId, `TOPIC: ${topic}\n\nLEAD (${lead}):\n${opening.content || '[lead failed]'}\n\nRespond constructively: extend, disagree, or reframe.`))));
  }
  const contributed = rounds.filter(({ ok }) => ok).length;
  const result = { topic, strategy, lead, rounds, panelHealth: { requested: engines.length, responded: contributed, degraded: contributed !== engines.length } };
  if (!contributed) return { exitCode: 1, stderr: 'Campfire produced no usable responses.\n', result: result as Json };
  await services.receipts.record('campfire', { strategy, lead, requested: engines.length, responded: contributed });
  const stdout = input.quiet === true ? `${rounds.filter(({ ok }) => ok).map(({ engineId, content }) => `${engineId}: ${content}`).join('\n\n')}\n` : `${JSON.stringify(result, null, 2)}\n`;
  return { exitCode: 0, stdout, result: result as Json };
}

export const createMod: AgonModFactory = (services) => Object.freeze({
  apiVersion: '1' as const,
  async activate(registrar: Registrar): Promise<Dispose> {
    const disposers: Dispose[] = [];
    const command = { description: 'Open discussion — all engines think together, no competition', inputSchema: schema, cli, run: (input: Json, context: any) => run(input, context, services) };
    disposers.push(registrar.command('cli', { id: 'cliCommands:0010', ...command }));
    disposers.push(registrar.intent({ id: 'intentVariants:0007', description: 'Parse campfire intent', inputSchema: schema, parse: (input) => input.startsWith('/campfire ') ? { topic: input.slice(10) } : undefined, run: (input, context) => run(input, context, services) }));
    for (const id of ['builtinCommandMetadata:0008', 'tuiSlashCommands:0008']) disposers.push(registrar.command('tui', { id, ...command }));
    disposers.push(registrar.tool('mcp', { id: 'mcpTools:0005', description: 'Run an open multi-model discussion', inputSchema: schema, effect: 'process', run: async (input, context) => (await run(input, context, services)).result ?? {} }));
    for (const id of ['cesarRoutes:0010', 'cesarRoutes:0011', 'cesarRoutes:0012', 'cesarRoutes:0013']) disposers.push(registrar.planStep({ id, inputSchema: schema, resultSchema: schema, risk: 'read', run: (input, context) => run(input, context, services) }));
    disposers.push(registrar.tool('cesar', { id: 'cesarTools:0003', description: 'Hand this topic to an open multi-model Campfire discussion', inputSchema: cesarSchema, effect: 'read', run: async () => 'Delegation accepted — end your turn now so the run can start.' }));
    return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
  },
});
export default createMod;
