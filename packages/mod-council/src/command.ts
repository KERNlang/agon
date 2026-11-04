import type { CommandResult, InvocationContext, Json } from '@kernlang/agon-mod-api';
import type { CouncilModServices } from './host.js';
import { runCouncilRuntime } from './runtime.js';
import { councilRunStatus, presentCouncilResult } from './presentation.js';

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const list = (value: unknown) => text(value).split(',').map(id => id.trim()).filter(Boolean);

export async function runCouncil(raw: Json, context: InvocationContext, services: CouncilModServices, cliOutput = false): Promise<CommandResult> {
  context.signal.throwIfAborted();
  context.assertCurrent?.();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { exitCode: 1, stderr: 'Provide a Council request object.\n' };
  const input = raw as Record<string, Json>;
  const extras = Array.isArray(input._) ? input._.map(String) : [];
  const named = text(input.question);
  if (extras[0] === named) extras.shift();
  const question = [named, ...extras].filter(Boolean).join(' ').trim();
  if (!question) return { exitCode: 1, stderr: 'Provide a decision for the council. Usage: agon council "your decision" [--roles "..."] [--engines "..."]\n' };
  let requested = list(input.engines);
  let forced = text(input.chairman);
  const resolveRequested = !cliOutput ? services.engines.resolveRequested : undefined;
  try {
    if (requested.length && resolveRequested) {
      requested = [...await resolveRequested(requested, context)];
      if (!requested.length) throw new Error('Council engine selection resolved to no engines.');
    }
    context.signal.throwIfAborted(); context.assertCurrent?.();
    if (forced && resolveRequested) {
      const resolved = await resolveRequested([forced], context);
      if (resolved.length !== 1) throw new Error('Council chairman selection must resolve to one engine.');
      forced = resolved[0];
    }
    context.signal.throwIfAborted(); context.assertCurrent?.();
  } catch (error) {
    context.signal.throwIfAborted(); context.assertCurrent?.();
    return { exitCode: 1, stderr: `${error instanceof Error ? error.message : String(error)}\n` };
  }
  if (requested.length && new Set([...requested, ...(forced ? [forced] : [])]).size < 2) {
    return { exitCode: 1, stderr: 'A council needs at least 2 engines.\n' };
  }
  if (!services.council || !services.runs) return { exitCode: 1, stderr: 'Council host capabilities are unavailable. Restart with a compatible modular host.\n' };
  const host = await services.council.open(context);
  host.assertCurrent();
  const known = new Set(host.registry.listIds());
  let engines = [...host.defaultEngineIds];
  if (requested.length) {
    const unknown = resolveRequested ? [] : requested.filter(id => !known.has(host.registry.resolveId(id)));
    if (unknown.length) return { exitCode: 1, stderr: `Unknown engine${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Run \`agon engine list\` to see available engines.\n` };
    const removed = requested.filter(id => host.removedEngineIds.includes(host.registry.resolveId(id)));
    if (removed.length) return { exitCode: 1, stderr: `Removed engine${removed.length > 1 ? 's' : ''} cannot join the council: ${removed.join(', ')}. Restore with \`agon engine add <id>\`.\n` };
    engines = resolveRequested ? requested : requested.map(id => host.registry.resolveId(id));
  }
  let chairman: string | undefined;
  if (forced) {
    chairman = resolveRequested ? forced : host.registry.resolveId(forced);
    if (!resolveRequested && !known.has(chairman)) return { exitCode: 1, stderr: `Unknown chairman engine '${text(input.chairman)}'. Run \`agon engine list\` to see available engines.\n` };
    if (!resolveRequested && !host.activeEngineIds.includes(chairman)) return { exitCode: 1, stderr: `Chairman engine '${text(input.chairman)}' is not available (not installed or missing credentials). Run \`agon engine list\`.\n` };
    if (!engines.includes(chairman)) engines = [chairman, ...engines];
  }
  engines = [...new Set(engines)];
  if (engines.length < 2) return { exitCode: 1, stderr: `A council needs at least 2 engines (have ${engines.length}). Run \`agon engine list\` or \`agon engine add <id>\`.\n` };
  const timeout = parseInt(String(input.timeout ?? '120'), 10) || 120;
  const label = typeof input.label === 'string' ? input.label : undefined;
  const roles = list(input.roles);
  const quiet = input.quiet === true;
  const json = input.json === true;
  host.assertCurrent();
  const handle = await services.runs.start('council', label, context);
  const lines: string[] = [];
  const log = (line: string) => { lines.push(line); };
  const plain = (line: string) => line;
  const display = cliOutput ? services.council.cliOutput ?? { log, header: log, info: log, bold: plain, dim: plain } : undefined;
  const write = (effect: () => void) => { host.assertCurrent(); effect(); host.assertCurrent(); };
  let result: Awaited<ReturnType<typeof runCouncilRuntime>>;
  try {
    host.assertCurrent();
    if (display && !quiet && !json) {
      write(() => display.header(`Council · ${engines.length} engines`));
      write(() => display.info(question.length > 120 ? question.slice(0, 120) + '...' : question));
      write(() => display.log(''));
    }
    result = await runCouncilRuntime({ question, engines, roles: roles.length ? roles : undefined, chairman,
      registry: host.registry, adapter: host.adapter, timeout, outputDir: handle.path, cwd: context.cwd, signal: context.signal,
    }, host.effects);
    host.assertCurrent();
  } catch (error) {
    try {
      await services.runs.finish(handle, { mode: 'council', startedAt: handle.startedAt,
        endedAt: new Date().toISOString(), ok: false, summary: error instanceof Error ? error.message : String(error),
        engines: engines.map(id => ({ id, status: 'error', detail: 'Council did not complete' })),
      }, context);
    } catch (recordError) {
      try { await services.logger.warn(`Council failure record could not be saved at ${handle.path}: ${recordError instanceof Error ? recordError.message : String(recordError)}`); }
      catch { /* Retain the original workflow error. */ }
    }
    throw error;
  }
  const status = councilRunStatus(result, { ...(label === undefined ? {} : { label }), startedAt: handle.startedAt,
    endedAt: new Date().toISOString(), requested: engines, timeoutSec: timeout });
  // Optional labels are absent in persisted JSON, not undefined values.
  const { label: statusLabel, ...requiredStatus } = status;
  await services.runs.finish(handle, { ...requiredStatus, ...(statusLabel === undefined ? {} : { label: statusLabel }) }, context);
  host.assertCurrent();
  let receiptFailure: Pick<CommandResult, 'stderr' | 'failure'> | undefined;
  if (result.ok) {
    try {
      await services.receipts.record('council', { chairmanId: result.chairmanId, advisors: result.seats.length,
        degraded: result.degraded, confidence: result.confidence });
    } catch (error) {
      host.assertCurrent();
      const message = `Council completed at ${handle.path}, but its receipt could not be recorded: ${error instanceof Error ? error.message : String(error)}. Inspect the saved run before retrying.`;
      receiptFailure = { stderr: message + '\n', failure: { code: 'COUNCIL_RECEIPT_FAILED', message, retryable: false, details: { runPath: handle.path } } };
    }
    host.assertCurrent();
  }
  if (display) {
    presentCouncilResult(result, { json, quiet }, {
      log: line => write(() => display.log(line)), header: line => write(() => display.header(line)),
      info: line => write(() => display.info(line)), bold: display.bold, dim: display.dim,
    });
    if (!quiet && !json) {
      const failed = status.engines.filter(engine => engine.status !== 'ok');
      write(() => display.log(`AGON_SUMMARY: ${status.engines.length - failed.length}/${status.engines.length} succeeded${failed.length ? '; ' + failed.map(engine => `${engine.id}: ${engine.status}`).join(', ') : ''}`));
    }
  }
  return { exitCode: result.ok && !receiptFailure ? 0 : 1, result: result as unknown as Json, ...receiptFailure,
    stdout: display ? (lines.length ? lines.join('\n') + '\n' : '') : quiet && !json ? result.verdict + '\n' : JSON.stringify(result, null, 2) + '\n' };
}
