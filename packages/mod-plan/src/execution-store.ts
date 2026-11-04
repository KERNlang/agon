import { mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, unlinkSync, existsSync, lstatSync } from 'node:fs';

import { join, resolve } from 'node:path';

import { persistencePath as runtimeAgonPath, createPersistenceEnvelope, unwrapPersistenceEnvelope } from '@kernlang/agon-support-persistence';
import type { CesarPlan } from './execution-model.js';

/**
 * Canonical directory for Cesar execution plans. Markdown and JSON live together so the user can inspect and edit the exact plan Cesar proposed.
 */
export function getCesarPlansDir(): string {
  return runtimeAgonPath('plans');
}

function safeCesarPlanId(planId: string): string {
  if (typeof planId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(planId)) {
    throw new Error(`Invalid plan ID: ${planId}`);
  }
  return planId;
}

/**
 * Canonical JSON path for a Cesar plan under ~/.agon/plans.
 */
export function cesarPlanJsonPath(planId: string): string {
  const plansDir = getCesarPlansDir();
  const full = resolve(plansDir, `${safeCesarPlanId(planId)}.json`);
  if (!full.startsWith(resolve(plansDir))) {
    throw new Error(`Invalid plan ID: ${planId}`);
  }
  return full;
}

/**
 * Canonical Markdown path for a Cesar plan under ~/.agon/plans.
 */
export function cesarPlanMarkdownPath(planId: string): string {
  const plansDir = getCesarPlansDir();
  const full = resolve(plansDir, `${safeCesarPlanId(planId)}.md`);
  if (!full.startsWith(resolve(plansDir))) {
    throw new Error(`Invalid plan ID: ${planId}`);
  }
  return full;
}

/**
 * Persist a CesarPlan to ~/.agon/plans/<id>.json atomically. Markdown lives beside it as <id>.md so the plan is discoverable and editable. FU-8: write to a .tmp file then renameSync, so concurrent Agon sessions reading the same path observe either the old complete file or the new complete file — never a partial. POSIX rename within the same directory is atomic.
 */
export function saveCesarPlan(plan: CesarPlan): void {
  const finalPath = cesarPlanJsonPath(plan.id);
  const dir = getCesarPlansDir();
  mkdirSync(dir, { recursive: true });
  const persistedPlan = {
    ...plan,
    planFilePath: plan.planFilePath ?? cesarPlanMarkdownPath(plan.id),
  };
  // Unique tmp suffix so parallel saves of the SAME plan from different
  // sessions don't overwrite each other's tmp file before rename.
  const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    const payload = JSON.parse(JSON.stringify(persistedPlan));
    const status = plan.state === 'planning' ? 'draft' : plan.state === 'awaiting_approval' ? 'approved' : plan.state === 'done' ? 'completed' : plan.state;
    const envelope = createPersistenceEnvelope({ kind: 'plan', status, payload, idSeed: plan.id, ownerModId: 'agon.plan',
      contributionId: 'agon.plan.cesar-plan', createdAt: plan.createdAt, updatedAt: plan.updatedAt ?? plan.createdAt });
    writeFileSync(tmpPath, JSON.stringify(envelope, null, 2));
    renameSync(tmpPath, finalPath);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* tmp may not exist */ }
    throw err;
  }
}

function readPlan(filePath: string, expectedId: string, canonical: boolean): CesarPlan {
  const plan = unwrapPersistenceEnvelope<CesarPlan>(JSON.parse(readFileSync(filePath, 'utf-8')), 'plan');
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || plan.id !== safeCesarPlanId(expectedId)) {
    throw Object.assign(new Error('Plan record identity does not match its filename.'), { code: 'INVALID_RECORD' });
  }
  const markdownPath = cesarPlanMarkdownPath(plan.id);
  const planFilePath = plan.planFilePath ?? (canonical || existsSync(markdownPath) ? markdownPath : undefined);
  return planFilePath ? { ...plan, planFilePath } : plan;
}

function reportReadFailure(canonical: boolean, error: unknown, count = 1): void {
  const code = (error as NodeJS.ErrnoException)?.code ?? 'INVALID_RECORD';
  console.warn(`[plan] Cannot read ${count} ${canonical ? 'canonical' : 'legacy'} plan record(s) (${code}). Saved records remain unchanged.`);
}

/** A dangling symlink is an existing record, not permission to load an old copy. */
function isAbsent(path: string): boolean {
  try { lstatSync(path); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
}

/**
 * Load a persisted CesarPlan from ~/.agon/plans/<id>.json. Falls back to the legacy ~/.agon/runs path for old sessions.
 */
export function loadCesarPlan(planId: string): CesarPlan|null {
  let safeId = '';
  try {
    safeId = safeCesarPlanId(planId);
  } catch (e) {
    return null;
  }
  const paths = [{ filePath: cesarPlanJsonPath(safeId), canonical: true }, { filePath: runtimeAgonPath('runs', `${safeId}.json`), canonical: false }];
  for (const entry of paths) {
    try {
      return readPlan(entry.filePath, safeId, entry.canonical);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' && isAbsent(entry.filePath)
        && (!entry.canonical || existsSync(getCesarPlansDir()) || isAbsent(getCesarPlansDir()))) continue;
      reportReadFailure(entry.canonical, e);
      return null;
    }
  }
  return null;
}

/**
 * List persisted CesarPlans from ~/.agon/plans, with legacy ~/.agon/runs fallback.
 */
export function listCesarPlans(): CesarPlan[] {
  const byId = new Map<string, CesarPlan>();
  const canonicalIds = new Set<string>();
  const readFromDir = (dir: string, canonical: boolean): boolean => {
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f: string) => f.startsWith('cplan-') && f.endsWith('.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && isAbsent(dir)) return true;
      reportReadFailure(canonical, error);
      return false;
    }
    let failures = 0;
    let firstError: unknown;
    for (const f of files) {
      const expectedId = f.slice(0, -'.json'.length);
      if (canonical) canonicalIds.add(expectedId);
      else if (canonicalIds.has(expectedId)) continue;
      try {
        const plan = readPlan(join(dir, f), expectedId, canonical);
        if (!byId.has(plan.id)) byId.set(plan.id, plan);
      } catch (error) {
        failures++;
        firstError ??= error;
      }
    }
    if (failures) reportReadFailure(canonical, firstError, failures);
    return true;
  };
  // An unreadable current index cannot prove which legacy copies are stale.
  if (!readFromDir(getCesarPlansDir(), true)) return [];
  readFromDir(runtimeAgonPath('runs'), false);
  return Array.from(byId.values()).sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
}
