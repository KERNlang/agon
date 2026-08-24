import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, renameSync } from 'node:fs';

import { join, resolve } from 'node:path';

import { homedir } from 'node:os';

import { ensurePersistenceHome } from './paths.js';




function getPlansDir(): string {
  const override = process.env.AGON_HOME?.trim();
  const home = override ? resolve(override) : join(homedir(), '.agon');
  return join(home, 'plans');
}

function ensurePlansDir(): void {
  ensurePersistenceHome();
  mkdirSync(getPlansDir(), { recursive: true });
}

function safePlanPath(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, '');
  const plansDir = getPlansDir();
  const full = resolve(plansDir, `${sanitized}.json`);
  if (!full.startsWith(resolve(plansDir))) {
    throw new Error(`Invalid plan ID: ${id}`);
  }
  return full;
}

export interface PersistedPlan { id: string; updatedAt: string }

export function savePersistedPlan<T extends PersistedPlan>(plan: T): void {
  ensurePlansDir();
  const target = safePlanPath(plan.id);
  const tmpPath = target + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(plan, null, 2) + '\n');
  renameSync(tmpPath, target);
}

export function loadPersistedPlan<T extends PersistedPlan = PersistedPlan>(id: string): T|null {
  try { return JSON.parse(readFileSync(safePlanPath(id), 'utf-8')) as T; }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[agon] failed to load plan ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
}

export function listPersistedPlans<T extends PersistedPlan = PersistedPlan>(limit?: number): T[] {
  ensurePlansDir();
  try {
    const plansDir = getPlansDir();
    const files = readdirSync(plansDir).filter((f: string) => f.endsWith('.json'));
    return files
      .map((f: string) => JSON.parse(readFileSync(join(plansDir, f), 'utf-8')) as T)
      .sort((a: any, b: any) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit ?? 20);
  } catch (err) {
    console.warn(`[agon] failed to list plans: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export function deletePersistedPlan(id: string): boolean {
  try { unlinkSync(safePlanPath(id)); return true; }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[agon] failed to delete plan ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return false;
  }
}
