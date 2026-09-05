import { expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as physical from '../../packages/mod-plan/src/index.js';
import * as frozen from '../fixtures/modular-plan-store-legacy.js';

it('Plan owns storage and preserves saved bytes, readers and malformed-file isolation', () => {
  expect(physical).toHaveProperty('saveCesarPlan');
  const source = readFileSync(new URL('../../packages/core/src/cesar/plan.ts', import.meta.url), 'utf8');
  expect(source).not.toContain('node:fs');
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
