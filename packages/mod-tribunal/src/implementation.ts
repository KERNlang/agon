import { commandResultToToolResult } from '@kernlang/agon-mod-api';
import type { AgonModFactory, CommandResult, Dispose, Json, Registrar } from '@kernlang/agon-mod-api';

import { getModeConfig, TRIBUNAL_MODES, TRIBUNAL_PROTOCOLS } from './modes.js';
import type { TribunalMode as Mode, TribunalProtocol as Protocol } from './modes.js';
import { createTribunalRuntime } from './runtime.js';
import type { TribunalEvent, TribunalResult } from './runtime.js';
import type { TribunalFailure } from './presentation.js';
import { renderTribunalResult } from './presentation.js';
import type { TribunalInvocationContext, TribunalModServices } from './host.js';
const modes = new Set<Mode>(TRIBUNAL_MODES);
const protocols = new Set<Protocol>(TRIBUNAL_PROTOCOLS);
const schema = Object.freeze({ type: 'object', additionalProperties: true, required: ['question'], properties: { question: { type: 'string' }, rounds: { type: 'string', default: '2' }, engines: { type: 'string' }, mode: { type: 'string', default: 'adversarial' }, protocol: { type: 'string', default: 'auto' }, timeout: { type: 'string', default: '120' }, label: { type: 'string' }, quiet: { type: 'boolean' }, _: { type: 'array', items: { type: 'string' } } } }) as Readonly<Record<string, Json>>;
const cesarSchema = Object.freeze({ type: 'object', additionalProperties: false, required: ['question'], properties: { question: { type: 'string', minLength: 1 }, mode: { type: 'string', enum: ['adversarial', 'synthesis', 'steelman', 'socratic', 'red-team', 'postmortem'] }, team: { type: 'boolean' } } }) as Readonly<Record<string, Json>>;
const cli = Object.freeze({ positionals: ['question'], aliases: { rounds: 'r', engines: 'e', mode: 'm', protocol: 'p' }, descriptions: { question: 'Question to debate' } });
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const extras = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
const ids = (value: Json | undefined) => typeof value === 'string' ? value.split(',').map((id) => id.trim()).filter(Boolean) : [];

export function parseTribunalIntent(input: string): Record<string, Json> | undefined {
  const match = input.match(/^\/tribunal(?:\s+([\s\S]*))?$/i);
  if (!match) return undefined;
  const parts = (match[1] ?? '').trim().split(/\s+/).filter(Boolean);
  const acceptedModes = new Set<string>(TRIBUNAL_MODES);
  const acceptedProtocols = new Set<string>(['auto', ...TRIBUNAL_PROTOCOLS]);
  let tribunalMode: string | undefined;
  let tribunalProtocol: string | undefined;
  const question: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const token = parts[index];
    const lower = token.toLowerCase();
    if (lower === '--mode' && acceptedModes.has(parts[index + 1]?.toLowerCase())) { tribunalMode = parts[++index].toLowerCase(); continue; }
    if (lower === '--protocol' && acceptedProtocols.has(parts[index + 1]?.toLowerCase())) { tribunalProtocol = parts[++index].toLowerCase(); continue; }
    const shorthand = lower.startsWith('--') ? lower.slice(2) : lower;
    if (!tribunalMode && question.length === 0 && acceptedModes.has(shorthand)) { tribunalMode = shorthand; continue; }
    question.push(token);
  }
  return { question: question.join(' '), ...(tribunalMode ? { tribunalMode } : {}), ...(tribunalProtocol ? { tribunalProtocol } : {}) };
}

export async function runTribunal(raw: Json, context: TribunalInvocationContext, services: TribunalModServices, cliOutput = false): Promise<CommandResult> {
  const failure = (message: string): CommandResult => ({ exitCode: 1, stderr: message + '\n' });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return failure('Provide a Tribunal request object.');
  const input = raw as Record<string, Json>;
  const quiet = input.quiet === true || (cliOutput && process.env.AGON_QUIET === '1');
  const question = [text(input.question), ...extras(input._).filter(part => part !== input.question)].filter(Boolean).join(' ').trim();
  if (!question) return failure('Provide a question. Usage: agon tribunal "question"');
  context.signal.throwIfAborted();
  let engines = ids(input.engines);
  try {
    if (engines.length && services.engines.resolveRequested) engines = [...await services.engines.resolveRequested(engines, context)];
    else if (!engines.length && services.engines.listActive) engines = [...await services.engines.listActive(context)];
  } catch (error) {
    context.signal.throwIfAborted();
    return failure(error instanceof Error ? error.message : String(error));
  }
  engines = engines.slice(0, 4);
  if (engines.length < 2) return failure(`Tribunal needs at least 2 engines. Only found: ${engines.join(', ') || 'none'}`);
  const modeText = text(input.mode) || 'adversarial';
  if (!modes.has(modeText as Mode)) return failure(`Invalid tribunal mode: ${modeText}`);
  const mode = modeText as Mode;
  const cfg = getModeConfig(mode, engines.length);
  const requestedProtocol = (text(input.protocol) || 'auto').toLowerCase();
  if (requestedProtocol !== 'auto' && !protocols.has(requestedProtocol as Protocol)) return failure(`Invalid tribunal protocol: ${requestedProtocol}`);
  const protocol = requestedProtocol === 'auto' ? cfg.protocol : requestedProtocol as Protocol;
  const requestedRounds = Number(input.rounds ?? 2);
  const timeout = Number(input.timeout ?? 120);
  if (!Number.isInteger(requestedRounds) || requestedRounds < 1) return failure('Tribunal rounds must be a positive integer.');
  if (!Number.isFinite(timeout) || timeout < 1) return failure('Tribunal timeout must be a positive number of seconds.');
  const rounds = Math.min(cfg.maxRounds, requestedRounds);
  if (!services.tribunal || !services.runs) return failure('Tribunal host capabilities are unavailable. Restart with a compatible modular CLI or MCP host.');
  const session = await services.tribunal.open(context);
  session.assertCurrent();
  const label = text(input.label) || undefined;
  const run = await services.runs.start('tribunal', label, context);
  const lines: string[] = [];
  const plain = (value: string) => value;
  const log = (value: string) => { lines.push(value); };
  const output = cliOutput ? services.tribunal.cliOutput ?? {
    log, header: log, info: log, warn: log, bold: plain, dim: plain, red: plain,
  } : undefined;
  const printSummary = (statuses: readonly { id: string; status: string }[]) => {
    const failed = statuses.filter(seat => seat.status !== 'ok');
    output?.log(`AGON_SUMMARY: ${statuses.length - failed.length}/${statuses.length} succeeded${failed.length ? '; ' + failed.map(seat => `${seat.id}: ${seat.status}`).join(', ') : ''}`);
  };
  const failures: TribunalFailure[] = [];
  let completion: TribunalEvent | undefined;
  let result: TribunalResult;
  try {
    session.assertCurrent();
    context.onRunStarted?.(run.path);
    session.assertCurrent();
    output?.log(quiet ? run.path : `AGON_RUN: ${run.path}`);
    if (output && !quiet) {
      output.header(`Tribunal: ${question}`);
      output.info(`Engines: ${engines.join(', ')}`);
      output.info(`Rounds: ${rounds}`);
      output.info(`Mode: ${mode}`);
      output.info(`Protocol: ${protocol}`);
      output.log('');
    }
    result = await createTribunalRuntime(session.effects)({
      question, engines, rounds, mode, protocol, timeout, cwd: context.cwd,
      registry: session.registry, adapter: session.adapter, outputDir: run.path, signal: context.signal,
      onEvent: event => {
        // The command publishes completion only after its own durable effects.
        if (event.type === 'forge:done') { completion = event; return; }
        if (event.type === 'engine:failed') failures.push({
          engineId: String(event.data?.engineId ?? event.engineId ?? 'unknown'),
          phase: String(event.data?.phase ?? 'dispatch'), error: String(event.data?.error ?? 'unknown error'),
        });
        else if (output && !quiet && event.data?.round && event.engineId && event.data.position) {
          output.info(`Round ${event.data.round}: ${output.bold(event.engineId)} (${String(event.data.position)})...`);
        }
        context.onWorkflowEvent?.(event);
      },
    });
    session.assertCurrent();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await services.runs.finish(run, {
      mode: 'tribunal', ...(label ? { label } : {}), startedAt: run.startedAt, endedAt: new Date().toISOString(),
      engines: engines.map(id => ({ id, status: 'error', detail })), summary: detail, ok: false,
    }, context);
    context.signal.throwIfAborted();
    printSummary(engines.map(id => ({ id, status: 'error' })));
    return { ...failure(detail), ...(cliOutput ? { stdout: lines.length ? lines.join('\n') + '\n' : '' } : {}) };
  }
  const statuses = engines.map(id => {
    const errors = failures.filter(item => item.engineId === id);
    const count = result.rounds.flatMap(round => round.positions.filter(position => position.engineId === id))
      .flatMap(position => position.arguments).filter(argument => argument.trim() && argument !== '(failed to respond)').length;
    return errors.length
      ? { id, status: 'error', detail: errors.map(item => `${item.phase}: ${item.error.length > 160 ? item.error.slice(0, 160) + '…' : item.error}`).join('; ') }
      : count ? { id, status: 'ok', detail: `${count} arguments` } : { id, status: 'error', detail: 'no arguments produced' };
  });
  const okCount = statuses.filter(seat => seat.status === 'ok').length;
  await services.runs.finish(run, {
    mode: 'tribunal', ...(label ? { label } : {}), startedAt: run.startedAt, endedAt: new Date().toISOString(),
    engines: statuses, summary: `${okCount}/${engines.length} engines argued across ${rounds} round(s) (mode=${mode}, protocol=${protocol})`,
    ok: okCount === engines.length,
  }, context);
  session.assertCurrent();
  if (!result.panelHealth?.responded) {
    printSummary(statuses);
    return { ...failure('Tribunal produced no usable arguments.'), result: result as unknown as Json,
      ...(cliOutput ? { stdout: lines.length ? lines.join('\n') + '\n' : '' } : {}) };
  }
  await services.receipts.record('tribunal', { mode, protocol, rounds, engines: engines.length, failures: failures.length });
  session.assertCurrent();
  if (output) {
    if (!quiet) renderTribunalResult(result, failures, run.path, output);
    printSummary(statuses);
    if (completion) context.onWorkflowEvent?.(completion);
    return { exitCode: 0, stdout: lines.length ? lines.join('\n') + '\n' : '', result: result as unknown as Json };
  }
  if (completion) context.onWorkflowEvent?.(completion);
  return { exitCode: 0, stdout: input.quiet === true ? result.summary + '\n' : JSON.stringify(result, null, 2) + '\n', result: result as unknown as Json };
}

export const createMod: AgonModFactory = (services) => Object.freeze({ apiVersion: '1' as const, async activate(registrar: Registrar): Promise<Dispose> { const disposers: Dispose[] = []; const command = { description: 'Adversarial debate — engines argue different sides of a question', inputSchema: schema, cli, run: (input: Json, context: any) => runTribunal(input, context, services) }; disposers.push(registrar.command('cli', { id: 'cliCommands:0072', ...command, run: (input, context) => runTribunal(input, context, services, true) })); for (const id of ['intentVariants:0057', 'intentVariants:0063']) disposers.push(registrar.intent({ id, description: 'Parse tribunal intent', inputSchema: schema, parse: parseTribunalIntent, run: (value, context) => { const parsed = value as Record<string, Json>; return runTribunal({ ...parsed, mode: parsed.tribunalMode ?? parsed.mode ?? 'adversarial', protocol: parsed.tribunalProtocol ?? parsed.protocol ?? 'auto' }, context, services); } })); for (const id of ['builtinCommandMetadata:0048', 'tuiSlashCommands:0069']) disposers.push(registrar.command('tui', { id, ...command })); disposers.push(registrar.tool('mcp', { id: 'mcpTools:0032', description: 'Run an adversarial tribunal', inputSchema: schema, effect: 'process', run: async (input, context) => commandResultToToolResult(await runTribunal(input, context, services)) })); for (const id of ['cesarRoutes:0066', 'cesarRoutes:0067', 'cesarRoutes:0068', 'cesarRoutes:0069']) disposers.push(registrar.planStep({ id, inputSchema: schema, resultSchema: schema, risk: 'read', run: (input, context) => runTribunal(input, context, services) })); disposers.push(registrar.tool('cesar', { id: 'cesarTools:0026', description: 'Hand this question to an adversarial Tribunal', inputSchema: cesarSchema, effect: 'read', run: async () => 'Delegation accepted — end your turn now so the run can start.' })); disposers.push(registrar.resultType({ id: 'resultAndEnvelopeTypes:0139', schema: { type: 'object', additionalProperties: true }, readableVersions: '>=0.2.0', render: async (payload) => ({ text: JSON.stringify(payload, null, 2) }) })); return async () => { for (const dispose of [...disposers].reverse()) await dispose(); }; } });
export default createMod;
