import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from './implementation.js';
describe('physical think mod',()=>{
  it('runs, parses, validates, and receipts a structured chain without the legacy bridge',async()=>{
    const dispatch=vi.fn(async()=>({engineId:'codex',exitCode:0,stdout:JSON.stringify({thoughts:[{thoughtNumber:1,totalThoughts:1,thought:'Decide from evidence',kind:'decision',nextThoughtNeeded:false}],summary:'Done',openQuestions:[],refinedSpec:'Implement it'}),stderr:'',timedOut:false,durationMs:5}));
    const receipt=vi.fn(async()=> 'r'); const services={identity:{id:'agon.think',version:'1.0.0',contentHash:`sha256:${'a'.repeat(64)}`},source:'bundled',logger:{debug:vi.fn(),info:vi.fn(),warn:vi.fn()},receipts:{record:receipt},permissions:{check:vi.fn(async()=> 'allow')},state:{read:vi.fn(),write:vi.fn()},engines:{dispatch}} as unknown as ModServices;
    let command:CommandContribution|undefined; const registrar={command:(surface:string,value:CommandContribution)=>{if(surface==='cli')command=value;return()=>{};}} as unknown as Registrar;
    const mod=await createMod(services);await mod.activate(registrar,services); const result=await command!.run({problem:'What next?',json:true},{invocationId:'i',cwd:process.cwd(),platform:'darwin-arm64',signal:new AbortController().signal,config:{}});
    expect(result).toMatchObject({exitCode:0}); const parsed=JSON.parse((result as any).stdout); expect(parsed).toMatchObject({ok:true,summary:'Done',protocolValid:true});
    expect(dispatch).toHaveBeenCalledTimes(1);expect(receipt).toHaveBeenCalledWith('think',expect.objectContaining({protocolValid:true}));
  });
});
