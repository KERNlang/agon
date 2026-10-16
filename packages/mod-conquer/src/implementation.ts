import { runDoneOracle } from './falsifier.js';
import type { ConquerHostServices } from './host.js';
import type { ConquerIsolation } from './isolation.js';
import { readWorktreeSource, readWorktreePatch } from '@kernlang/agon-support-worktree';
import type { RunRecordHandle } from '@kernlang/agon-mod-api';
import { runConquerWorkflow } from './workflow.js';
import { runBrainstorm } from '@kernlang/agon-mod-brainstorm';
import type { BrainstormModServices } from '@kernlang/agon-mod-brainstorm';
import{existsSync}from'node:fs';import type{AgonModFactory,CommandResult,Dispose,InvocationContext,Json,Registrar}from'@kernlang/agon-mod-api';import{runAgentTask}from'@kernlang/agon-mod-agent';import{runNero}from'@kernlang/agon-mod-nero';import{runTribunal}from'@kernlang/agon-mod-tribunal';import{runCouncil}from'@kernlang/agon-mod-council';import{runFitnessCommand}from'@kernlang/agon-support-verification';
const schema=Object.freeze({type:'object',additionalProperties:true,properties:{task:{type:'string'},builder:{type:'string'},engines:{type:'string'},gate:{type:'string'},gateTimeout:{type:'string'},maxTurns:{type:'string'},timeout:{type:'string'},maxHours:{type:'string'},push:{type:'boolean'},label:{type:'string'},_:{type:'array',items:{type:'string'}}}})as Readonly<Record<string,Json>>;const cli=Object.freeze({positionals:['task'],aliases:{builder:'b',engines:'e',gate:'g'},descriptions:{task:'Task driven autonomously until the explicit gate passes'}});const text=(v:Json|undefined)=>typeof v==='string'?v.trim():'';
const cesarSchema=Object.freeze({type:'object',additionalProperties:false,required:['task','gate'],properties:{task:{type:'string',minLength:1},gate:{type:'string',minLength:1},builder:{type:'string'},engines:{type:'array',items:{type:'string',minLength:1}},maxTurns:{type:'number'}}})as Readonly<Record<string,Json>>;
const tuiSchema = Object.freeze({
  ...schema,
  properties: {
    ...(schema.properties as Record<string, Json>),
    engineIds: { type: 'array', items: { type: 'string' } },
    maxTurns: { type: 'number' }, gateTimeout: { type: 'number' },
    maxHours: { type: 'number' }, turnTimeout: { type: 'number' },
  },
}) as Readonly<Record<string, Json>>;
/** Normalize CLI strings and typed TUI/Cesar options at the shared entry point. */
function normalizeConquerInput(raw: Readonly<Record<string, Json | undefined>>): Record<string, Json | undefined> {
  const input = { ...raw };
  const engines = input.engines ?? input.engineIds;
  if (Array.isArray(engines) && engines.every(id => typeof id === 'string')) {
    input.engines = engines.join(',');
  }
  if (input.timeout === undefined && input.turnTimeout !== undefined) {
    input.timeout = input.turnTimeout;
  }
  for (const key of ['maxTurns', 'gateTimeout', 'timeout', 'maxHours']) {
    const value = input[key];
    if (typeof value !== 'number') continue;
    // Integer options must not become exponent notation before parseInt.
    input[key] = key !== 'maxHours' && Number.isFinite(value)
      ? BigInt(Math.trunc(value)).toString() : String(value);
  }
  return input;
}
export interface ConquerModServices extends BrainstormModServices {
  readonly conquer?: ConquerHostServices;
}
function objectResult(result: CommandResult): Record<string, Json> {
  const payload = result.result;
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
}
export async function runConquerTask(raw:Json,context:InvocationContext,services:ConquerModServices):Promise<CommandResult>{const input=normalizeConquerInput(raw as Record<string,Json>);const task=text(input.task)||(Array.isArray(input._)?input._.map(String).join(' ').trim():'');const gate=text(input.gate);if(!task)return{exitCode:1,stderr:'Conquer requires a task.\n'};if(!gate)return{exitCode:1,stderr:'Conquer requires an explicit --gate done oracle.\n'};if(input.push===true)return{exitCode:1,stderr:'Physical Conquer produces a receipted patch; promotion/push requires the Git Actions mod and explicit operator approval.\n'};const active = services.engines.listActive ? [...await services.engines.listActive(context)] : [];
  const explicitBuilder = text(input.builder);
  const explicitAdvisors = text(input.engines);
  let builder = explicitBuilder || (active.includes('codex') ? 'codex' : active[0]);
  let advisors = explicitAdvisors ? explicitAdvisors.split(',').map(id => id.trim()).filter(Boolean) : active;
  try {
    if (explicitBuilder && services.engines.resolveRequested) {
      builder = (await services.engines.resolveRequested([explicitBuilder], context))[0];
    } else if (builder && active.length && !active.includes(builder)) {
      return { exitCode: 1, stderr: `Builder is not active: ${builder}\n` };
    }
    if (explicitAdvisors && services.engines.resolveRequested) {
      advisors = [...await services.engines.resolveRequested(advisors, context)];
    } else if (explicitAdvisors) {
      const unknown = advisors.filter(id => active.length && !active.includes(id));
      if (unknown.length) return { exitCode: 1, stderr: `Unknown or inactive advisors: ${unknown.join(', ')}\n` };
    }
  } catch (error) {
    return { exitCode: 1, stderr: `${error instanceof Error ? error.message : String(error)}\n` };
  }
  if (!builder) return { exitCode: 1, stderr: 'Builder is not active: (none)\n' };
  advisors = [...new Set(advisors)].filter(id => id !== builder);
  const maxTurns=Number.parseInt(String(input.maxTurns??'40'),10);if(Number.isNaN(maxTurns)||maxTurns<1)return{exitCode:1,stderr:`Invalid --max-turns: ${input.maxTurns}\n`};let maxHours=0;if(input.maxHours!==undefined&&String(input.maxHours).trim()!==''){maxHours=Number.parseFloat(String(input.maxHours));if(Number.isNaN(maxHours)||maxHours<0)return{exitCode:1,stderr:`Invalid --max-hours: ${input.maxHours}\n`};}const timeoutRaw=Number.parseInt(String(input.timeout??'600'),10);const timeout=Number.isFinite(timeoutRaw)&&timeoutRaw>0?String(input.timeout??'600'):'600';const gateTimeoutRaw=Number.parseInt(String(input.gateTimeout??'1800'),10);const gateTimeout=Number.isFinite(gateTimeoutRaw)&&gateTimeoutRaw>0?gateTimeoutRaw:1800;
  if (!services.conquer || !services.runs) return { exitCode: 1, stderr: 'Conquer host capabilities are unavailable. Restart with a compatible modular host.\n' };
  const capabilities = await services.conquer.open(context);
  const runs = services.runs;
  let source: ReturnType<typeof readWorktreeSource>;
  try { source = readWorktreeSource(context.cwd); }
  catch (error) { return { exitCode: 1, stderr: `${error instanceof Error ? error.message : String(error)}\n` }; }
  const turns: Array<{
    turn: number; agent: Json; gate: Json; done: boolean; diffLines?: number;
    completion?: { passed: boolean; reason: string };
  }> = [];
  let gateAborted = false;
  let run: RunRecordHandle | undefined;
  let finalizationAttempted = false;
  let worktree: ConquerIsolation | undefined;
  try {
    run = await runs.start('conquer', text(input.label) || undefined, context);
    worktree = capabilities.createIsolation(task, run.id, source.baseSha);
    const retained = { ...worktree, baseSha: source.baseSha };
    await runs.writeArtifact(run, 'worktree.json', JSON.stringify(retained, null, 2), context);
    const buildContext = { ...context, cwd: retained.path };
    const workflow = await runConquerWorkflow({
      task, builderEngine: builder, outputDir: run.path, signal: context.signal,
      caps: { maxTurns, maxWallClockMs: maxHours * 3_600_000 },
    }, {
      contextSpine: () => services.conquer?.contextSpine(buildContext) ?? Promise.resolve(''),
      build: async (prompt, systemPrompt) => {
        capabilities.assertCurrent();
        const agent = await runAgentTask({
          task: `${prompt}\n\nDONE ORACLE: ${gate}`, engine: builder, timeout, systemPrompt,
        }, buildContext, services, 'agent');
        capabilities.assertCurrent();
        const payload = objectResult(agent);
        turns.push({ turn: turns.length + 1, agent: agent.result ?? null, gate: null, done: false });
        return { stdout: text(payload.final), stderr: agent.stderr, exitCode: agent.exitCode };
      },
      consult: async (mode, question) => {
        capabilities.assertCurrent();
        if (!advisors.length) return { mode, verdict: 'No selected advisors are available.', confidence: null, flawed: false };
        const common = { engines: advisors.join(','), timeout };
        const consult = mode === 'nero'
          ? await runNero({ decision: question, ...common }, buildContext, services)
          : mode === 'tribunal'
            ? await runTribunal({ question, rounds: '1', ...common }, buildContext, services)
            : mode === 'brainstorm'
              ? await runBrainstorm({ question, ...common }, buildContext, services)
              : await runCouncil({ question, ...common }, buildContext, services);
        capabilities.assertCurrent();
        const payload = objectResult(consult);
        return {
          mode,
          verdict: text(mode === 'nero' ? payload.challengeText : payload.verdict ?? payload.response ?? payload.summary ?? payload.recommendation)
            || consult.stderr?.trim() || consult.stdout?.trim() || 'Consultation produced no usable response.',
          confidence: typeof payload.challengeConfidence === 'number' ? payload.challengeConfidence
            : typeof payload.confidence === 'number' ? payload.confidence : null,
          flawed: mode === 'nero' && payload.verdict === 'flawed',
        };
      },
      evaluateDone: async claim => {
        capabilities.assertCurrent();
        const checked = await runFitnessCommand(gate, retained.path, gateTimeout, context.signal);
        capabilities.assertCurrent();
        const diff = readWorktreePatch(retained.path, source.baseSha);
        gateAborted = checked.aborted === true;
        const evidence = await runDoneOracle({
          diff, claim, gate, gateOk: checked.exitCode === 0 && !checked.timedOut && !checked.aborted,
          oracleTampered: false, engines: advisors, timeout: Number(timeout),
          outputDir: run!.path, cwd: retained.path, signal: context.signal,
        }, capabilities);
        capabilities.assertCurrent();
        const hasPatch = diff.trim().length > 0;
        const completion = {
          ...evidence,
          passed: !context.signal.aborted && !gateAborted && evidence.passed && hasPatch,
          reason: !evidence.passed ? evidence.reason : !hasPatch ? 'No patch was produced'
            : `${evidence.reason}; oracle-tamper check not performed`,
        };
        Object.assign(turns[turns.length - 1], {
          gate: { exitCode: checked.exitCode, stdout: checked.stdout, stderr: checked.stderr,
            timedOut: checked.timedOut, durationMs: checked.durationMs },
          diffLines: diff.split('\n').length, done: completion.passed, completion,
        });
        return { ...completion, aborted: gateAborted };
      },
    });
    capabilities.assertCurrent();
    const diff = readWorktreePatch(retained.path, source.baseSha);
    const status = context.signal.aborted || gateAborted ? 'cancelled'
      : workflow.stopReason === 'done' ? 'completed'
      : workflow.stopReason === 'builder-failed' ? 'builder_failed'
      : workflow.stopReason === 'cap-time' ? 'time_budget_exceeded' : 'turn_budget_exceeded';
    const result = {
      status, task, builder, advisors, gate, turns, outputDir: run.path, workflow,
      worktree: retained, baseSha: source.baseSha, dirtySourceExcluded: source.dirtySourceExcluded,
      ...(status === 'completed' ? { winningPatch: diff }
        : { lastPatch: diff }),
    };
    const receiptId = await services.receipts.record('conquer', result as unknown as Json);
    await runs.writeArtifact(run, 'result.json', JSON.stringify({ ...result, receiptId }, null, 2), context);
    await runs.writeArtifact(run, 'result.patch', diff, context);
    finalizationAttempted = true;
    await runs.finish(run, {
      mode: 'conquer', startedAt: run.startedAt, endedAt: new Date().toISOString(),
      engines: [builder, ...advisors].map(id => ({ id, status: status === 'completed' ? 'ok' : 'error' })),
      ok: status === 'completed', summary: workflow.doneReason || status,
    }, context);
    if (status === 'completed') return {
      exitCode: 0, stdout: `${JSON.stringify({ ...result, receiptId }, null, 2)}\n`,
      result: { ...result, receiptId } as unknown as Json,
    };
    return {
      exitCode: 1, stderr: `Conquer stopped without satisfying completion requirements. Receipt: ${receiptId}\nWork preserved on ${retained.branch} at ${retained.path}.\n`,
      result: { ...result, receiptId } as unknown as Json,
      failure: { code: 'CONQUER_INCOMPLETE', message: status === 'builder_failed'
        ? 'Conquer builder failed before verification' : 'Conquer stopped without satisfying completion requirements', retryable: true },
    };
  } catch (error) {
    if (worktree) console.warn(`[agon] Conquer work preserved on ${worktree.branch} at ${worktree.path}`);
    if (run && !finalizationAttempted) {
      try {
        await runs.finish(run, {
          mode: 'conquer', startedAt: run.startedAt, endedAt: new Date().toISOString(),
          engines: [], ok: false, summary: error instanceof Error ? error.message : String(error),
        }, context);
      } catch (finalizationError) {
        console.warn(`[agon] conquer failure recording failed: ${finalizationError instanceof Error ? finalizationError.message : String(finalizationError)}`);
      }
    }
    throw error;
  } finally {
    if (worktree) await services.logger.debug('conquer worktree retained', {
      branch: worktree.branch, path: worktree.path, retained: existsSync(worktree.path),
    });
  }
}

function parseConquer(value: string) {
  const source = value.replace(/^\/conquer\s*/i, '');
  const consumed: Array<{ start: number; end: number }> = [];
  let gate: string | undefined, builder: string | undefined, engineIds: string[] | undefined;
  const take = (pattern: RegExp, assign: (match: RegExpMatchArray) => void) => {
    const matches = source.matchAll(new RegExp(pattern.source, `${pattern.flags}g`));
    const match = [...matches].find(candidate => !consumed.some(range =>
      candidate.index < range.end && candidate.index + candidate[0].length > range.start));
    if (match) {
      assign(match);
      consumed.push({ start: match.index, end: match.index + match[0].length });
    }
  };
  take(/--gate\s+(?:"([^"]*)"|'([^']*)'|(\S+(?:\s+(?!--|-[A-Za-z])\S+)*))/, m => { gate = (m[1] ?? m[2] ?? m[3] ?? '').trim(); });
  take(/(?:--builder|-b)\s+(\S+)/, m => { builder = m[1]; });
  take(/(?:--engines|-e)\s+(\S+)/, m => { engineIds = m[1].split(',').map(id => id.trim()).filter(Boolean); });
  const numeric = (flag: string, parse: (value: string) => number, minimum: number, fallback?: number): number | undefined => {
    let result: number | undefined;
    take(new RegExp(`(?:^|\\s)--${flag}(?=\\s|$)(?:\\s+(?!--)(\\S+))?`), match => {
      const raw = match[1] ?? '';
      const parsed = parse(raw);
      if (!Number.isFinite(parsed) || parsed < minimum) {
        if (fallback === undefined) throw new TypeError(`Invalid --${flag}: ${raw || '(missing value)'}`);
        result = fallback;
      } else result = parsed;
    });
    return result;
  };
  const integer = (raw: string) => Number.parseInt(raw, 10);
  const maxTurns = numeric('max-turns', integer, 1);
  const gateTimeout = numeric('gate-timeout', integer, 1, 1800);
  const maxHours = numeric('max-hours', Number.parseFloat, 0);
  const turnTimeout = numeric('timeout', integer, 1, 600);
  let rest = source;
  for (const range of consumed.sort((left, right) => right.start - left.start)) {
    rest = rest.slice(0, range.start) + ' ' + rest.slice(range.end);
  }
  return { task: rest.replace(/\s+/g, ' ').trim(), gate, builder, engineIds, maxTurns, gateTimeout, maxHours, turnTimeout };
}
export const createMod:AgonModFactory=services=>Object.freeze({apiVersion:'1'as const,async activate(registrar:Registrar):Promise<Dispose>{const d:Dispose[]=[];const command={description:'Supervised autonomous build in an isolated worktree with an explicit done oracle',inputSchema:schema,cli,run:(input:Json,context:InvocationContext)=>runConquerTask(input,context,services)};d.push(registrar.command('cli',{id:'cliCommands:0013',...command}));d.push(registrar.command('tui',{id:'tuiSlashCommands:0021',...command,inputSchema:tuiSchema,parse:parseConquer}));d.push(registrar.planStep({id:'cesarRoutes:0016',inputSchema:schema,resultSchema:schema,risk:'workspace-write',run:(input,context)=>runConquerTask(input,context,services)}));d.push(registrar.tool('cesar',{id:'cesarTools:0004',description:'Hand this task to the supervised Conquer controller',inputSchema:cesarSchema,effect:'process',run:async()=> 'Delegation accepted. STOP responding now. The orchestrator will handle the rest.'}));for (const id of ['resultAndEnvelopeTypes:0037', 'resultAndEnvelopeTypes:0055']) d.push(registrar.resultType({ id, schema: { type: 'object', additionalProperties: true }, readableVersions: '>=0.2.0', render: async (payload) => ({ text: JSON.stringify(payload, null, 2) }) }));
return async()=>{for(const x of[...d].reverse())await x();};}});export default createMod;
