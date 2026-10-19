import { expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as physical from '../../packages/mod-plan/src/index.js';
import * as frozen from '../fixtures/modular-plan-store-legacy.js';
import { savePersistedPlan, loadPersistedPlan } from '../../packages/support-persistence/src/plan-store.js';

it.each([
  ['draft', 'draft'], ['approved', 'approved'], ['running', 'running'],
  ['paused', 'paused'], ['completed', 'completed'], ['failed', 'failed'],
  ['cancelled', 'cancelled'], ['awaiting_approval', 'approved'], ['done', 'completed'],
])('persists Plan state %s with envelope status %s', (state, expected) => {
  const home = mkdtempSync(join(tmpdir(), 'agon-plan-envelope-'));
  vi.stubEnv('AGON_HOME', home);
  try {
    const plan = { id: 'plan-status', state, updatedAt: '2026-10-19T00:00:00.000Z' };
    savePersistedPlan(plan);
    const raw = JSON.parse(readFileSync(join(home, 'plans', 'plan-status.json'), 'utf8'));
    expect(raw.status).toBe(expected);
    expect(raw.payload).toEqual(plan);
    expect(loadPersistedPlan(plan.id)).toEqual(plan);
  } finally { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); }
});

it('Plan owns storage and preserves saved bytes, readers and malformed-file isolation', () => {
  expect(physical).toHaveProperty('saveCesarPlan');
  expect(existsSync(new URL('../../packages/core/src/cesar/plan.ts', import.meta.url))).toBe(false);
  const home = mkdtempSync(join(tmpdir(), 'agon-plan-store-owner-'));
  vi.stubEnv('AGON_HOME', home);
  try {
    const plan = { ...physical.createCesarPlan('fixture', []), id: 'cplan-fixture', planFilePath: '/fixture/plan.md' };
    frozen.saveCesarPlan(plan);
    const path = frozen.cesarPlanJsonPath(plan.id);
    const bytes = readFileSync(path, 'utf8');
    const loaded = frozen.loadCesarPlan(plan.id);
    physical.saveCesarPlan(plan);
    expect(readFileSync(path, 'utf8')).toBe(bytes);
    expect(physical.loadCesarPlan(plan.id)).toEqual(loaded);
    expect(physical.cesarPlanMarkdownPath(plan.id)).toBe(frozen.cesarPlanMarkdownPath(plan.id));
    writeFileSync(join(home, 'plans', 'cplan-malformed.json'), '{broken');
    expect(physical.listCesarPlans()).toEqual(frozen.listCesarPlans());
    expect(physical.listCesarPlans()).toHaveLength(1);
    expect(physical.loadCesarPlan('missing')).toBeNull();
  } finally { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); }
});
