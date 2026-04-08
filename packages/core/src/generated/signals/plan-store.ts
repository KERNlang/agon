// @kern-source: plan-store:1
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, renameSync } from 'node:fs';

// @kern-source: plan-store:2
import { join, resolve } from 'node:path';

// @kern-source: plan-store:3
import { AGON_HOME, ensureAgonHome } from './config.js';

// @kern-source: plan-store:4
import type { Plan } from '../blocks/plan.js';

// @kern-source: plan-store:6
export const PLANS_DIR: string = join(AGON_HOME, 'plans');

// @kern-source: plan-store:11
function ensurePlansDir(): void {
  ensureAgonHome();
  mkdirSync(PLANS_DIR, { recursive: true });
}

// @kern-source: plan-store:17
function safePlanPath(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, '');
  const full = resolve(PLANS_DIR, `${sanitized}.json`);
  if (!full.startsWith(resolve(PLANS_DIR))) throw new Error(`Invalid plan ID: ${id}`);
  return full;
}

// @kern-source: plan-store:25
export function savePlan(plan: Plan): void {
  ensurePlansDir();
  const target = safePlanPath(plan.id);
  const tmpPath = target + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(plan, null, 2) + '\n');
  renameSync(tmpPath, target);
}

// @kern-source: plan-store:34
export function loadPlan(id: string): Plan|null {
  try { return JSON.parse(readFileSync(safePlanPath(id), 'utf-8')) as Plan; }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[agon] failed to load plan ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
}

// @kern-source: plan-store:45
export function listPlans(limit?: number): Plan[] {
  ensurePlansDir();
  try {
    const files = readdirSync(PLANS_DIR).filter((f: string) => f.endsWith('.json'));
    return files
      .map((f: string) => JSON.parse(readFileSync(join(PLANS_DIR, f), 'utf-8')) as Plan)
      .sort((a: any, b: any) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit ?? 20);
  } catch (err) {
    console.warn(`[agon] failed to list plans: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// @kern-source: plan-store:60
export function deletePlan(id: string): boolean {
  try { unlinkSync(safePlanPath(id)); return true; }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[agon] failed to delete plan ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return false;
  }
}

