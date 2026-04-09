// @kern-source: flow:1
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';

// @kern-source: flow:2
import { join } from 'node:path';

// @kern-source: flow:3
import { AGON_HOME } from './config.js';

// @kern-source: flow:5
export const FLOWS_DIR: string = join(AGON_HOME, 'flows');

// @kern-source: flow:10
export const FRICTION_TAGS: readonly string[] = ['slow', 'wrong-mode', 'engine-error', 'unclear-output', 'timeout', 'context-lost', 'other'] as const;

// @kern-source: flow:15
export interface FlowTelemetry {
  engines: string[];
  durationMs: number;
  tokensByEngine: Record<string, {prompt:number, response:number}>;
  touchedFileCount?: number;
}

// @kern-source: flow:21
export interface FlowFeedback {
  satisfactionRating: number;
  goalMet: 'yes'|'no'|'partly';
  needsFollowup: boolean;
  frictionTags: string[];
  notes?: string;
}

// @kern-source: flow:28
export interface FlowModeMeta {
  forgeId?: string;
  winnerEngine?: string;
  brainstormWinner?: string;
  tribunalVerdict?: string;
  taskType?: string;
  orchestrationPath?: string;
  leadEngine?: string;
  observerEngines?: string[];
  scoutCount?: number;
  cesarConfidence?: number;
}

// @kern-source: flow:40
export interface FlowRecord {
  id: string;
  schemaVersion: 1;
  mode: 'forge'|'brainstorm'|'tribunal'|'campfire'|'chat'|'build'|'cesar'|'pipeline';
  startedAt: string;
  endedAt: string;
  completionState: 'completed'|'aborted'|'crashed';
  captureMethod: 'auto'|'manual';
  telemetry: FlowTelemetry;
  feedback?: FlowFeedback;
  modeMeta?: FlowModeMeta;
}

// @kern-source: flow:52
function ensureFlowsDir(): void {
  mkdirSync(FLOWS_DIR, { recursive: true });
}

// @kern-source: flow:57
export function logFlow(record: FlowRecord): string {
  ensureFlowsDir();
  const filename = `flow-${record.id}.json`;
  const filepath = join(FLOWS_DIR, filename);
  writeFileSync(filepath, JSON.stringify(record, null, 2));
  return filepath;
}

// @kern-source: flow:66
export function readFlows(limit?: number): FlowRecord[] {
  ensureFlowsDir();
  let files: string[];
  try {
    files = readdirSync(FLOWS_DIR)
      .filter((f: string) => f.startsWith('flow-') && f.endsWith('.json'))
      .sort()
      .reverse();
  } catch (err) {
    console.warn(`[agon] failed to read flows directory: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
  
  if (limit) files = files.slice(0, limit);
  
  const records: FlowRecord[] = [];
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(FLOWS_DIR, file), 'utf-8')) as FlowRecord;
      records.push(data);
    } catch (err) {
      console.warn(`[agon] skipping malformed flow record ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return records;
}

// @kern-source: flow:94
export interface ModeStats {
  mode: string;
  count: number;
  avgSatisfaction: number|null;
  completedRate: number;
  avgDurationMs: number;
  avgTokens: number;
  followupRate: number;
}

// @kern-source: flow:103
export interface FlowAnalysis {
  totalFlows: number;
  byMode: ModeStats[];
  topFriction: {tag:string, count:number}[];
  periodDays: number;
}

// @kern-source: flow:109
export function analyzeFlows(days?: number): FlowAnalysis {
  const periodDays = days ?? 30;
  const cutoff = new Date(Date.now() - periodDays * 86400_000).toISOString();
  const all = readFlows();
  const recent = all.filter((r) => r.startedAt >= cutoff);
  
  const modeMap = new Map<string, FlowRecord[]>();
  for (const r of recent) {
    const list = modeMap.get(r.mode) ?? [];
    list.push(r);
    modeMap.set(r.mode, list);
  }
  
  const byMode: ModeStats[] = [];
  for (const [mode, records] of modeMap) {
    const withFeedback = records.filter((r) => r.feedback);
    const ratings = withFeedback.map((r) => r.feedback!.satisfactionRating);
    const avgSatisfaction = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
    const completed = records.filter((r) => r.completionState === 'completed').length;
    const totalDuration = records.reduce((sum, r) => sum + r.telemetry.durationMs, 0);
    const totalTokens = records.reduce((sum, r) => {
      return sum + Object.values(r.telemetry.tokensByEngine).reduce((s, e) => s + e.prompt + e.response, 0);
    }, 0);
    const followups = withFeedback.filter((r) => r.feedback!.needsFollowup).length;
  
    byMode.push({
      mode,
      count: records.length,
      avgSatisfaction: avgSatisfaction !== null ? Math.round(avgSatisfaction * 10) / 10 : null,
      completedRate: Math.round((completed / records.length) * 100),
      avgDurationMs: Math.round(totalDuration / records.length),
      avgTokens: Math.round(totalTokens / records.length),
      followupRate: withFeedback.length > 0 ? Math.round((followups / withFeedback.length) * 100) : 0,
    });
  }
  byMode.sort((a, b) => b.count - a.count);
  
  const frictionCounts = new Map<string, number>();
  for (const r of recent) {
    if (r.feedback?.frictionTags) {
      for (const tag of r.feedback.frictionTags) {
        frictionCounts.set(tag, (frictionCounts.get(tag) ?? 0) + 1);
      }
    }
  }
  const topFriction = [...frictionCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  
  return { totalFlows: recent.length, byMode, topFriction, periodDays };
}

