import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import * as plan from '@kernlang/agon-mod-plan';

const source = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

it('exports the session scope from the physical Plan package', () => {
  expect(plan).toHaveProperty('withPlanSession', expect.any(Function));
  expect(plan).toHaveProperty('planSessionHost.run', expect.any(Function));
  expect(plan).toHaveProperty('dispatchPlanSession', expect.any(Function));
  expect(plan).toHaveProperty('createPlanSessionActions', expect.any(Function));
  expect(plan).toHaveProperty('createPlanExecutionSession', expect.any(Function));
  expect(plan).toHaveProperty('dispatchPlanNaturalInput', expect.any(Function));
  expect(plan).toHaveProperty('shouldEmitPlanPostDispatch', expect.any(Function));
});

it('binds physical and legacy-shaped requests to one Plan dispatcher', () => {
  const content = source('packages/cli/src/signals/dispatch/intent-session.ts');
  expect(content).not.toMatch(/dispatchSessionInfoIntent\(request,/);
  expect(content).toContain('dispatchPlanSession(request,');
  expect(content).toContain('return runInteractivePlanRequest(intent, input, cb)');
  expect(content).not.toContain('await runInteractivePlanRequest(request,');
  expect(content).toContain('actions: interactivePlanActions(cb)');
  expect(content).toContain('createPlanSessionActions(');
  expect(content).toContain('createPlanExecutionSession(cb)');
  expect(content).not.toContain("from './plan-execution.js'");
  expect(content).toContain('shouldEmitPlanPostDispatch(request, result)');
  expect(content).not.toMatch(/\bhandle(?:PlanShow|PlansList|Approve|Retry|Cancel)\b/);
});

it('keeps natural-input ordering in the physical session owner', () => {
  const router = source('packages/cli/src/signals/dispatch/intent-router.ts');
  expect(router).toContain('dispatchPlanNaturalInput(input,');
  expect(router).not.toContain("from './plan-execution.js'");
  expect(router).not.toContain('isCesarPlanResumeInput');
  expect(router).not.toContain('shouldApprovePendingCesarPlanInput');
});

it('binds Cesar proposals and session resume without legacy execution adapters', () => {
  const cesar = source('packages/cli/src/signals/dispatch/cesar-router.ts');
  expect(cesar).not.toContain("from './plan-execution.js'");
  expect(cesar).not.toContain('handleProposedCesarPlan');
  expect(cesar.match(/createPlanExecutionSession\(cb\)\.propose\(/g)).toHaveLength(3);
  const interactive = source('packages/cli/src/signals/dispatch/intent-session.ts');
  expect(interactive).not.toContain('findResumableCesarPlan');
  expect(interactive).toContain('selectResumablePlan(');
});

it('removes the CLI-owned session scope instead of retaining a second owner', () => {
  expect(existsSync(fileURLToPath(new URL('../../packages/cli/src/plan-session-host.ts', import.meta.url)))).toBe(false);
  for (const path of ['packages/cli/src/first-party-services.ts', 'packages/cli/src/signals/dispatch/intent-session.ts']) {
    expect(source(path)).not.toContain('plan-session-host.js');
    expect(source(path)).toMatch(/import\s*\{[^}]*\b(?:planSessionHost|withPlanSession)\b[^}]*\}\s*from\s*['"]@kernlang\/agon-mod-plan['"]/);
  }
});
