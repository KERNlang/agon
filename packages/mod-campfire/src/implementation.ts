import { commandResultToToolResult } from '@kernlang/agon-mod-api';
import type { AgonModFactory, CommandResult, Dispose, InvocationContext, Json, Registrar } from '@kernlang/agon-mod-api';

import { runCampfireRuntime } from './runtime.js';
import { campfireTopic } from './input.js';
import type { CampfireModServices } from './host.js';

const schema = Object.freeze({
  type: 'object', additionalProperties: true, required: ['topic'],
  properties: {
    topic: { type: 'string' }, engines: { type: 'string' }, strategy: { type: 'string', default: 'lead-first' },
    lead: { type: 'string' }, timeout: { type: 'string', default: '120' }, label: { type: 'string' }, quiet: { type: 'boolean' },
    _: { type: 'array', items: { type: 'string' } },
  },
}) as Readonly<Record<string, Json>>;
const cesarSchema = Object.freeze({ type: 'object', additionalProperties: false, required: ['topic'], properties: { topic: { type: 'string', minLength: 1 } } }) as Readonly<Record<string, Json>>;
const cli = Object.freeze({ positionals: ['topic'], aliases: { engines: 'e', strategy: 's', lead: 'l' }, descriptions: {
  topic: 'Topic to discuss', engines: 'Comma-separated engine list',
  strategy: 'Strategy: lead-first or all-respond', lead: 'Lead engine ID (for lead-first strategy)',
  timeout: 'Timeout in seconds', label: 'Human-readable suffix baked into the run dir name.',
  quiet: 'Suppress streaming output; stdout becomes only the run dir path + final summary.',
} });
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const engineIds = (value: Json | undefined) => typeof value === 'string' ? value.split(',').map((id) => id.trim()).filter(Boolean) : [];

async function run(raw: Json, context: InvocationContext, services: CampfireModServices, cliOutput = false): Promise<CommandResult> {
  context.signal.throwIfAborted();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { exitCode: 1, stderr: 'Provide a Campfire request object.\n' };
  const input = raw as Record<string, Json>;
  const topic = campfireTopic(input);
  if (!topic) return { exitCode: 1, stderr: 'Provide a topic. Usage: agon campfire "topic"\n' };
  const timeout = Number(input.timeout ?? 120);
  if (!Number.isFinite(timeout) || timeout <= 0) return { exitCode: 1, stderr: 'Campfire timeout must be a positive number of seconds.\n' };
  if (!services.campfire || !services.runs) return { exitCode: 1, stderr: 'Campfire host capabilities are unavailable. Restart with a compatible modular host.\n' };
  let engines = engineIds(input.engines);
  if (!engines.length && services.engines.listActive) engines = [...await services.engines.listActive(context)];
  if (!engines.length) return { exitCode: 1, stderr: 'Campfire requires at least one active engine.\n' };
  const strategy = text(input.strategy) === 'all-respond' ? 'all-respond' : 'lead-first';
  const requestedLead = text(input.lead);
  const lead = requestedLead && engines.includes(requestedLead) ? requestedLead : engines[0];
  const host = await services.campfire.open(context);
  host.assertCurrent();
  const handle = await services.runs.start('campfire', text(input.label) || undefined, context);
  const lines: string[] = [];
  const log = (value: string) => { lines.push(value); };
  const plain = (value: string) => value;
  const display = cliOutput ? services.campfire.cliOutput ?? { log, header: log, info: log, bold: plain, dim: plain } : undefined;
  const quiet = input.quiet === true || (cliOutput && process.env.AGON_QUIET === '1');
  const write = (effect: () => void) => { host.assertCurrent(); effect(); host.assertCurrent(); };
  let result: Awaited<ReturnType<typeof runCampfireRuntime>>;
  try {
    if (display) {
      write(() => display.log(quiet ? handle.path : `AGON_RUN: ${handle.path}`));
      if (!quiet) {
        write(() => display.header(`Campfire: ${topic}`));
        write(() => display.info(`Engines: ${engines.join(', ')}`));
        write(() => display.info(`Strategy: ${strategy}`));
        write(() => display.log(''));
      }
    }
    result = await runCampfireRuntime({
      topic, context: text(input.context) || undefined, seedPlan: text(input.seedPlan) || undefined,
      engines, strategy, leadEngine: lead, timeout, outputDir: handle.path,
      cwd: context.cwd, signal: context.signal, registry: host.registry, adapter: host.adapter,
    }, host.effects);
    host.assertCurrent();
  } catch (error) {
    try {
      await services.runs.finish(handle, {
        mode: 'campfire', startedAt: handle.startedAt, endedAt: new Date().toISOString(), ok: false,
        summary: error instanceof Error ? error.message : String(error),
        engines: engines.map(id => ({ id, status: 'error', detail: 'Campfire did not complete' })),
      }, context);
    } catch (recordError) {
      try {
        await services.logger.warn(`Campfire failure record could not be saved at ${handle.path}: ${recordError instanceof Error ? recordError.message : String(recordError)}`);
      } catch { /* Diagnostics must not replace the workflow failure. */ }
    }
    throw error;
  }
  const responded = new Set(result.rounds.filter(round => round.content.trim()).map(round => round.engineId));
  const statuses = engines.map(id => {
    const count = result.rounds.filter(round => round.engineId === id && round.content.trim()).length;
    return { id, status: count ? 'ok' : 'error', detail: count ? `${count} round(s)` : 'no output' };
  });
  try {
    await services.runs.finish(handle, {
      mode: 'campfire', ...(text(input.label) ? { label: text(input.label) } : {}), startedAt: handle.startedAt, endedAt: new Date().toISOString(),
      ok: responded.size === engines.length, summary: `${responded.size}/${engines.length} engines contributed`,
      engines: statuses,
    }, context);
  } catch (error) {
    host.assertCurrent();
    throw error;
  }
  host.assertCurrent();
  const output = { ...result, strategy, panelHealth: { requested: engines.length, responded: responded.size, degraded: responded.size !== engines.length } };
  const printSummary = () => {
    if (!display) return;
    const failed = statuses.filter(seat => seat.status !== 'ok');
    write(() => display.log(`AGON_SUMMARY: ${responded.size}/${engines.length} succeeded${failed.length ? '; ' + failed.map(seat => `${seat.id}: ${seat.status}`).join(', ') : ''}`));
  };
  if (!responded.size) {
    printSummary();
    return { exitCode: 1, stderr: 'Campfire produced no usable responses.\n', result: output as Json,
      ...(display ? { stdout: lines.length ? lines.join('\n') + '\n' : '' } : {}) };
  }
  // Record completed responses, not permission or the command's final outcome.
  await services.receipts.record('campfire', { strategy, lead: result.lead, requested: engines.length, responded: responded.size });
  host.assertCurrent();
  if (display) {
    if (!quiet) {
      for (const round of result.rounds) {
        write(() => display.log(''));
        write(() => display.header(display.bold(round.engineId)));
        write(() => display.log(round.content));
      }
      write(() => display.log(''));
      write(() => display.info(display.dim(`Full output saved: ${handle.path}`)));
    }
    printSummary();
    return { exitCode: 0, stdout: lines.length ? lines.join('\n') + '\n' : '', result: output as Json };
  }
  const stdout = input.quiet === true ? `${result.rounds.filter(round => round.content.trim()).map(({ engineId, content }) => `${engineId}: ${content}`).join('\n\n')}\n` : `${JSON.stringify(output, null, 2)}\n`;
  return { exitCode: 0, stdout, result: output as Json };
}

export const createMod: AgonModFactory = (services) => Object.freeze({
  apiVersion: '1' as const,
  async activate(registrar: Registrar): Promise<Dispose> {
    const disposers: Dispose[] = [];
    const command = { description: 'Open discussion — all engines think together, no competition', inputSchema: schema, cli, run: (input: Json, context: any) => run(input, context, services) };
    disposers.push(registrar.command('cli', { id: 'cliCommands:0010', ...command, run: (input, context) => run(input, context, services, true) }));
    disposers.push(registrar.intent({ id: 'intentVariants:0007', description: 'Parse campfire intent', inputSchema: schema, parse: (input) => input.startsWith('/campfire ') ? { topic: input.slice(10) } : undefined, run: (input, context) => run(input, context, services) }));
    for (const id of ['builtinCommandMetadata:0008', 'tuiSlashCommands:0008']) disposers.push(registrar.command('tui', { id, ...command }));
    disposers.push(registrar.tool('mcp', { id: 'mcpTools:0005', description: 'Run an open multi-model discussion', inputSchema: schema, effect: 'process', run: async (input, context) => commandResultToToolResult(await run(input, context, services)) }));
    for (const id of ['cesarRoutes:0010', 'cesarRoutes:0011', 'cesarRoutes:0012', 'cesarRoutes:0013']) disposers.push(registrar.planStep({ id, inputSchema: schema, resultSchema: schema, risk: 'read', run: (input, context) => run(input, context, services) }));
    disposers.push(registrar.tool('cesar', { id: 'cesarTools:0003', description: 'Hand this topic to an open multi-model Campfire discussion', inputSchema: cesarSchema, effect: 'read', run: async () => 'Delegation accepted — end your turn now so the run can start.' }));
    for (const id of ['resultAndEnvelopeTypes:0022']) disposers.push(registrar.resultType({ id, schema: { type: 'object', additionalProperties: true }, readableVersions: '>=0.2.0', render: async (payload) => ({ text: JSON.stringify(payload, null, 2) }) }));
    return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
  },
});
export default createMod;
