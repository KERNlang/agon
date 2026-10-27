import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AgonModFactory, CommandResult, Dispose, InvocationContext, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { buildForgeProvenance, renderProvenanceMarkdown as renderMarkdown } from './reports.js';
import type { ProvenanceLedger, ProvenanceManifest } from './models.js';

const home = () => resolve(process.env.AGON_HOME?.trim() || resolve(process.env.HOME || '.', '.agon'));
const runs = () => join(home(), 'runs');
const hash = (path:string) => `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function buildProvenance(manifest: ProvenanceManifest, path: string): ProvenanceLedger {
  // The physical command requires a readable source hash; legacy callers may report unavailable.
  const ledger = buildForgeProvenance(manifest, path, hash);
  return { ...ledger, contributions: ledger.contributions.map(defined) };
}

export { renderMarkdown };
function pick(id:string):{file:string}|{error:string} {
  let files:string[];
  try { files = readdirSync(runs()).filter((file)=>file.endsWith('.json')).sort().reverse(); } catch { return {error:'No forge runs yet.'}; }
  if (!files.length) return {error:'No forge runs yet.'};
  if (!id) return {file:files[0]};
  const prefix = files.filter((file)=>file.startsWith(id)), matches = prefix.length ? prefix : files.filter((file)=>file.includes(id));
  if (!matches.length) return {error:`Run "${id}" not found`};
  if (matches.length > 1) return {error:`Run prefix "${id}" is ambiguous`};
  return {file:matches[0]};
}
export async function runProvenance(raw:Json, _context:InvocationContext, services:ModServices):Promise<CommandResult> {
  const input = raw as Record<string,Json>, id = String(input.id ?? (Array.isArray(input._) ? input._[0] : '')).trim(), format = String(input.format ?? 'md').toLowerCase();
  if (!['md','json','both'].includes(format)) return {exitCode:1,stderr:'Unknown format. Use md, json, or both.\n'};
  const selected = pick(id); if ('error' in selected) return {exitCode:1,stderr:selected.error+'\n'};
  const manifestPath = join(runs(),selected.file); let manifest:any;
  try { manifest = JSON.parse(readFileSync(manifestPath,'utf8')); } catch (error) { return {exitCode:1,stderr:`Could not read run: ${String(error)}\n`}; }
  if (typeof manifest.forgeId !== 'string' || typeof manifest.task !== 'string') return {exitCode:1,stderr:'Run is not a valid forge manifest.\n'};
  const ledger = buildProvenance(manifest,manifestPath), markdown = renderMarkdown(ledger), json = JSON.stringify(ledger,null,2);
  const payload = format === 'json' ? json : format === 'both' ? `${markdown}\n\n--- JSON LEDGER ---\n\n${json}\n` : markdown;
  const out = typeof input.out === 'string' ? resolve(input.out) : '';
  if (out) {
    if (await services.permissions.check('fs.write',out) !== 'allow') return {exitCode:1,stderr:'Permission denied: fs.write is required.\n'};
    mkdirSync(dirname(out),{recursive:true}); const temporary = `${out}.tmp.${process.pid}`; writeFileSync(temporary,payload); renameSync(temporary,out);
  }
  const receiptId = await services.receipts.record('provenance-read',{runId:manifest.forgeId,sourceHash:ledger.sourceHashes['manifest.json'],format,written:out || null});
  const result = JSON.parse(JSON.stringify({ledger,format,out:out || null,receiptId})) as Json;
  return {exitCode:0,stdout:out?`Provenance report written to ${out}\n`:`${payload}\n`,result};
}
const schema = Object.freeze({type:'object',additionalProperties:false,properties:{id:{type:'string'},format:{type:'string',default:'md'},out:{type:'string'},_:{type:'array',items:{type:'string'}}}}) as Readonly<Record<string,Json>>;
const cli = Object.freeze({aliases:{format:'f',out:'o'}});
export const createMod:AgonModFactory = (services) => Object.freeze({apiVersion:'1' as const,async activate(registrar:Registrar):Promise<Dispose>{
  const disposers:Dispose[] = [], contribution = {id:'cliCommands:0057',description:'AI-contribution / transparency report for a forge run',inputSchema:schema,cli,run:(input:Json,context:InvocationContext)=>runProvenance(input,context,services)};
  disposers.push(registrar.command('cli',contribution)); disposers.push(registrar.command('tui',{...contribution,id:'builtinCommandMetadata:0037'}));
  return async()=>{for(const dispose of [...disposers].reverse())await dispose();};
}});
export default createMod;
