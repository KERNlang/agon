import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';

import { join } from 'node:path';

import { AGON_HOME } from './config.js';

import type { TaskClass } from './types.js';

export interface EngineNote {
  taskClass: TaskClass;
  observation: string;
  timestamp: string;
  forgeId?: string;
}

export interface EngineProfile {
  strengths: string[];
  weaknesses: string[];
  tendencies: string[];
  notes: EngineNote[];
}

export interface EngineMemoryRecord {
  engines: Record<string,EngineProfile>;
  lastUpdated: string;
}

export const MEMORY_PATH: string = join(AGON_HOME, 'engine-memory.json');

export function loadEngineMemory(): EngineMemoryRecord {
  try { return JSON.parse(readFileSync(MEMORY_PATH, 'utf-8')) as EngineMemoryRecord; }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[agon] failed to load engine memory: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { engines: {}, lastUpdated: new Date().toISOString() };
  }
}

function saveEngineMemory(record: EngineMemoryRecord): void {
  mkdirSync(AGON_HOME, { recursive: true });
  record.lastUpdated = new Date().toISOString();
  const tmpPath = MEMORY_PATH + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(record, null, 2) + '\n');
  renameSync(tmpPath, MEMORY_PATH);
}

function ensureProfile(record: EngineMemoryRecord, engineId: string): EngineProfile {
  if (!record.engines[engineId]) {
    record.engines[engineId] = { strengths: [], weaknesses: [], tendencies: [], notes: [] };
  }
  return record.engines[engineId];
}

export function addEngineNote(engineId: string, taskClass: TaskClass, observation: string, forgeId?: string): void {
  const record = loadEngineMemory();
  const profile = ensureProfile(record, engineId);
  profile.notes.push({
    taskClass,
    observation,
    timestamp: new Date().toISOString(),
    forgeId,
  });
  // Keep only last 50 notes per engine
  if (profile.notes.length > 50) {
    profile.notes = profile.notes.slice(-50);
  }
  saveEngineMemory(record);
}

export function setEngineStrengths(engineId: string, strengths: string[]): void {
  const record = loadEngineMemory();
  const profile = ensureProfile(record, engineId);
  profile.strengths = strengths;
  saveEngineMemory(record);
}

export function setEngineWeaknesses(engineId: string, weaknesses: string[]): void {
  const record = loadEngineMemory();
  const profile = ensureProfile(record, engineId);
  profile.weaknesses = weaknesses;
  saveEngineMemory(record);
}

export function addEngineTendency(engineId: string, tendency: string): void {
  const record = loadEngineMemory();
  const profile = ensureProfile(record, engineId);
  if (!profile.tendencies.includes(tendency)) {
    profile.tendencies.push(tendency);
    if (profile.tendencies.length > 10) profile.tendencies = profile.tendencies.slice(-10);
  }
  saveEngineMemory(record);
}

export function getEngineProfile(engineId: string): EngineProfile|null {
  const record = loadEngineMemory();
  return record.engines[engineId] ?? null;
}

export function buildRolePrompt(engineId: string, taskClass: TaskClass): string {
  const profile = getEngineProfile(engineId);
  if (!profile) return '';
  
  const parts: string[] = [];
  
  if (profile.strengths.length > 0) {
    parts.push(`Your known strengths: ${profile.strengths.join(', ')}.`);
  }
  if (profile.weaknesses.length > 0) {
    parts.push(`Watch out for: ${profile.weaknesses.join(', ')}.`);
  }
  
  // Recent notes for this task class
  const classNotes = profile.notes
    .filter((n) => n.taskClass === taskClass)
    .slice(-3)
    .map((n) => n.observation);
  if (classNotes.length > 0) {
    parts.push(`Recent observations on ${taskClass} tasks: ${classNotes.join('; ')}.`);
  }
  
  if (profile.tendencies.length > 0) {
    parts.push(`Known tendencies: ${profile.tendencies.join(', ')}.`);
  }
  
  return parts.length > 0
    ? `\n## YOUR PROFILE (based on past performance)\n${parts.join('\n')}`
    : '';
}

export function recordForgeOutcome(winnerId: string, loserIds: string[], taskClass: TaskClass, forgeId: string, winnerScore: number, loserScores: Record<string,number>): void {
  // Auto-populate notes from forge outcomes
  addEngineNote(winnerId, taskClass, `Won ${taskClass} forge (score ${winnerScore})`, forgeId);
  for (const loserId of loserIds) {
    const score = loserScores[loserId] ?? 0;
    if (score === 0) {
      addEngineNote(loserId, taskClass, `Failed ${taskClass} forge (did not pass fitness)`, forgeId);
    } else {
      addEngineNote(loserId, taskClass, `Lost ${taskClass} forge (score ${score} vs winner ${winnerScore})`, forgeId);
    }
  }
}

