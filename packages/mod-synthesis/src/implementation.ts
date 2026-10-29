import ownerConfigSchema from '../schemas/config.schema.json' with { type: 'json' };

// Resource identity is not part of the executable schema subset.
const { $id: _configSchemaId, ...configSchema } = ownerConfigSchema;

import { commandResultToToolResult } from '@kernlang/agon-mod-api';
import type { AgonModFactory, CommandResult, Dispose, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';
const schema = Object.freeze({ type: 'object', additionalProperties: true, required: ['prompt'], properties: { prompt: { type: 'string' }, engines: { type: 'string' }, swaps: { type: 'string', default: '1' }, judge: { type: 'string' }, timeout: { type: 'string', default: '120' }, label: { type: 'string' }, quiet: { type: 'boolean' }, _: { type: 'array', items: { type: 'string' } } } }) as Readonly<Record<string, Json>>; const cli = Object.freeze({ positionals: ['prompt'], aliases: { engines: 'e', swaps: 's', judge: 'j' }, descriptions: { prompt: 'Task or prompt to synthesize' } }); const text = (v: unknown) => typeof v === 'string' ? v.trim() : ''; const extras = (v: unknown) => Array.isArray(v) ? v.map(String) : []; const ids = (v: Json | undefined) => typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : [];
import { runSynthesisRuntime } from './runtime.js';
import type { SynthesisResult } from './runtime.js';
import type { SynthesisModServices } from './host.js';

async function run(raw: Json, context: Parameters<ModServices['engines']['dispatch']>[2], services: SynthesisModServices, showAdvice = false): Promise<CommandResult> {
  const check = () => { context.signal.throwIfAborted(); context.assertCurrent?.(); };
  check();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { exitCode: 1, stderr: 'Provide a Synthesis request object.\n' };
  }
  const input = raw as Record<string, Json>;
  const prompt = [text(input.prompt), ...extras(input._).filter(value => value !== input.prompt)].filter(Boolean).join(' ').trim();
  if (!prompt) return { exitCode: 1, stderr: 'Provide a task to synthesize.\n' };
  const timeout = Number(input.timeout ?? 120);
  const swaps = Number(input.swaps ?? 1);
  if (!Number.isFinite(timeout) || timeout < 1 || !Number.isSafeInteger(swaps) || swaps < 0) {
    return { exitCode: 1, stderr: 'Synthesis needs a positive timeout and a non-negative integer swap count.\n' };
  }
  let engines = ids(input.engines);
  if (!engines.length && services.engines.listActive) engines = [...await services.engines.listActive(context)];
  check();
  engines = [...new Set(engines)];
  if (!engines.length) return { exitCode: 1, stderr: 'No active engines for synthesis.\n' };
  if (!services.synthesis || !services.runs) {
    return { exitCode: 1, stderr: 'Synthesis host capabilities are unavailable. Restart with a compatible modular CLI or MCP host.\n' };
  }
  const host = await services.synthesis.open(context);
  const assertCurrent = () => { check(); host.assertCurrent(); };
  assertCurrent();
  const handle = await services.runs.start('synthesis', text(input.label) || undefined, context);
  const failures: { engineId: string; phase: string; error: string }[] = [];
  let requested = 0;
  let judge = '';
  let judgeSucceeded = false;
  let outcome: SynthesisResult;
  try {
    assertCurrent();
    if (showAdvice && input.quiet !== true) host.showRoutingAdvice?.(prompt);
    assertCurrent();
    outcome = await runSynthesisRuntime({
      prompt, engines, swaps, judge: text(input.judge) || undefined, timeout,
      registry: host.registry, outputDir: handle.path, signal: context.signal,
      adapter: {
        ...host.adapter,
        async dispatch(options) {
          assertCurrent();
          requested += 1;
          const response = await host.adapter.dispatch(options);
          assertCurrent();
          // Failed or empty responses must not become successful drafts.
          if (response.exitCode !== 0 || response.timedOut || !response.stdout.trim()) {
            throw new Error(response.stderr.trim() || 'no usable response');
          }
          return response;
        },
      },
      onEvent(event) {
        assertCurrent();
        if (event.type === 'engine:failed') {
          failures.push({ engineId: event.engineId, phase: String(event.data.phase), error: String(event.data.error) });
        }
        if (event.type === 'synthesis:score') {
          judge = event.engineId;
          judgeSucceeded = true;
        }
        if (event.type === 'engine:failed' && event.data.phase === 'synthesis-judge') judge = event.engineId;
      },
    }, host.effects);
  } catch (error) {
    let cause = error;
    let interrupted = false;
    try { assertCurrent(); } catch (authorityError) {
      cause = authorityError;
      interrupted = true;
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    try {
      // Finalize only this invocation's run. Cleanup cannot publish success.
      await services.runs.finish(handle, {
        mode: 'synthesis', ok: false, summary: detail,
        startedAt: handle.startedAt, endedAt: new Date().toISOString(),
      }, context);
    } catch (statusError) {
      throw new AggregateError([cause, statusError], `${detail}; run failure status could not be persisted at ${handle.path}`);
    }
    if (interrupted) throw cause;
    assertCurrent();
    return { exitCode: 1, stderr: detail + '\n' };
  }
  // The runtime can catch dispatch errors; recheck before publishing anything.
  assertCurrent();
  const ok = judgeSucceeded && outcome.scores.length > 0;
  const result = { ...outcome, judge, panelHealth: { requested, failures: failures.length, degraded: failures.length > 0 } };
  const stdout = input.quiet === true ? `${outcome.winner}: ${outcome.judgeReasoning}\n` : `${JSON.stringify(result, null, 2)}\n`;
  try {
    await services.runs.finish(handle, {
      mode: 'synthesis', ok, winner: outcome.winner, failures,
      startedAt: handle.startedAt, endedAt: new Date().toISOString(),
    }, context);
    assertCurrent();
    await services.receipts.record('synthesis', { engines: engines.length, swaps, winner: outcome.winner, failures: failures.length });
    assertCurrent();
    return {
      exitCode: ok ? 0 : 1,
      ...(!ok ? { stderr: 'Synthesis produced no usable judged result.\n' } : {}),
      stdout,
      result: result as unknown as Json,
    };
  } catch (error) {
    assertCurrent();
    const detail = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1, stdout, result: result as unknown as Json,
      stderr: `Synthesis completed, but publication failed: ${detail}. Completed output is retained; inspect ${handle.path} before retrying.\n`,
    };
  }
}
const tuiSchema = Object.freeze({ type: 'object', additionalProperties: false, required: ['input'], properties: { input: { type: 'string' }, swaps: { type: 'number' }, engines: { type: 'string' }, judge: { type: 'string' } } }) as Readonly<Record<string, Json>>;
function tuiRequest(raw: Json): Json {
  const input = raw as Record<string, Json>;
  return { prompt: input.input ?? '', ...(typeof input.swaps === 'number' ? { swaps: String(input.swaps) } : {}),
    ...(typeof input.engines === 'string' ? { engines: input.engines } : {}),
    ...(typeof input.judge === 'string' ? { judge: input.judge } : {}) };
}
function parseSynthesis(value: string) { const parts = value.replace(/^\/(?:synthesis|synth)\s*/i, '').split(/\s+/); let swaps: number | undefined; const prompt: string[] = []; for (let index = 0; index < parts.length; index += 1) { if ((parts[index] === '--swaps' || parts[index] === '-s') && parts[index + 1]) { const parsed = Number.parseInt(parts[index + 1], 10); if (!Number.isNaN(parsed)) swaps = parsed; index += 1; } else prompt.push(parts[index]); } return { input: prompt.join(' ').trim(), swaps }; }
export const createMod: AgonModFactory = (services) => Object.freeze({ apiVersion: '1' as const, async activate(registrar: Registrar): Promise<Dispose> { const d: Dispose[] = []; const command = { description: 'Competitive cross-pollination: draft, swap, improve, and judge', inputSchema: schema, cli, run: (input: Json, context: any) => run(input, context, services) }; d.push(registrar.command('cli', { id: 'cliCommands:0067', ...command, run: (input, context) => run(input, context, services, true) })); d.push(registrar.command('tui', { id: 'tuiSlashCommands:0063', ...command, inputSchema: tuiSchema, parse: parseSynthesis, run: (input, context) => run(tuiRequest(input), context, services) })); d.push(registrar.tool('mcp', { id: 'mcpTools:0031', description: 'Run synthesis', inputSchema: schema, effect: 'process', run: async (input, context) => commandResultToToolResult(await run(input, context, services)) })); for (const id of ['resultAndEnvelopeTypes:0126']) d.push(registrar.resultType({ id, schema: { type: 'object', additionalProperties: true }, readableVersions: '>=0.2.0', render: async (payload) => ({ text: JSON.stringify(payload, null, 2) }) })); for (const id of ['configKeys:0113']) d.push(registrar.config(id, configSchema)); return async () => { for (const dispose of [...d].reverse()) await dispose(); }; } }); export default createMod;
