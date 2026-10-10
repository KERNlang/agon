import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';

it('physically owns Plan costing, validation and formatting without a core dependency', () => {
  for (const file of ['cost-estimator', 'step-validation', 'formatter']) {
    const path = new URL('../../packages/mod-plan/src/' + file + '.ts', import.meta.url);
    expect(existsSync(path), file).toBe(true);
    const source = readFileSync(path, 'utf8');
    for (const dependency of ['agon-core', '/core/', '/cli/', '/forge/']) expect(source).not.toContain(dependency);
  }
  expect(existsSync(new URL('../../packages/core/src/cesar/plan-formatter.ts', import.meta.url))).toBe(false);
  const estimator = readFileSync(new URL('../../packages/core/src/cesar/plan-cost-estimator.ts', import.meta.url), 'utf8');
  expect(estimator).not.toContain('this.history');
  expect(existsSync(new URL('../../packages/core/src/cesar/plan-validation.ts', import.meta.url))).toBe(false);
});

it('keeps the legacy parity oracles frozen at db2a8c77', () => {
  const bodies = [
    ['cost', 'export interface CostEstimate', '6adc7e9dee46a2e8955cb780e1d4af8b15413d62639d123b0520bd428d8b4fd7'],
    ['validation', 'export const VALID_STEP_TYPES', '748f089e42ba396a2adadb23b2a76f618f8db1acbd0f13b3b11a44ca7f2ec437'],
    ['formatter', 'export function formatStepType', '90ccd81e294cdeb3f8ad773df13be55e711b3e8dca7193e8dd515a94900c4550'],
  ];
  for (const [name, marker, hash] of bodies) {
    const source = readFileSync(new URL('../fixtures/modular-plan-' + name + '-legacy.ts', import.meta.url), 'utf8');
    expect(source.indexOf(marker)).toBeGreaterThan(0);
    expect(createHash('sha256').update(source.slice(source.indexOf(marker))).digest('hex'), name).toBe(hash);
  }
});
