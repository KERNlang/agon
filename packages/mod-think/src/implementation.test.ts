import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CommandContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from './implementation.js';
import { createThinkHostServices } from './host.js';
import type { EngineAdapter, EngineDefinition } from '@kernlang/agon-support-engine-runtime';
describe('physical think mod',()=>{
  it.each(['active-excluded','alias-to-reasoner','inactive'] as const)('preserves critic selection: %s', async scenario => {
    const warn=vi.fn();
    const dispatch=vi.fn(async(request:Parameters<EngineAdapter['dispatch']>[0])=>({engineId:request.engine.id,exitCode:0,stdout:request.engine.id==='critic'?'Critique':JSON.stringify({thoughts:[],summary:'Done'}),stderr:'',timedOut:false,durationMs:1}));
    const think=createThinkHostServices({openRegistry:()=>({get:id=>({id}) as EngineDefinition,resolveId:id=>id==='alias'?'reasoner':id}),
      createAdapter:()=>({dispatch}) as unknown as EngineAdapter,selectEngines:()=>({activeEngineIds:['reasoner','critic'],defaultEngineIds:['reasoner']}),
      captureAuthority:()=>()=>{},warn});
    const services={think,runs:{start:async()=>({id:'run',path:'/fixture/think',startedAt:'2026-01-01T00:00:00Z'}),finish:vi.fn()},receipts:{record:vi.fn(async()=> 'r')}} as unknown as ModServices;
    let command!:CommandContribution;
    const mod=await createMod(services);
    await mod.activate({command:(surface,value)=>{if(surface==='cli')command=value;return()=>{};},resultType:()=>()=>{}} as Registrar);
    const critic=scenario==='active-excluded'?'critic':scenario==='alias-to-reasoner'?'alias':'inactive';
    const result=await command.run({problem:'Inspect',critic,json:true},{invocationId:'i',cwd:process.cwd(),platform:'darwin-arm64',signal:new AbortController().signal,config:{}});
    expect(result).toMatchObject({exitCode:0});
    expect(dispatch.mock.calls.map(([request])=>request.engine.id)).toEqual(scenario==='active-excluded'?['reasoner','critic']:['reasoner']);
    if(scenario==='inactive') expect(warn).toHaveBeenCalledWith(expect.stringContaining('not an active engine'));
    else expect(warn).not.toHaveBeenCalled();
  });
  it('declares the public runtime and host declaration closure', () => {
    const manifest = JSON.parse(readFileSync(new URL('../agon.mod.json', import.meta.url), 'utf8'));
    expect(manifest.pack.include).toEqual(expect.arrayContaining(['dist/thinking.d.ts','dist/runtime.d.ts','dist/host.d.ts','dist/presentation.d.ts']));
  });
  it.each(['cancellation', 'generation'].flatMap(fault => ['start', 'dispatch', 'finish', 'receipt', 'receipt-error'].map(phase => [fault, phase])))('stops effects after %s during %s', async (fault, phase) => {
    const controller = new AbortController();
    let current = true;
    const revoke = () => { if (fault === 'cancellation') controller.abort(new Error('authority lost')); else current = false; };
    const dispatch = vi.fn(async () => {
      if (phase === 'dispatch') revoke();
      return {engineId:'fixture',exitCode:0,stdout:JSON.stringify({thoughts:[],summary:'Completed'}),stderr:'',timedOut:false,durationMs:1};
    });
    const finish = vi.fn(async () => { if (phase === 'finish') revoke(); });
    const receipt = vi.fn(async () => { if (phase.startsWith('receipt')) revoke(); if (phase === 'receipt-error') throw new Error('receipt failed'); return 'r'; });
    const displayed: string[] = [];
    const think = createThinkHostServices({openRegistry:()=>({get:id=>({id}) as EngineDefinition,resolveId:id=>id}),
      createAdapter:()=>({dispatch}) as unknown as EngineAdapter,selectEngines:()=>({activeEngineIds:['fixture'],defaultEngineIds:['fixture']}),
      captureAuthority:()=>()=>{if (!current) throw new Error('authority lost');},warn:vi.fn()});
    Object.assign(think,{cliOutput:{log:(s:string)=>displayed.push(s),header:(s:string)=>displayed.push(s),info:(s:string)=>displayed.push(s),bold:(s:string)=>s,dim:(s:string)=>s}});
    const services = {think,logger:{warn:vi.fn()},receipts:{record:receipt},runs:{
      start:async()=>{if (phase === 'start') revoke();return {id:'run',path:'/fixture/think',startedAt:'2026-01-01T00:00:00Z'};},finish,
    }} as unknown as ModServices;
    let command!: CommandContribution;
    const mod = await createMod(services);
    await mod.activate({command:(surface,value)=>{if(surface==='cli')command=value;return()=>{};},resultType:()=>()=>{}} as Registrar);
    await expect(command.run({problem:'Inspect',quiet:true},{invocationId:'i',cwd:process.cwd(),platform:'darwin-arm64',signal:controller.signal,config:{}})).rejects.toThrow('authority lost');
    expect(dispatch).toHaveBeenCalledTimes(phase === 'start' ? 0 : 1);
    expect(finish).toHaveBeenCalledTimes(['start','dispatch'].includes(phase) ? 0 : 1);
    expect(receipt).toHaveBeenCalledTimes(phase.startsWith('receipt') ? 1 : 0);
    expect(displayed).toEqual([]);
  });
  it.each([[0,'json'],[2,'json'],[0,'human'],[0,'quiet'],[0,'injected'],[2,'human'],[2,'injected'],[0,'json-receipt'],[0,'human-receipt'],[0,'injected-receipt']] as const)('preserves output and run status (engine exit %s, %s)',async(exitCode,variant)=>{
    const receiptFailure = variant.endsWith('-receipt');
    const mode = variant.replace('-receipt', '');
    const displayed: string[] = [];
    const dispatch=vi.fn(async()=>({engineId:'codex',exitCode,stdout:JSON.stringify({thoughts:[{thoughtNumber:1,totalThoughts:1,thought:'Decide from evidence',kind:'decision',nextThoughtNeeded:false}],summary:'Done',openQuestions:[],refinedSpec:'Implement it'}),stderr:'',timedOut:false,durationMs:5}));
    const finish = vi.fn();
    const think = createThinkHostServices({openRegistry:()=>({get:id=>({id}) as EngineDefinition,resolveId:id=>id}),
      createAdapter:()=>({dispatch}) as unknown as EngineAdapter,selectEngines:()=>({activeEngineIds:['codex'],defaultEngineIds:['codex']}),
      captureAuthority:()=>()=>{},warn:vi.fn()});
    const receipt=vi.fn(async()=> { if (receiptFailure) throw new Error('receipt disk full'); return 'r'; }); const services={identity:{id:'agon.think',version:'1.0.0',contentHash:`sha256:${'a'.repeat(64)}`},source:'bundled',logger:{debug:vi.fn(),info:vi.fn(),warn:vi.fn()},receipts:{record:receipt},permissions:{check:vi.fn(async()=> 'allow')},state:{read:vi.fn(),write:vi.fn()},think,
      runs:{start:async()=>({id:'run',path:'/fixture/think',mode:'think',startedAt:'2026-01-01T00:00:00Z'}),finish},
      engines:{dispatch:()=>{throw new Error('generic dispatch must not run');}}} as unknown as ModServices;
    if(mode==='injected') Object.assign(think,{cliOutput:{log:(s:string)=>displayed.push(s),header:(s:string)=>displayed.push(s),info:(s:string)=>displayed.push(s),bold:(s:string)=>s,dim:(s:string)=>s}});
    let command:CommandContribution|undefined; const registrar={command:(surface:string,value:CommandContribution)=>{if(surface==='cli')command=value;return()=>{};},resultType:()=>()=>{}} as unknown as Registrar;
    const mod=await createMod(services);await mod.activate(registrar,services); const result=await command!.run({problem:'What next?',json:mode==='json',quiet:mode==='quiet',goal:true},{invocationId:'i',cwd:process.cwd(),platform:'darwin-arm64',signal:new AbortController().signal,config:{}});
    expect(result).toMatchObject({exitCode:exitCode===0&&!receiptFailure?0:1}); const parsed=mode==='json'?JSON.parse((result as any).stdout):undefined;
    if (receiptFailure) {
      expect(result).toMatchObject({failure:{code:'THINK_RECEIPT_FAILED',retryable:false,details:{runPath:'/fixture/think'}},stderr:expect.stringContaining('receipt disk full')});
      expect(finish).toHaveBeenCalledTimes(1);
    }
    if (exitCode===0) {
      if(mode==='json') expect(parsed).toMatchObject({ok:true,summary:'Done',protocolValid:true});
      else {
        const text=mode==='injected'?displayed.join('\n'):(result as {stdout:string}).stdout;
        expect(text).toContain('Summary\nDone');
        expect(text).toContain('Handoff → goal');
        if(mode==='quiet') expect(text).not.toContain('Think ·');
        else expect(text).toContain('Think · linear · codex');
        if(mode==='injected') expect(result).toMatchObject({stdout:''});
        if(mode!=='quiet') expect(text.match(/AGON_SUMMARY:/g)).toHaveLength(1);
      }
      expect(receipt).toHaveBeenCalledWith('think',expect.objectContaining({protocolValid:true}));
    } else {
      if(mode==='json') expect(parsed).toEqual({problem:'What next?',strategy:'linear',engineId:'codex',thoughts:[],summary:'',openQuestions:[],refinedSpec:'What next?',protocolValid:false,groundingIssues:[],ok:false});
      else {
        const text=mode==='injected'?displayed.join('\n'):(result as {stdout:string}).stdout;
        expect(text).toContain('Think · linear · codex');
        expect(text).toContain('What next?');
        expect(result).toMatchObject({stderr:'codex produced no usable thinking chain.\n'});
        expect(text).not.toContain('AGON_SUMMARY:');
      }
      expect(receipt).not.toHaveBeenCalled();
    }
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({outputDir:'/fixture/think',textOnly:true,mode:'exec',cwd:process.cwd()}));
    expect(finish).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({mode:'think',ok:exitCode===0,requested:['codex'],timeoutSec:120}),expect.anything());
  });
});
