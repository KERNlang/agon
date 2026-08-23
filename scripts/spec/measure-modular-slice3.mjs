import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import {
  createFirstPartyModCatalog,
  createFullCompatDesiredState,
  createModManagementView,
  planDesiredStateChange,
} from '../../packages/mod-kernel/dist/index.js';

const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const catalog = createFirstPartyModCatalog();
const state = createFullCompatDesiredState(catalog, '2026-08-23T20:00:00.000Z');
const samples = { planMs: [], viewMs: [] };
for (let index = 0; index < 2000; index += 1) {
  let start = performance.now();
  planDesiredStateChange(catalog, state, { kind: 'disable', id: 'agon.think' }, '2026-08-23T20:00:01.000Z');
  samples.planMs.push(performance.now() - start);
  start = performance.now();
  createModManagementView(catalog, state);
  samples.viewMs.push(performance.now() - start);
}
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const result = {
  schemaVersion: 1,
  platform: { platform: process.platform, arch: process.arch, node: process.version },
  iterations: 2000,
  plan: { p50Ms: percentile(samples.planMs, 0.5), p95Ms: percentile(samples.planMs, 0.95) },
  groupedView: { p50Ms: percentile(samples.viewMs, 0.5), p95Ms: percentile(samples.viewMs, 0.95) },
  budgets: { planP95Ms: 5, groupedViewP95Ms: 5 },
};
result.budgets.planGreen = result.plan.p95Ms <= result.budgets.planP95Ms;
result.budgets.groupedViewGreen = result.groupedView.p95Ms <= result.budgets.groupedViewP95Ms;
if (!process.argv.includes('--check')) {
  writeFileSync(`${root}/docs/specs/evidence/modular-agon-slice3-performance.json`, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify(result, null, 2));
if (!result.budgets.planGreen || !result.budgets.groupedViewGreen) process.exitCode = 1;
