import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { printRunSummary } from '@kernlang/agon-support-persistence';
import { presentThinkResult } from './presentation.js';
import type { ThinkResult } from './thinking.js';

describe('Think frozen CLI presentation', () => {
  it.each([false, true])('preserves legacy result output (quiet=%s)', async quiet => {
    const result: ThinkResult = {problem:'fixture',strategy:'tot',engineId:'fixture',ok:true,
      thoughts:[{thoughtNumber:1,totalThoughts:1,thought:'A discarded branch',kind:'decision',nextThoughtNeeded:false,
        branchId:'alpha',branchScore:0.2,grounded:false,pruned:true}],
      summary:'Keep the evidence',openQuestions:['What remains?'],refinedSpec:'Implement it',
      protocolValid:false,groundingIssues:['Missing file'],chosenBranch:'beta',adversarialCritique:'Check assumptions',criticEngineId:'critic'};
    const legacyLines: string[] = [];
    const styles = {bold:(s:string)=>`B(${s})`,dim:(s:string)=>`D(${s})`};
    const source = readFileSync(new URL('../../../tests/fixtures/modular-think-command-legacy.txt',import.meta.url),'utf8');
    const exports: Record<string, any> = {};
    const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const modules: Record<string, unknown> = {
      citty:{defineCommand:(command:unknown)=>command},
      '@kernlang/agon-core':{EngineRegistry:class {load(){} activeIds(){return ['fixture'];} get(id:string){return {id};}},
        ensureAgonHome:()=>{},loadConfig:()=>({}),createRunDir:()=>({path:'/fixture/think'}),writeRunStatus:()=>{},
        printRunSummary:(status:Parameters<typeof printRunSummary>[0])=>{
          const capture=vi.spyOn(process.stdout,'write').mockImplementation(chunk=>{legacyLines.push(String(chunk).replace(/\n$/,''));return true;});
          try { printRunSummary(status); } finally { capture.mockRestore(); }
        }},
      '../lib/engines-dir.js':{resolveBuiltinEnginesDir:()=>'/fixture/engines'},
      '@kernlang/agon-adapter-cli':{createCliAdapter:()=>({})},
      '@kernlang/agon-forge':{runThinkChain:async()=>result,isThinkStrategy:()=>true,joinProblemInput:()=> 'fixture'},
      '../blocks/output-format.js':{...styles,header:()=>{},info:(s:string)=>{if(s!=='fixture')legacyLines.push(s);}},
      '../handlers/engine-filter.js':{filterDefaultOrchestrationEngines:(ids:string[])=>ids},
    };
    runInNewContext(code,{exports,require:(id:string)=>{if(!(id in modules))throw new Error(`Unexpected import ${id}`);return modules[id];},
      console:{log:(s:string)=>legacyLines.push(s),error:()=>{throw new Error('Unexpected CLI error');},warn:()=>{}},process:{cwd:()=>'/fixture/think'}});
    await exports.thinkCommand.run({args:{problem:'fixture',strategy:'tot',quiet,goal:true}});
    // The command emits a blank line after its pre-dispatch heading.
    if(!quiet) expect(legacyLines.shift()).toBe('');
    const actual: string[] = [];
    presentThinkResult(result,{quiet,goal:true,strategy:'tot',outputDir:'/fixture/think'},
      {...styles,log:s=>actual.push(s),header:s=>actual.push(s),info:s=>actual.push(s)});
    expect(actual).toEqual(legacyLines);
    expect(actual.join('\n')).toContain('Open questions');
    expect(actual.join('\n')).toContain('Adversarial critique');
    if(quiet) expect(actual.join('\n')).not.toContain('discarded branch');
    else expect(actual.join('\n')).toContain('✂ pruned');
  });
});
