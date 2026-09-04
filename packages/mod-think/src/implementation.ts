import type { AgonModFactory, CommandResult, Dispose, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { buildThinkPrompt, groundThoughts, isThinkStrategy, joinProblemInput, parseThoughts, selectBranch, validateChain, type ThinkResult } from './thinking.js';

const inputSchema = Object.freeze({ type: 'object', additionalProperties: true, properties: {
  problem: { type: 'string' }, _: { type: 'array', items: { type: 'string' } }, strategy: { type: 'string', default: 'linear' },
  critic: { type: 'string' }, engine: { type: 'string' }, steps: { type: 'string', default: '6' }, branches: { type: 'string', default: '1' },
  timeout: { type: 'string', default: '120' }, ground: { type: 'boolean', default: true }, goal: { type: 'boolean' }, json: { type: 'boolean' }, quiet: { type: 'boolean' }, label: { type: 'string' },
} }) as Readonly<Record<string, Json>>;
const cli = Object.freeze({ positionals: ['problem'], descriptions: { problem: 'Task or problem to think through' } });
const strings=(value:unknown):string[]=>Array.isArray(value)?value.map(String):[];
const number=(value:Json|undefined,fallback:number,min:number,max:number)=>Math.max(min,Math.min(Number.parseInt(typeof value==='string'?value:String(fallback),10)||fallback,max));
async function runThink(raw: Json, context: Parameters<ModServices['engines']['dispatch']>[2], services: ModServices): Promise<CommandResult> {
  const input=raw as Record<string,Json>; const problem=joinProblemInput(typeof input.problem==='string'?input.problem:undefined,strings(input._));
  if(!problem)return {exitCode:1,stderr:'Provide a problem. Usage: agon think "your task" [--strategy reflexion] [--steps 8]\n'};
  const requested=typeof input.strategy==='string'?input.strategy:'linear'; const strategy=isThinkStrategy(requested)?requested:'linear';
  const steps=number(input.steps,6,1,20); const branches=number(input.branches,1,1,8); const timeoutSeconds=number(input.timeout,120,1,3600);
  const engineId=typeof input.engine==='string'?input.engine.trim():'';
  try {
    const dispatched=await services.engines.dispatch(engineId,buildThinkPrompt(problem,strategy,steps,branches),context,{timeoutSeconds,systemPrompt:'You are a structured sequential reasoner. Output ONLY the JSON object requested. Do NOT use tools, read files, or run commands.'}) as Record<string,Json>;
    const resolvedEngine=typeof dispatched.engineId==='string'?dispatched.engineId:engineId; const rawText=typeof dispatched.stdout==='string'?dispatched.stdout:'';
    if(dispatched.exitCode!==0||dispatched.timedOut===true||!rawText.trim())return {exitCode:1,stderr:`${resolvedEngine||'engine'} produced no usable thinking chain.\n`};
    const parsed=parseThoughts(rawText,Math.min(steps*branches,80)); const grounded=input.ground===false?{thoughts:parsed.thoughts,issues:[]}:groundThoughts(parsed.thoughts,context.cwd);
    const selected=strategy==='tot'?selectBranch(grounded.thoughts):{thoughts:grounded.thoughts,chosenBranch:undefined};
    let adversarialCritique:string|undefined; const critic=typeof input.critic==='string'?input.critic.trim():'';
    if(critic&&critic!==resolvedEngine){ const chain=selected.thoughts.map((thought)=>`${thought.thoughtNumber}. [${thought.kind}] ${thought.thought}`).join('\n');
      const challenged=await services.engines.dispatch(critic,`A reasoner produced this chain for the task: ${problem}\n\n${chain}\n\nConclusion: ${parsed.summary}\n\nIn <=6 bullets identify unsupported or missing steps.`,context,{timeoutSeconds,systemPrompt:'You are an adversarial reviewer. Return terse critique bullets only.'}) as Record<string,Json>;
      if(challenged.exitCode===0&&typeof challenged.stdout==='string'&&challenged.stdout.trim())adversarialCritique=challenged.stdout.trim(); }
    const result:ThinkResult={problem,strategy,engineId:resolvedEngine,thoughts:selected.thoughts,summary:parsed.summary,openQuestions:parsed.openQuestions,refinedSpec:parsed.refinedSpec||problem,protocolValid:validateChain(grounded.thoughts,strategy),groundingIssues:grounded.issues,chosenBranch:selected.chosenBranch,adversarialCritique,criticEngineId:adversarialCritique?critic:undefined,ok:true};
    await services.receipts.record('think',{engineId:resolvedEngine,strategy,steps:result.thoughts.length,protocolValid:result.protocolValid});
    if(input.json===true)return {exitCode:0,stdout:JSON.stringify(result,null,2)+'\n'};
    if(input.quiet===true)return {exitCode:0,stdout:(result.summary||result.refinedSpec)+'\n'};
    const lines=[`Think · ${strategy} · ${resolvedEngine}`,'',...result.thoughts.filter((thought)=>!thought.pruned).map((thought)=>`${thought.thoughtNumber}/${thought.totalThoughts} [${thought.kind}] ${thought.thought}`),'',result.summary?`Summary\n${result.summary}`:'',...(result.openQuestions.length?['','Open questions',...result.openQuestions.map((question)=>`- ${question}`)]:[]),...(adversarialCritique?['','Adversarial critique',adversarialCritique]:[]),...(input.goal===true?['','Goal handoff',`agon goal ${JSON.stringify(result.refinedSpec)}`]:[])];
    return {exitCode:0,stdout:lines.filter((line,index)=>line!==''||lines[index-1]!=='').join('\n')+'\n'};
  } catch(error){return {exitCode:1,stderr:`${error instanceof Error?error.message:String(error)}\n`};}
}
function parseThink(value:string){const parts=value.replace(/^\/think\s*/i,'').split(/\s+/);let strategy:string|undefined,steps:number|undefined;const problem:string[]=[];for(let index=0;index<parts.length;index+=1){if(parts[index]==='--strategy'&&parts[index+1]){strategy=parts[++index].toLowerCase();continue;}if(parts[index]==='--steps'&&parts[index+1]){const parsed=Number.parseInt(parts[++index],10);if(!Number.isNaN(parsed))steps=parsed;continue;}problem.push(parts[index]);}return{input:problem.join(' ').trim(),strategy,steps};}
export const createMod:AgonModFactory=(services)=>Object.freeze({apiVersion:'1' as const,async activate(registrar:Registrar):Promise<Dispose>{
  const disposers=[registrar.command('cli',{id:'cliCommands:0071',description:'Sequential thinking with structured validation',inputSchema,cli,run:(input,context)=>runThink(input,context,services)}),
    registrar.command('tui',{id:'tuiSlashCommands:0067',description:'Sequential thinking',inputSchema,parse:parseThink,run:(input,context)=>runThink(input,context,services)})];
  return async()=>{for(const dispose of [...disposers].reverse())await dispose();};
}});
export default createMod;
