import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AgonModFactory, CommandResult, Dispose, InvocationContext, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { withFileLock } from '@kernlang/agon-support-persistence';

export interface GlickoRating { mu:number; phi:number; sigma:number; wins:number; losses:number; lastActive:string }
export interface RatingRecord {
  global:Record<string,GlickoRating>;
  byMode:Record<string,Record<string,GlickoRating>>;
  byTaskClass:Record<string,Record<string,GlickoRating>>;
  engineMeta:Record<string,{ derivedFrom?:string|null; versions?:string[]; [key:string]:Json|undefined }>;
  lastUpdated:string;
}
const home = () => resolve(process.env.AGON_HOME?.trim() || resolve(process.env.HOME || '.', '.agon'));
const ratingsPath = () => join(home(), 'ratings.json');
const empty = ():RatingRecord => ({ global:{}, byMode:{forge:{},brainstorm:{},tribunal:{},critique:{}}, byTaskClass:{}, engineMeta:{}, lastUpdated:new Date().toISOString() });

export function loadRatings():RatingRecord {
  try {
    const record = JSON.parse(readFileSync(ratingsPath(), 'utf8')) as RatingRecord;
    record.global ??= {}; record.byMode ??= {};
    for (const mode of ['forge','brainstorm','tribunal','critique']) record.byMode[mode] ??= {};
    record.byTaskClass ??= {}; record.engineMeta ??= {};
    return record;
  } catch { return empty(); }
}
function ratedIds(record:RatingRecord):string[] {
  const ids = new Set([...Object.keys(record.global), ...Object.keys(record.engineMeta)]);
  for (const scope of [...Object.values(record.byMode), ...Object.values(record.byTaskClass)]) for (const id of Object.keys(scope)) ids.add(id);
  return [...ids].sort();
}
export function computeUnknownEngineIds(record:RatingRecord, keep:string[]):string[] {
  const allowed = new Set(keep); return ratedIds(record).filter((id) => !allowed.has(id));
}
function prune(record:RatingRecord, ids:string[]):string[] {
  const remove = new Set(ids), removed = new Set<string>();
  for (const bag of [record.global, record.engineMeta, ...Object.values(record.byMode), ...Object.values(record.byTaskClass)]) {
    for (const id of Object.keys(bag)) if (remove.has(id)) { delete bag[id]; removed.add(id); }
  }
  for (const meta of Object.values(record.engineMeta)) {
    if (meta.derivedFrom && remove.has(meta.derivedFrom)) meta.derivedFrom = null;
    if (Array.isArray(meta.versions)) meta.versions = meta.versions.filter((id) => !remove.has(id));
  }
  return [...removed].sort();
}
function manifests():Array<{file:string;engines:string[];valid:boolean}> {
  const directory = join(home(), 'runs');
  try {
    return readdirSync(directory).filter((file) => file.endsWith('.json')).map((file) => {
      try {
        const manifest = JSON.parse(readFileSync(join(directory, file), 'utf8'));
        return { file, engines:Array.isArray(manifest.engines) ? manifest.engines.filter((v:unknown):v is string => typeof v === 'string') : [], valid:Array.isArray(manifest.engines) };
      } catch { return { file, engines:[], valid:false }; }
    });
  } catch { return []; }
}
function leaderboard(record:RatingRecord, input:Record<string,Json>) {
  const mode = typeof input.mode === 'string' ? input.mode : '', task = typeof input.taskClass === 'string' ? input.taskClass : '';
  const scope = task ? record.byTaskClass[task] ?? {} : mode ? record.byMode[mode] ?? {} : record.global;
  return Object.entries(scope).map(([engine,rating]) => ({
    engine, rating:rating.mu, uncertainty:Math.round(rating.phi), floor:Math.round(rating.mu - 2 * rating.phi),
    wins:rating.wins, losses:rating.losses, matches:rating.wins + rating.losses,
    winPercent:rating.wins + rating.losses ? Math.round(rating.wins / (rating.wins + rating.losses) * 100) : 0,
    provisional:rating.wins + rating.losses < 30,
  })).sort((a,b) => b.floor - a.floor || a.engine.localeCompare(b.engine));
}
export async function runRatings(raw:Json, context:InvocationContext, services:ModServices, forceLeaderboard=false):Promise<CommandResult> {
  const input = raw as Record<string,Json>;
  const action = forceLeaderboard ? 'leaderboard' : String(input.action ?? (Array.isArray(input._) ? input._[0] : 'leaderboard'));
  if (action === 'leaderboard') {
    const rows = leaderboard(loadRatings(), input), receiptId = await services.receipts.record('ratings-read', {count:rows.length});
    return { exitCode:0, stdout:`${JSON.stringify({ratings:rows,receiptId},null,2)}\n`, result:{ratings:rows,receiptId} };
  }
  if (action !== 'purge-unknown' && action !== 'purge') return {exitCode:1,stderr:'Use leaderboard or purge-unknown.\n'};
  const keep = [...new Set([...(await services.engines.listActive?.(context) ?? []), ...String(input.keep ?? '').split(',').map((v) => v.trim()).filter(Boolean)])];
  const record = loadRatings(), unknown = computeUnknownEngineIds(record, keep), runs = manifests();
  const purgeRuns = runs.filter((run) => run.valid && !run.engines.some((engine) => keep.includes(engine)));
  const apply = input.apply === true && input['dry-run'] !== true;
  if (!apply) {
    const report = {dryRun:true,keepCount:keep.length,ratingsUnknown:unknown,ratingsRemoved:[],runsScanned:runs.length,runsPurged:purgeRuns,backupDir:null};
    return {exitCode:0,stdout:`${JSON.stringify(report,null,2)}\n`,result:report};
  }
  if (await services.permissions.check('fs.write', home()) !== 'allow') return {exitCode:1,stderr:'Permission denied: fs.write is required to apply a ratings purge.\n'};
  const stamp = new Date().toISOString().replace(/[:.]/g,'-'), backup = join(home(), `purge-backup-${stamp}`);
  let removed:string[] = [];
  withFileLock(ratingsPath() + '.lock', () => {
    const current = loadRatings(), now = computeUnknownEngineIds(current, keep);
    if (!now.length || !existsSync(ratingsPath())) return;
    mkdirSync(backup,{recursive:true}); copyFileSync(ratingsPath(),join(backup,'ratings.json'));
    removed = prune(current,now); current.lastUpdated = new Date().toISOString(); mkdirSync(dirname(ratingsPath()),{recursive:true});
    const temporary = ratingsPath() + `.tmp.${process.pid}`; writeFileSync(temporary,JSON.stringify(current,null,2)+'\n'); renameSync(temporary,ratingsPath());
  });
  if (purgeRuns.length) {
    const destination = join(backup,'runs'); mkdirSync(destination,{recursive:true});
    for (const run of purgeRuns) try { renameSync(join(home(),'runs',run.file),join(destination,run.file)); } catch { /* vanished concurrently */ }
  }
  const result = {dryRun:false,keepCount:keep.length,ratingsUnknown:unknown,ratingsRemoved:removed,runsScanned:runs.length,runsPurged:purgeRuns,backupDir:backup};
  const receiptId = await services.receipts.record('ratings-purge', result);
  return {exitCode:0,stdout:`${JSON.stringify({...result,receiptId},null,2)}\n`,result:{...result,receiptId}};
}
const parentSchema = Object.freeze({type:'object',additionalProperties:false,properties:{}}) as Readonly<Record<string,Json>>;
const leaderboardSchema = Object.freeze({type:'object',additionalProperties:false,properties:{taskClass:{type:'string'},mode:{type:'string'}}}) as Readonly<Record<string,Json>>;
const purgeSchema = Object.freeze({type:'object',additionalProperties:false,properties:{apply:{type:'boolean',default:false},'dry-run':{type:'boolean',default:false},keep:{type:'string'}}}) as Readonly<Record<string,Json>>;
const leaderboardCli = Object.freeze({aliases:{taskClass:'c',mode:'m'}});
const cli = Object.freeze({});
export const createMod:AgonModFactory = (services) => Object.freeze({apiVersion:'1' as const, async activate(registrar:Registrar):Promise<Dispose> {
  const disposers:Dispose[] = [];
  disposers.push(registrar.command('cli',{id:'cliCommands:0034',description:'Show engine leaderboard (Glicko-2 ratings)',inputSchema:leaderboardSchema,cli:leaderboardCli,run:(i,c)=>runRatings(i,c,services,true)}));
  disposers.push(registrar.command('cli',{id:'cliCommands:0060',description:'Maintain ratings',inputSchema:parentSchema,cli,run:(i,c)=>runRatings(i,c,services)}));
  disposers.push(registrar.command('cli',{id:'cliCommands:0061',description:'Preview or apply purge of unknown engines',inputSchema:purgeSchema,cli,run:(i,c)=>runRatings({...i as object,action:'purge-unknown'},c,services)}));
  for (const id of ['intentVariants:0039','builtinCommandMetadata:0030','tuiSlashCommands:0041']) {
    const contribution = {id,description:'Show engine leaderboard',inputSchema:leaderboardSchema,run:(i:Json,c:InvocationContext)=>runRatings(i,c,services,true)};
    if (id.startsWith('intent')) disposers.push(registrar.intent({...contribution,parse: (value) => /^\/(?:leaderboard|elo)(?:\s|$)/i.test(value) ? {} : undefined}));
    else disposers.push(registrar.command('tui',contribution));
  }
  disposers.push(registrar.resultType({id:'resultAndEnvelopeTypes:0105',schema:{type:'object',additionalProperties:true},readableVersions:'>=1',render:async (payload)=>({text:JSON.stringify(payload,null,2)})}));
  return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
}});
export default createMod;
