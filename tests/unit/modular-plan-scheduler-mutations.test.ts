import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { createCesarPlan, approveCesarPlan, advanceCesarStep } from '../../packages/core/src/cesar/plan.js';
import type { createPlanExecutor } from '../../packages/mod-plan/src/executor.js';

const source = readFileSync(new URL('../../packages/mod-plan/src/executor.ts', import.meta.url), 'utf8');
async function compile(candidate: string): Promise<typeof createPlanExecutor> {
  // Compile our own type-only-import scheduler in memory. No provider, installer,
  // subprocess, personal state or production-file mutation is involved.
  const { outputText } = transpileModule(candidate, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } });
  return (await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)).createPlanExecutor;
}

const mutants = [
  { name: 'ignore pre-step cancellation', from: 'if (signal?.aborted) break;', to: '/* mutation: ignore cancellation */', check: 'abort' },
  { name: 'drop ready steps', from: "return plan.steps.filter((s) => s.state === 'pending');", to: 'return [];', check: 'completion' },
  { name: 'suppress budget warning', from: 'callbacks.onBudgetWarning(current.totalActualCostUsd, current.totalEstimatedCostUsd);', to: '/* mutation: suppress warning */', check: 'budget' },
] as const;

it.each(mutants)('kills implementation mutant: $name', async mutant => {
  expect(source.split(mutant.from)).toHaveLength(2); // exactly one intended mutation site
  const baseline = await compile(source);
  const changed = await compile(source.replace(mutant.from, mutant.to));
  async function observesContract(factory: typeof createPlanExecutor) {
    let executions = 0;
    let warnings = 0;
    const abort = new AbortController();
    if (mutant.check === 'abort') abort.abort();
    const plan = approveCesarPlan(createCesarPlan('mutation fixture', [{ id: 'one', type: 'self', description: 'one', estimatedTokens: 1, estimatedCostUsd: 0.01 }]));
    const result = await factory({ advance: advanceCesarStep, recordStepCompletion: () => {} })(plan,
      { self: { execute: async () => { executions++; return { result: { status: 'success', actualTokens: 10, actualCostUsd: 1, durationMs: 1, output: 'done' } }; } } },
      { onStepStart: () => {}, onStepDone: () => {}, onPlanUpdate: () => {}, onBudgetWarning: () => { warnings++; } }, abort.signal);
    if (mutant.check === 'abort') return executions === 0 && result.state === 'paused';
    if (mutant.check === 'completion') return executions === 1 && result.state === 'done';
    return warnings === 1;
  }
  expect(await observesContract(baseline)).toBe(true);
  expect(await observesContract(changed)).toBe(false);
});
