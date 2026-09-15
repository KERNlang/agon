import { commandResultToToolResult } from '@kernlang/agon-mod-api';
import type { AgonModFactory, CommandResult, Dispose, InvocationContext, Json, Registrar } from '@kernlang/agon-mod-api';
import { createBrainstormRuntime } from './runtime.js';
import type { BrainstormInvocationContext, BrainstormModServices } from './host.js';

const schema = Object.freeze({
  type: 'object', additionalProperties: true, required: ['question'],
  properties: {
    question: { type: 'string' }, engines: { type: 'string' },
    timeout: { type: 'string', default: '120' }, style: { type: 'string', default: 'divergent' },
    label: { type: 'string' }, quiet: { type: 'boolean' }, _: { type: 'array', items: { type: 'string' } },
  },
}) as Readonly<Record<string, Json>>;
const cesarSchema = Object.freeze({
  type: 'object', additionalProperties: false, required: ['question'],
  properties: { question: { type: 'string', minLength: 1 }, team: { type: 'boolean' } },
}) as Readonly<Record<string, Json>>;
const cli = Object.freeze({
  positionals: ['question'], aliases: { engines: 'e' }, descriptions: { question: 'Question to brainstorm' },
});
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const failure = (message: string): CommandResult => ({ exitCode: 1, stderr: message + '\n' });

function cliRunLines(path: string, statuses: readonly { id: string; status: string }[], quiet: boolean): [string, string] {
  const succeeded = statuses.filter(seat => seat.status === 'ok').length;
  const failures = statuses.filter(seat => seat.status !== 'ok').map(seat => `${seat.id}: ${seat.status}`);
  return [quiet ? path : `AGON_RUN: ${path}`,
    `AGON_SUMMARY: ${succeeded}/${statuses.length} succeeded${failures.length ? '; ' + failures.join(', ') : ''}`];
}

export async function runBrainstorm(raw: Json, context: BrainstormInvocationContext, services: BrainstormModServices, cliOutput = false): Promise<CommandResult> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return failure('Provide a Brainstorm request object.');
  const input = raw as Record<string, Json>;
  const quiet = input.quiet === true || (cliOutput && process.env.AGON_QUIET === '1');
  const extra = Array.isArray(input._) ? input._.map(String).filter(value => value !== input.question) : [];
  const question = [text(input.question), ...extra].filter(Boolean).join(' ').trim();
  if (!question) return failure('Provide a question. Usage: agon brainstorm "question"');
  const timeout = Number(input.timeout ?? 120);
  if (!Number.isFinite(timeout) || timeout < 1) return failure('Brainstorm timeout must be a positive number of seconds.');
  if (!services.brainstorm || !services.runs) {
    return failure('Brainstorm host capabilities are unavailable. Restart with a compatible modular CLI or MCP host.');
  }
  context.signal.throwIfAborted();
  let engines = typeof input.engines === 'string' ? input.engines.split(',').map(value => value.trim()).filter(Boolean)
    : Array.isArray(input.engines) ? input.engines.map(String).filter(Boolean) : [];
  if (!engines.length && services.engines.listActive) engines = [...await services.engines.listActive(context)];
  if (!engines.length) return failure('No active engines for Brainstorm.');
  const capabilities = await services.brainstorm.open(context);
  const runtime = createBrainstormRuntime(capabilities);
  const label = text(input.label) || undefined;
  const run = await services.runs.start('brainstorm', label, context);
  const writeCliOutput = cliOutput ? services.brainstorm.writeCliOutput : undefined;
  let announced = false;
  let streaming = true;
  const seatDetails = new Map<string, string>();
  let result: Awaited<ReturnType<typeof runtime.runBrainstorm>>;
  try {
    if (writeCliOutput) {
      writeCliOutput((quiet ? run.path : `AGON_RUN: ${run.path}`) + '\n');
      announced = true;
      if (!quiet) writeCliOutput(`Brainstorm: ${question}\nEngines: ${engines.join(', ')}\nStyle: ${text(input.style) || 'divergent'}\n`);
    }
    result = await runtime.runBrainstorm({
      question, context: text(input.context) || undefined, engines, timeout,
      style: text(input.style) || 'divergent', outputDir: run.path, signal: context.signal,
      onEvent: event => {
        const data = event.data;
        if (event.type === 'brainstorm:seat-completed' && typeof data?.engineId === 'string') {
          seatDetails.set(data.engineId, data.ok === true ? `${Number(data.attempts ?? 1)} attempt(s)`
            : String(data.detail ?? data.failure ?? 'no usable response'));
          if (streaming && writeCliOutput && !quiet) writeCliOutput(`${data.ok === true ? 'OK' : 'FAIL'} ${data.engineId}: ${seatDetails.get(data.engineId)}\n`);
        }
        context.onWorkflowEvent?.(event);
      },
    });
    // A usable draft is a fallback for synthesis failure, not permission to
    // reinterpret an operator cancellation as successful completion.
    context.signal.throwIfAborted();
  } catch (error) {
    streaming = false;
    const detail = error instanceof Error ? error.message : String(error);
    await services.runs.finish(run, {
      mode: 'brainstorm', ...(label ? { label } : {}), startedAt: run.startedAt, endedAt: new Date().toISOString(),
      engines: engines.map(id => ({ id, status: 'error', detail: seatDetails.get(id) ?? detail })), summary: detail, ok: false,
    }, context);
    if (context.signal.aborted) throw error;
    return { ...failure(detail), ...(cliOutput ? {
      stdout: cliRunLines(run.path, engines.map(id => ({ id, status: 'error' })), quiet).slice(announced ? 1 : 0).join('\n') + '\n',
    } : {}) };
  } finally {
    streaming = false;
  }
  const bids = new Map(result.bids.map(bid => [bid.engineId, bid]));
  const statuses = engines.map(id => {
    const bid = bids.get(id);
    return bid ? { id, status: 'ok', detail: 'confidence=' + bid.confidence }
      : { id, status: 'error', detail: 'no bid returned' };
  });
  const responded = statuses.filter(engine => engine.status === 'ok').length;
  await services.runs.finish(run, {
    mode: 'brainstorm', ...(label ? { label } : {}), startedAt: run.startedAt, endedAt: new Date().toISOString(),
    engines: statuses, ok: responded === engines.length,
    summary: responded + '/' + engines.length + ' bid; winner=' + result.winner
      + '; synthesis=' + result.synthesis.status + '; dedup=' + result.dedup.status
      + (result.panelHealth.banner ? '; ' + result.panelHealth.banner : ''),
  }, context);
  await services.receipts.record('brainstorm', {
    winner: result.winner, requested: result.panelHealth.requested, responded: result.panelHealth.responded,
  });
  let stdout = input.quiet === true ? result.response + '\n' : JSON.stringify(result, null, 2) + '\n';
  if (cliOutput) {
    const [path, summary] = cliRunLines(run.path, statuses, quiet);
    const lines = announced ? [] : [path];
    if (!quiet) {
      if (!announced) lines.push(`Brainstorm: ${question}`, `Engines: ${engines.join(', ')}`, `Style: ${text(input.style) || 'divergent'}`);
      if (result.panelHealth.banner) lines.push(`Warning: ${result.panelHealth.banner}`);
      if (!['applied', 'not-needed'].includes(result.dedup.status)) lines.push(`Dedup ${result.dedup.status}${result.dedup.detail ? ': ' + result.dedup.detail : ''}`);
      if (result.synthesis.status === 'fallback') lines.push(`Synthesis fallback: ${result.synthesis.detail ?? 'winner expansion failed; showing ranked drafts'}`);
      lines.push('', 'Bids', 'Engine\tQuality\tConfidence\tReasoning');
      for (const bid of result.bids) lines.push([
        (bid.engineId === result.winner ? '* ' : '') + bid.engineId,
        bid.score == null ? '—' : String(Math.round(bid.score)), String(bid.confidence), bid.reasoning.slice(0, 60),
      ].join('\t'));
      lines.push('', `Response from ${result.winner}`, result.response);
    }
    lines.push(summary);
    stdout = lines.join('\n') + '\n';
  }
  return {
    exitCode: 0, result: result as unknown as Json,
    stdout,
  };
}

export const createMod: AgonModFactory = services => ({
  apiVersion: '1',
  async activate(registrar: Registrar): Promise<Dispose> {
    const disposers: Dispose[] = [];
    const run = (input: Json, context: InvocationContext) => runBrainstorm(input, context, services);
    const command = { description: 'Multi-model confidence brainstorm', inputSchema: schema, cli, run };
    disposers.push(registrar.command('cli', { id: 'cliCommands:0003', ...command,
      run: (input, context) => runBrainstorm(input, context, services, true),
    }));
    disposers.push(registrar.intent({
      id: 'intentVariants:0005', description: 'Parse brainstorm intent', inputSchema: schema,
      parse: input => /^\/brainstorm(?:\s|$)/i.test(input) ? { question: input.replace(/^\/brainstorm\s*/i, '') } : undefined,
      run,
    }));
    disposers.push(registrar.intent({
      id: 'intentVariants:0055', description: 'Suggest brainstorm', inputSchema: schema, parse: () => undefined, run,
    }));
    for (const id of ['builtinCommandMetadata:0005', 'tuiSlashCommands:0005']) {
      disposers.push(registrar.command('tui', { id, description: 'Brainstorm', inputSchema: schema, run }));
    }
    disposers.push(registrar.tool('mcp', {
      id: 'mcpTools:0004', description: 'Run a multi-AI brainstorm with confidence-ranked synthesis',
      inputSchema: schema, effect: 'process', run: async (input, context) => commandResultToToolResult(await run(input, context)),
    }));
    for (const id of ['cesarRoutes:0004', 'cesarRoutes:0005', 'cesarRoutes:0006', 'cesarRoutes:0007']) {
      disposers.push(registrar.planStep({ id, inputSchema: schema, resultSchema: schema, risk: 'read', run }));
    }
    disposers.push(registrar.tool('cesar', {
      id: 'cesarTools:0002', description: 'Run brainstorm', inputSchema: cesarSchema, effect: 'read',
      run: async () => 'Delegation accepted — end your turn now so the orchestrator can run Brainstorm.',
    }));
    disposers.push(registrar.resultType({
      id: 'resultAndEnvelopeTypes:0019', schema: { type: 'object', additionalProperties: true },
      readableVersions: '>=0.2.0', render: async payload => ({ text: JSON.stringify(payload, null, 2) }),
    }));
    return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
  },
});
export default createMod;
