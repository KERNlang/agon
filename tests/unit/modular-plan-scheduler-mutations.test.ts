import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { createCesarPlan, approveCesarPlan } from '../../packages/core/src/cesar/plan.js';

const source = readFileSync(new URL('../../packages/mod-plan/src/executor.ts', import.meta.url), 'utf8');
function compile(candidate: string): string {
  // Compile the scheduler and its canonical state transitions in memory. No provider, installer,
  // subprocess, personal state or production-file mutation is involved.
  const state = readFileSync(new URL('../../packages/mod-plan/src/execution-state.ts', import.meta.url), 'utf8');
  const combined = state + '\n' + candidate.replace("import { advanceCesarStep } from './execution-state.js';", '');
  const { outputText } = transpileModule(combined, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}

function observesContract(moduleUrl: string, check: string): Promise<boolean> {
  const plan = approveCesarPlan(createCesarPlan('mutation fixture', [{ id: 'one', type: 'self', description: 'one', estimatedTokens: 1, estimatedCostUsd: 0.01 }]));
  // A broken scheduler can spin synchronously. Its own AbortSignal and Vitest's
  // timeout cannot interrupt that loop. Terminate a separate worker instead.
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const { createPlanExecutor } = await import(workerData.moduleUrl);
        const { check, plan } = workerData;
        let executions = 0;
        let warnings = 0;
        const abort = new AbortController();
        if (check === 'abort') abort.abort();
        const result = await createPlanExecutor({
          recordStepCompletion: () => { if (check === 'history') throw new Error('history unavailable'); },
          onEstimationError: () => { throw new Error('reporter unavailable'); }
        })(plan, { self: { execute: async () => {
          executions++;
          return { result: { status: 'success', actualTokens: 10, actualCostUsd: 1, durationMs: 1, output: 'done' } };
        } } }, { onStepStart() {}, onStepDone() {}, onPlanUpdate() {}, onBudgetWarning() { warnings++; } }, abort.signal);
        parentPort.postMessage(check === 'abort' ? executions === 0 && result.state === 'paused'
          : check === 'budget' ? warnings === 1 : executions === 1 && result.state === 'done');
      })().catch(() => parentPort.postMessage(false));
    `, { eval: true, workerData: { moduleUrl, check, plan } });
    const timer = setTimeout(() => { void worker.terminate().then(() => resolve(false), reject); }, 1000);
    worker.once('message', value => { clearTimeout(timer); void worker.terminate().then(() => resolve(value === true), reject); });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

const mutants = [
  { name: 'ignore pre-step cancellation', from: 'if (signal?.aborted) break;', to: '/* mutation: ignore cancellation */', check: 'abort' },
  { name: 'drop ready steps', from: "return plan.steps.filter((s) => s.state === 'pending');", to: 'return [];', check: 'completion' },
  { name: 'suppress budget warning', from: 'callbacks.onBudgetWarning(current.totalActualCostUsd, current.totalEstimatedCostUsd);', to: '/* mutation: suppress warning */', check: 'budget' },
  { name: 'allow history reporter to corrupt completed work', from: 'try { services.onEstimationError?.(stepType, error); } catch { /* reporting only */ }', to: 'services.onEstimationError?.(stepType, error);', check: 'history' },
] as const;

it.each(mutants)('kills implementation mutant: $name', async mutant => {
  expect(source.split(mutant.from)).toHaveLength(2); // exactly one intended mutation site
  const baseline = compile(source);
  const changed = compile(source.replace(mutant.from, mutant.to));
  expect(await observesContract(baseline, mutant.check)).toBe(true);
  // A mutant that throws also violates the required successful completion.
  expect(await observesContract(changed, mutant.check)).toBe(false);
});
