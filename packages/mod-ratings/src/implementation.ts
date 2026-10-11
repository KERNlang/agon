import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AgonModFactory, CommandResult, Dispose, InvocationContext, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { purgeRatingsStore } from './maintenance.js';
import type { PurgeReport, RatingsMaintenanceStore } from './maintenance.js';

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
const maintenanceStore: RatingsMaintenanceStore<RatingRecord> = {
  path: (...parts) => join(home(), ...parts),
  load: loadRatings,
  save(record) {
    record.lastUpdated = new Date().toISOString();
    mkdirSync(dirname(ratingsPath()), { recursive: true });
    const temporary = ratingsPath() + `.tmp.${process.pid}`;
    writeFileSync(temporary, JSON.stringify(record, null, 2) + '\n');
    renameSync(temporary, ratingsPath());
  },
};

function modPurgeReport(report: PurgeReport, ratingsUnknown: string[], backupDir: string | null) {
  return { dryRun: report.dryRun, keepCount: report.keepCount, ratingsUnknown,
    ratingsRemoved: report.ratingsRemoved, runsScanned: report.runsScanned,
    runsPurged: report.runsPurged.map(({ file, engines }) => ({ file, engines, valid: true })), backupDir };
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
  const targetHome = home();
  if (!services.ratings) return {exitCode:1,stderr:'Ratings purge requires the protected-engine registry host. No data was changed.\n'};
  context.signal.throwIfAborted();
  const protectedIds = await services.ratings.protectedEngineIds(context);
  context.signal.throwIfAborted();
  if (home() !== targetHome) return {exitCode:1,stderr:'Ratings storage root changed during registry lookup. No data was changed. Retry the purge.\n'};
  if (!Array.isArray(protectedIds) || Array.from(protectedIds).some(id => typeof id !== 'string' || !id || id !== id.trim())) {
    return {exitCode:1,stderr:'Protected-engine registry returned invalid IDs. No data was changed.\n'};
  }
  const keep = [...new Set([...protectedIds, ...String(input.keep ?? '').split(',').map((v) => v.trim()).filter(Boolean)])];
  const preview = purgeRatingsStore({ registryIds: keep, dryRun: true }, maintenanceStore).report;
  const apply = input.apply === true && input['dry-run'] !== true;
  if (!apply) {
    const report = modPurgeReport(preview, preview.ratingsUnknown, null);
    return {exitCode:0,stdout:`${JSON.stringify(report,null,2)}\n`,result:report};
  }
  if (await services.permissions.check('fs.write', targetHome) !== 'allow') return {exitCode:1,stderr:'Permission denied: fs.write is required to apply a ratings purge.\n'};
  context.signal.throwIfAborted();
  if (home() !== targetHome) return {exitCode:1,stderr:'Ratings storage root changed during permission checking. No data was changed. Retry the purge.\n'};
  const { report, backupCandidate } = purgeRatingsStore({ registryIds: keep, dryRun: false }, maintenanceStore);
  const result = modPurgeReport(report, preview.ratingsUnknown, backupCandidate);
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
