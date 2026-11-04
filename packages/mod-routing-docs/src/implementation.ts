import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AgonModFactory, CommandResult, Dispose, InvocationContext, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { agentGuideMarkdown, agonShim, codexSkillMarkdown, codexSkillOpenAiYaml, modeDocsMarkdown } from './guide-content.js';

const modes = [
  ['ask','agon ask <engine> "<prompt>"','direct engine query'],
  ['think','agon think "<problem>"','decompose and critique'],
  ['brainstorm','agon brainstorm "<question>"','broaden options'],
  ['tribunal','agon tribunal "<decision>"','adversarial tradeoff review'],
  ['forge','agon forge "<task>" -t "<test>"','competing implementations'],
  ['review','agon review uncommitted','independent evidence review'],
  ['goal','agon goal "<intent>" --gate "<test>"','durable task loop'],
  ['room','agon room join <room> --as <name>','multi-session coordination'],
  ['research','agon research "<question>"','cited keyless research'],
  ['chrome','agon chrome "<task>"','drive an attached browser'],
];
const markdown = () => `${agentGuideMarkdown()}\n`;

export async function runGuide(raw:Json,_context:InvocationContext,services:ModServices,install=false):Promise<CommandResult>{
  const input=raw as Record<string,Json>;
  if(!install){const payload=input.json===true?JSON.stringify({modes:modes.map(([name,cmd,use])=>({name,cmd,use}))},null,2)+'\n':input.docs===true?modeDocsMarkdown():markdown();return{exitCode:0,stdout:payload,result:{format:input.json===true?'json':input.docs===true?'docs':'markdown',modeCount:modes.length}};}
  const base = resolve(process.env.HOME || '.');
  const targets = [
    { id: 'codex', directory: '.codex', files: [
      { path: join(base, '.codex/skills/agon/SKILL.md'), content: codexSkillMarkdown() },
      { path: join(base, '.codex/skills/agon/agents/openai.yaml'), content: codexSkillOpenAiYaml() },
    ] },
    { id: 'agy', directory: '.antigravitycli', files: [
      { path: join(base, '.antigravitycli/commands/agon.toml'), content: agonShim('agy') },
    ] },
    { id: 'claude', directory: '.claude', files: [
      { path: join(base, '.claude/commands/agon.md'), content: agonShim('claude') },
    ] },
  ];
  const requested = String(input.cli ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const unknown = requested.filter(id => !targets.some(target => target.id === id));
  const stderr = unknown.length ? `Ignoring unknown CLI "${unknown.join(', ')}" (known: codex, agy, claude).\n` : undefined;
  const selected = targets.filter(target => requested.length ? requested.includes(target.id) : existsSync(join(base, target.directory)));
  const chosen = selected.map(target => target.id);
  const files = selected.flatMap(target => target.files);
  if (!files.length) return { exitCode: 1, stderr: requested.length
    ? `${stderr ?? ''}No known CLI selected (codex, agy, claude).\n`
    : 'No CLI config directories found. Pass --cli codex,agy,claude to select targets explicitly.\n' };
  const plan=files.map((file)=>({path:file.path,action:existsSync(file.path)?input.force===true?'overwrite':'skip':'write'}));
  if(input.dry===true)return{exitCode:0,stderr,stdout:`${JSON.stringify(plan,null,2)}\n`,result:{dryRun:true,plan}};
  for(const file of files){if(existsSync(file.path)&&input.force!==true)continue;if(await services.permissions.check('fs.write',file.path)!=='allow')return{exitCode:1,stderr:`${stderr ?? ''}Permission denied for ${file.path}.\n`};mkdirSync(dirname(file.path),{recursive:true});writeFileSync(file.path,file.content,{flag:input.force===true?'w':'wx'});}
  const receiptId=await services.receipts.record('agent-prompts-installed',{targets:chosen,files:plan});
  return{exitCode:0,stderr,stdout:`${JSON.stringify({installed:plan,receiptId},null,2)}\n`,result:{installed:plan,receiptId}};
}
const guideSchema=Object.freeze({type:'object',additionalProperties:false,properties:{json:{type:'boolean'},docs:{type:'boolean'}}})as Readonly<Record<string,Json>>;
const installSchema=Object.freeze({type:'object',additionalProperties:false,properties:{cli:{type:'string'},force:{type:'boolean'},dry:{type:'boolean'}}})as Readonly<Record<string,Json>>;
const cli=Object.freeze({descriptions: { cli: "Comma list to target: codex,agy,claude. Default: every CLI whose config dir exists.", force: "Overwrite an existing Agon integration file.", dry: "Show what would be written without writing anything.", json: "Emit the mode list as JSON instead of markdown.", docs: "Emit the docs-corpus page (docs/modes.md content) — same guide with a generated-file banner, for RAG indexing." } });
export const createMod:AgonModFactory=services=>Object.freeze({apiVersion:'1'as const,async activate(registrar:Registrar):Promise<Dispose>{const disposers:Dispose[]=[];disposers.push(registrar.command('cli',{id:'cliCommands:0000',description:'Print the compact Agon agent guide',inputSchema:guideSchema,cli,run:(input,context)=>runGuide(input,context,services)}));disposers.push(registrar.command('cli',{id:'cliCommands:0025',description:'Install lightweight Agon prompts into another CLI',inputSchema:installSchema,cli,run:(input,context)=>runGuide(input,context,services,true)}));disposers.push(registrar.docs({id:'generatedDocumentation:0000',title:'Agent routing',markdown:agentGuideMarkdown()}));disposers.push(registrar.docs({id:'generatedDocumentation:0001',title:'Agon modes',markdown:modeDocsMarkdown()}));disposers.push(registrar.docs({id:'generatedDocumentation:0002',title:'Installed agent prompts',markdown:codexSkillMarkdown()}));return async()=>{for(const dispose of[...disposers].reverse())await dispose();};}});export default createMod;
