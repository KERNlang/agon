import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';

import { join, resolve } from 'node:path';

import { AGON_HOME, ensureAgonHome } from '../config.js';

import type { Plan } from './plan.js';

export const PLANS_DIR: string = join(AGON_HOME, 'plans');

function ensurePlansDir(): void {
  ensureAgonHome();
  mkdirSync(PLANS_DIR, { recursive: true });
  
}

function safePlanPath(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, '');
  const full = resolve(PLANS_DIR, `${sanitized}.json`);
  if (!full.startsWith(resolve(PLANS_DIR))) throw new Error(`Invalid plan ID: ${id}`);
  return full;
  
}

export function savePlan(plan: Plan): void {
  ensurePlansDir();
  writeFileSync(safePlanPath(plan.id), JSON.stringify(plan, null, 2) + '\n');
  
}

export function loadPlan(id: string): Plan|null {
  try { return JSON.parse(readFileSync(safePlanPath(id), 'utf-8')) as Plan; }
  catch { return null; }
  
}

export function listPlans(limit?: number): Plan[] {
  ensurePlansDir();
  try {
    const files = readdirSync(PLANS_DIR).filter((f: string) => f.endsWith('.json'));
    return files
      .map((f: string) => JSON.parse(readFileSync(join(PLANS_DIR, f), 'utf-8')) as Plan)
      .sort((a: any, b: any) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit ?? 20);
  } catch { return []; }
  
}

export function deletePlan(id: string): boolean {
  try { unlinkSync(safePlanPath(id)); return true; }
  catch { return false; }
  
}

