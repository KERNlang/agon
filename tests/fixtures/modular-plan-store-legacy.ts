// Frozen store oracle from the pre-extraction core Plan store.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, unlinkSync, existsSync } from 'node:fs';

import { join, resolve } from 'node:path';

import { runtimeAgonPath } from '../../packages/core/src/utils/paths.js';

import { createPersistenceEnvelope, unwrapPersistenceEnvelope } from '@kernlang/agon-support-persistence';

/**
 * Canonical directory for Cesar execution plans. Markdown and JSON live together so the user can inspect and edit the exact plan Cesar proposed.
 */
export function getCesarPlansDir(): string {
  return runtimeAgonPath('plans');
}

function safeCesarPlanId(planId: string): string {
  const sanitized = String(planId ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!sanitized) {
    throw new Error(`Invalid plan ID: ${planId}`);
  }
  return sanitized;
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

import type { CesarPlan } from '@kernlang/agon-mod-plan';
export type { CesarPlan, CesarPlanStep, CesarPlanState, CesarStepState, CesarStepType, CesarStepResult } from '@kernlang/agon-mod-plan';
export { CESAR_STEP_TYPES, CESAR_STEP_TYPE_TABLE } from '@kernlang/agon-mod-plan';

/** A20-PLAN-STATE (KL-011): compatibility exports; Plan owns all transitions. */
export { createCesarPlan, approveCesarPlan, advanceCesarStep, cancelCesarPlan, exitCesarPlan } from '@kernlang/agon-mod-plan';

/**
 * Persist a CesarPlan to ~/.agon/plans/<id>.json atomically. Markdown lives beside it as <id>.md so the plan is discoverable and editable. FU-8: write to a .tmp file then renameSync, so concurrent Agon sessions reading the same path observe either the old complete file or the new complete file — never a partial. POSIX rename within the same directory is atomic.
 */
export function saveCesarPlan(plan: CesarPlan): void {
  const dir = getCesarPlansDir();
  mkdirSync(dir, { recursive: true });
  const finalPath = cesarPlanJsonPath(plan.id);
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
      const plan = unwrapPersistenceEnvelope<CesarPlan>(JSON.parse(readFileSync(entry.filePath, 'utf-8')), 'plan');
      const fallbackMarkdownPath = cesarPlanMarkdownPath(plan.id);
      const hasFallback = entry.canonical || existsSync(fallbackMarkdownPath);
      const fallbackPath = hasFallback ? fallbackMarkdownPath : undefined;
      const planFilePath = plan.planFilePath ?? fallbackPath;
      return planFilePath ? { ...plan, planFilePath: planFilePath } : plan;
    } catch (e) {
    }
  }
  return null;
}

/**
 * List persisted CesarPlans from ~/.agon/plans, with legacy ~/.agon/runs fallback.
 */
export function listCesarPlans(): CesarPlan[] {
  const byId = new Map<string, CesarPlan>();
  const readFromDir = (dir: string, canonical: boolean) => {
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f: string) => f.startsWith('cplan-') && f.endsWith('.json'));
    } catch {
      return;
    }
    for (const f of files) {
      try {
        const plan = unwrapPersistenceEnvelope<CesarPlan>(JSON.parse(readFileSync(join(dir, f), 'utf-8')), 'plan');
        if (!plan?.id || byId.has(plan.id)) continue;
        const fallbackMarkdownPath = cesarPlanMarkdownPath(plan.id);
        const planFilePath = plan.planFilePath ?? (canonical || existsSync(fallbackMarkdownPath) ? fallbackMarkdownPath : undefined);
        byId.set(plan.id, planFilePath ? { ...plan, planFilePath } : plan);
      } catch { /* skip malformed plan */ }
    }
  };
  readFromDir(getCesarPlansDir(), true);
  readFromDir(runtimeAgonPath('runs'), false);
  return Array.from(byId.values()).sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
}
