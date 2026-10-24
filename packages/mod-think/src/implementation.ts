import type { AgonModFactory, CommandResult, Dispose, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { isThinkStrategy, joinProblemInput, type ThinkResult } from './thinking.js';
import { runThinkRuntime } from './runtime.js';
import type { ThinkModServices } from './host.js';
import { presentThinkResult } from './presentation.js';
import type { ThinkDisplay } from './presentation.js';

const inputSchema = Object.freeze({ type: 'object', additionalProperties: true, properties: {
  problem: { type: 'string' }, _: { type: 'array', items: { type: 'string' } }, strategy: { type: 'string', default: 'linear' },
  critic: { type: 'string' }, engine: { type: 'string' }, steps: { type: 'string', default: '6' }, branches: { type: 'string', default: '1' },
  timeout: { type: 'string', default: '120' }, ground: { type: 'boolean', default: true }, goal: { type: 'boolean' }, json: { type: 'boolean' }, quiet: { type: 'boolean' }, label: { type: 'string' },
} }) as Readonly<Record<string, Json>>;
const cli = Object.freeze({
  "positionals": [
    "problem"
  ],
  "descriptions": {
    "problem": "The task / problem to think through.",
    "strategy": "Thinking method: linear | reflexion (forced critique+revision) | tot (self-scored branches, prune to winner) | graph (branch then merge) | hypothesis (competing hypotheses, eliminate losers).",
    "critic": "A SECOND engine that adversarially attacks the chain after it is produced (cross-engine critique). e.g. --critic codex.",
    "engine": "Engine id to think with. Omit to use the default (first active) engine.",
    "steps": "Max thoughts (steps of thought) to produce. Clamped to 1..20.",
    "branches": "Explore N alternative reasoning branches (emission only — v1 does not auto-score/prune). Clamped to 1..8. e.g. --steps 20 --branches 5.",
    "timeout": "Timeout in seconds.",
    "ground": "Verify file paths cited in thoughts against the repo and flag phantom ones. On by default; --no-ground to disable.",
    "goal": "Print a ready-to-run `agon goal` handoff built from the refined spec.",
    "json": "Emit the full ThinkResult as JSON on stdout (the handoff artifact; pipe-friendly).",
    "quiet": "Print only the summary.",
    "label": "Human-readable suffix baked into the run dir name."
  }
});
const tuiInputSchema = Object.freeze({ ...inputSchema, properties: {
  ...(inputSchema.properties as Record<string, Json>), input: { type: 'string' },
  steps: { type: 'number' }, branches: { type: 'number' }, timeout: { type: 'number' },
} });
function tuiRequest(raw: Json): Json {
  const input = raw as Record<string, Json>;
  const request: Record<string, Json> = { ...input, problem: input.input ?? input.problem ?? '' };
  for (const key of ['steps', 'branches', 'timeout']) {
    if (typeof input[key] === 'number') request[key] = String(input[key]);
  }
  return request;
}
const strings=(value:unknown):string[]=>Array.isArray(value)?value.map(String):[];
const number=(value:Json|undefined,fallback:number,min:number,max:number)=>Math.max(min,Math.min(Number.parseInt(typeof value==='string'?value:String(fallback),10)||fallback,max));
async function runThink(raw: Json, context: Parameters<ModServices['engines']['dispatch']>[2], services: ThinkModServices, cliOutput = false): Promise<CommandResult> {
  context.signal.throwIfAborted();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {exitCode:1,stderr:'Provide a Think request object.\n'};
  const input = raw as Record<string, Json>;
  const problem = joinProblemInput(typeof input.problem === 'string' ? input.problem : undefined, strings(input._));
  if (!problem) return {exitCode:1,stderr:'Provide a problem. Usage: agon think "your task" [--strategy reflexion] [--steps 8]\n'};
  if (!services.think || !services.runs) return {exitCode:1,stderr:'Think host capabilities are unavailable. Restart with a compatible modular host.\n'};
  const host = await services.think.open(context);
  host.assertCurrent();
  const requested = typeof input.strategy === 'string' ? input.strategy : 'linear';
  const strategy = isThinkStrategy(requested) ? requested : 'linear';
  if (!isThinkStrategy(requested) && input.quiet !== true) host.effects.warn(`[agon] unknown strategy '${requested}' — using linear (valid: linear|reflexion|tot|graph|hypothesis).`);
  const steps = number(input.steps, 6, 1, 20);
  const branches = number(input.branches, 1, 1, 8);
  const timeoutSec = Number.parseInt(String(input.timeout ?? '120'), 10) || 120;
  const engineId = typeof input.engine === 'string' && input.engine.trim() ? input.engine.trim() : host.defaultEngineIds[0];
  if (!engineId) return {exitCode:1,stderr:'No active engines. Run `agon engine list` or `agon engine add <id>`.\n'};
  let critic: string | undefined;
  if (typeof input.critic === 'string' && input.critic.trim()) {
    const wanted = host.registry.resolveId(input.critic.trim());
    if (host.activeEngineIds.includes(wanted)) critic = wanted;
    else host.effects.warn(`[agon] --critic '${input.critic.trim()}' is not an active engine — skipping the adversarial critique.`);
  }
  const resolvedEngine = host.registry.get(engineId).id;
  const label = typeof input.label === 'string' ? input.label : undefined;
  const handle = await services.runs.start('think', label, context);
  host.assertCurrent();
  const lines: string[] = [];
  const log = (value: string) => { lines.push(value); };
  const plain = (value: string) => value;
  const output = cliOutput && services.think.cliOutput ? services.think.cliOutput : { log, header: log, info: log, bold: plain, dim: plain };
  const write = (effect: (text: string) => void) => (text: string) => { host.assertCurrent(); effect(text); host.assertCurrent(); };
  const display: ThinkDisplay = { ...output, log: write(output.log), header: write(output.header), info: write(output.info) };
  const quiet = input.quiet === true;
  let result: ThinkResult;
  try {
    host.assertCurrent();
    if (!quiet && input.json !== true) {
      display.header(`Think · ${display.bold(requested)} · ${resolvedEngine}`);
      display.info(problem.length > 120 ? problem.slice(0, 120) + '...' : problem);
      display.log('');
    }
    result = await runThinkRuntime({problem, strategy: requested, engineId: resolvedEngine, registry: host.registry,
      adapter: host.adapter, maxThoughts: steps, branches, critic, timeout: timeoutSec,
      outputDir: handle.path, cwd: context.cwd, ground: input.ground !== false, signal: context.signal}, host.effects);
    host.assertCurrent();
  } catch (error) {
    host.assertCurrent();
    try {
      await services.runs.finish(handle, {mode:'think',startedAt:handle.startedAt,endedAt:new Date().toISOString(),ok:false,
        summary:error instanceof Error ? error.message : String(error),engines:[{id:resolvedEngine,status:'error',detail:'Think did not complete'}]}, context);
    } catch (recordError) {
      host.assertCurrent();
      try { await services.logger.warn(`Think failure record could not be saved at ${handle.path}: ${recordError instanceof Error ? recordError.message : String(recordError)}`); }
      catch { /* Preserve the workflow failure if diagnostics fail. */ }
    }
    host.assertCurrent();
    throw error;
  }
  await services.runs.finish(handle, {mode:'think',...(label === undefined ? {} : {label}),
    startedAt:handle.startedAt,endedAt:new Date().toISOString(),ok:result.ok,requested:[resolvedEngine],timeoutSec,
    engines:[{id:resolvedEngine,status:result.ok?'ok':'error',detail:result.ok?`${result.thoughts.length} thoughts (${requested})`:'no usable thinking chain'}],
    summary:result.ok?`${resolvedEngine}: ${result.thoughts.length} thoughts (${requested})`:`${resolvedEngine} produced no usable chain`}, context);
  host.assertCurrent();
  let receiptFailure: Pick<CommandResult, 'stderr' | 'failure'> | undefined;
  if (result.ok) {
    try {
      await services.receipts.record('think',{engineId:resolvedEngine,strategy,steps:result.thoughts.length,protocolValid:result.protocolValid});
    } catch (error) {
      host.assertCurrent();
      const message = `Think completed at ${handle.path}, but its receipt could not be recorded: ${error instanceof Error ? error.message : String(error)}. Inspect the saved run before retrying.`;
      receiptFailure = { stderr: message + '\n', failure: { code: 'THINK_RECEIPT_FAILED', message, retryable: false, details: { runPath: handle.path } } };
    }
  }
  host.assertCurrent();
  if (input.json === true) return {exitCode:result.ok&&!receiptFailure?0:1,stdout:JSON.stringify(result,null,2)+'\n',...receiptFailure};
  if (!result.ok) return {exitCode:1,stdout:lines.length ? lines.join('\n')+'\n' : '',stderr:`${resolvedEngine} produced no usable thinking chain.\n`};
  presentThinkResult(result, { quiet, goal: input.goal === true, strategy: requested, outputDir: handle.path }, display);
  return {exitCode:receiptFailure?1:0,stdout:lines.length ? lines.join('\n')+'\n' : '',...receiptFailure};
}
function parseThink(value: string): Record<string, Json> | undefined {
  if (!/^\/think(?:\s|$)/i.test(value)) return undefined;
  const parts = value.replace(/^\/think\s*/i, '').split(/\s+/);
  const input: Record<string, Json> = {};
  const problem: string[] = [];
  const stringFlags = new Set(['strategy', 'steps', 'branches', 'engine', 'critic', 'timeout', 'label']);
  const booleanFlags = new Set(['ground', 'goal', 'json', 'quiet']);
  for (let index = 0; index < parts.length; index++) {
    const token = parts[index];
    const flag = token.startsWith('--') ? token.slice(2) : '';
    if (stringFlags.has(flag) && parts[index + 1]) {
      const value = parts[++index];
      if (['steps', 'branches', 'timeout'].includes(flag)) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isNaN(parsed)) input[flag] = parsed;
      } else input[flag] = value;
    } else if (booleanFlags.has(flag)) {
      input[flag] = true;
    } else if (flag.startsWith('no-') && booleanFlags.has(flag.slice(3))) {
      input[flag.slice(3)] = false;
    } else {
      problem.push(token);
    }
  }
  input.input = problem.join(' ').trim();
  return input;
}
export const createMod:AgonModFactory=(services)=>Object.freeze({apiVersion:'1' as const,async activate(registrar:Registrar):Promise<Dispose>{
  const disposers=[registrar.command('cli',{id:'cliCommands:0071',description:"Sequential thinking — decompose a problem into structured thoughts before acting. `agon think \"...\" --strategy reflexion`. Opt-in; surfaces open questions and a goal handoff.",inputSchema,cli,run:(input,context)=>runThink(input,context,services,true)}),
    registrar.command('tui',{id:'tuiSlashCommands:0067',description:'Sequential thinking',inputSchema:tuiInputSchema,parse:parseThink,run:(input,context)=>runThink(tuiRequest(input),context,services)}),
    registrar.resultType({id:'resultAndEnvelopeTypes:0133',schema:{type:'object',additionalProperties:true},readableVersions:'>=0.2.0',render:async(payload)=>({text:JSON.stringify(payload,null,2)})})];
  return async()=>{for(const dispose of [...disposers].reverse())await dispose();};
}});
export default createMod;
