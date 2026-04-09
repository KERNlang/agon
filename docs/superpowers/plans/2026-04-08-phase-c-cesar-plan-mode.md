# Phase C: Cesar Plan Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add plan mode to Cesar where he proposes structured execution plans with engine assignments and cost estimates, the user approves/revises/rejects, and Cesar executes step by step with real cost tracking.

**Architecture:** New `CesarPlan` type in core with state machine. `ProposePlan` tool lets Cesar output structured plans. Plan executor resolves DAG dependencies, dispatches steps via `runForge`/`runBrainstorm`/`runTribunal`/`runCampfire`/`runDelegate` from @agon/forge, handles context handoff between steps. `/plan <task>` enters plan mode. Approval flow via question prompt. Progress via existing status bar pattern.

**Tech Stack:** KERN lang, existing @agon/forge orchestration functions, Node.js

**Spec:** `docs/superpowers/specs/2026-04-08-cesar-plan-mode-design.md` — Parts 2-6

**Depends on:** Phase A (real token capture) and Phase B (dispatch extraction) — both complete.

---

### Task 1: CesarPlan Type + State Machine

**Files:**
- Create: `packages/core/src/kern/cesar-plan.kern`
- Modify: `packages/core/src/index.ts` (add exports)
- Test: `tests/unit/cesar-plan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cesar-plan.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createCesarPlan, approveCesarPlan, advanceCesarStep, cancelCesarPlan } from '../../packages/core/src/generated/cesar-plan.js';
import type { CesarPlan, CesarPlanStep } from '../../packages/core/src/generated/cesar-plan.js';

const makeStep = (id: string, overrides?: Partial<CesarPlanStep>): CesarPlanStep => ({
  id,
  type: 'self',
  description: 'test step',
  estimatedTokens: 1000,
  estimatedCostUsd: 0.01,
  ...overrides,
});

describe('CesarPlan state machine', () => {
  it('creates a plan in planning state', () => {
    const plan = createCesarPlan('add rate limiting', [makeStep('scan')]);
    expect(plan.state).toBe('planning');
    expect(plan.intent).toBe('add rate limiting');
    expect(plan.steps).toHaveLength(1);
  });

  it('transitions from planning to awaiting_approval', () => {
    const plan = createCesarPlan('task', [makeStep('s1')]);
    const proposed = { ...plan, state: 'awaiting_approval' as const };
    expect(proposed.state).toBe('awaiting_approval');
  });

  it('approves a plan and transitions to running', () => {
    let plan = createCesarPlan('task', [makeStep('s1')]);
    plan = { ...plan, state: 'awaiting_approval' as const };
    plan = approveCesarPlan(plan);
    expect(plan.state).toBe('running');
    expect(plan.approvedAt).toBeDefined();
  });

  it('advances a step to done', () => {
    let plan = createCesarPlan('task', [makeStep('s1'), makeStep('s2')]);
    plan = approveCesarPlan({ ...plan, state: 'awaiting_approval' as const });
    plan = advanceCesarStep(plan, 's1', { status: 'success', actualTokens: 800, actualCostUsd: 0.008, durationMs: 5000, output: 'found patterns' });
    expect(plan.steps[0].state).toBe('done');
    expect(plan.steps[0].result?.actualTokens).toBe(800);
  });

  it('resolves dependencies when step completes', () => {
    let plan = createCesarPlan('task', [
      makeStep('s1'),
      makeStep('s2', { dependsOn: ['s1'] }),
    ]);
    plan = approveCesarPlan({ ...plan, state: 'awaiting_approval' as const });
    expect(plan.steps[1].state).toBe('blocked');
    plan = advanceCesarStep(plan, 's1', { status: 'success', actualTokens: 0, actualCostUsd: 0, durationMs: 0, output: '' });
    expect(plan.steps[1].state).toBe('pending');
  });

  it('marks plan done when all steps complete', () => {
    let plan = createCesarPlan('task', [makeStep('s1')]);
    plan = approveCesarPlan({ ...plan, state: 'awaiting_approval' as const });
    plan = advanceCesarStep(plan, 's1', { status: 'success', actualTokens: 0, actualCostUsd: 0, durationMs: 0, output: '' });
    expect(plan.state).toBe('done');
  });

  it('pauses plan on step failure', () => {
    let plan = createCesarPlan('task', [makeStep('s1'), makeStep('s2')]);
    plan = approveCesarPlan({ ...plan, state: 'awaiting_approval' as const });
    plan = advanceCesarStep(plan, 's1', { status: 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: 0, output: '', error: 'no winner' });
    expect(plan.state).toBe('paused');
    expect(plan.steps[0].state).toBe('failed');
  });

  it('cancels a plan', () => {
    let plan = createCesarPlan('task', [makeStep('s1')]);
    plan = cancelCesarPlan(plan);
    expect(plan.state).toBe('cancelled');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/cesar-plan.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create cesar-plan.kern**

Create `packages/core/src/kern/cesar-plan.kern`:

```kern
interface name=CesarStepResult export=true
  field name=status type="'success'|'failure'"
  field name=actualTokens type=number
  field name=actualCostUsd type=number
  field name=durationMs type=number
  field name=output type=string
  field name=error type=string optional=true

interface name=CesarPlanStep export=true
  field name=id type=string
  field name=type type="'self'|'forge'|'teamforge'|'delegate'|'brainstorm'|'campfire'|'tribunal'|'pipeline'"
  field name=description type=string
  field name=engines type="string[]" optional=true
  field name=engine type=string optional=true
  field name=fitnessCmd type=string optional=true
  field name=tribunalMode type=string optional=true
  field name=parallel type=boolean optional=true
  field name=dependsOn type="string[]" optional=true
  field name=exports type=string optional=true
  field name=imports type="string[]" optional=true
  field name=estimatedTokens type=number
  field name=estimatedCostUsd type=number
  field name=state type="'pending'|'blocked'|'running'|'done'|'failed'|'skipped'|'cancelled'" optional=true
  field name=result type=CesarStepResult optional=true

interface name=CesarPlan export=true
  field name=id type=string
  field name=state type="'planning'|'awaiting_approval'|'running'|'paused'|'done'|'cancelled'"
  field name=intent type=string
  field name=steps type="CesarPlanStep[]"
  field name=planningCost type="{tokens:number,costUsd:number}" optional=true
  field name=totalEstimatedTokens type=number
  field name=totalEstimatedCostUsd type=number
  field name=totalActualTokens type=number
  field name=totalActualCostUsd type=number
  field name=stepContext type="Record<string,string>"
  field name=createdAt type=number
  field name=approvedAt type=number optional=true
  field name=completedAt type=number optional=true
  field name=planFilePath type=string optional=true

fn name=createCesarPlan params="intent:string, steps:CesarPlanStep[]" returns=CesarPlan export=true
  handler <<<
    const id = `cplan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const initialized = steps.map((s) => ({
      ...s,
      state: (s.dependsOn && s.dependsOn.length > 0 ? 'blocked' : 'pending') as CesarPlanStep['state'],
    }));
    return {
      id,
      state: 'planning',
      intent,
      steps: initialized,
      totalEstimatedTokens: steps.reduce((sum, s) => sum + s.estimatedTokens, 0),
      totalEstimatedCostUsd: steps.reduce((sum, s) => sum + s.estimatedCostUsd, 0),
      totalActualTokens: 0,
      totalActualCostUsd: 0,
      stepContext: {},
      createdAt: Date.now(),
    };
  >>>

fn name=approveCesarPlan params="plan:CesarPlan" returns=CesarPlan export=true
  handler <<<
    if (plan.state !== 'awaiting_approval' && plan.state !== 'planning') {
      throw new Error(`Cannot approve plan in state: ${plan.state}`);
    }
    return { ...plan, state: 'running', approvedAt: Date.now() };
  >>>

fn name=advanceCesarStep params="plan:CesarPlan, stepId:string, result:CesarStepResult" returns=CesarPlan export=true
  handler <<<
    const stepIdx = plan.steps.findIndex((s) => s.id === stepId);
    if (stepIdx === -1) return plan;

    const newSteps = plan.steps.map((s, i) => {
      if (i === stepIdx) {
        return { ...s, state: (result.status === 'success' ? 'done' : 'failed') as CesarPlanStep['state'], result };
      }
      return s;
    });

    // Unblock dependent steps
    for (let i = 0; i < newSteps.length; i++) {
      if (newSteps[i].state === 'blocked') {
        const deps = newSteps[i].dependsOn ?? [];
        const allDone = deps.every((depId: string) => newSteps.find((s) => s.id === depId)?.state === 'done');
        if (allDone) newSteps[i] = { ...newSteps[i], state: 'pending' };
      }
    }

    // Determine plan state
    let newState = plan.state;
    if (result.status === 'failure') {
      newState = 'paused';
    } else {
      const allDone = newSteps.every((s) => s.state === 'done' || s.state === 'skipped');
      if (allDone) newState = 'done';
    }

    return {
      ...plan,
      steps: newSteps,
      state: newState as CesarPlan['state'],
      totalActualTokens: plan.totalActualTokens + result.actualTokens,
      totalActualCostUsd: plan.totalActualCostUsd + result.actualCostUsd,
      completedAt: newState === 'done' ? Date.now() : plan.completedAt,
    };
  >>>

fn name=cancelCesarPlan params="plan:CesarPlan" returns=CesarPlan export=true
  handler <<<
    const newSteps = plan.steps.map((s) => {
      if (s.state === 'pending' || s.state === 'blocked' || s.state === 'running') {
        return { ...s, state: 'cancelled' as CesarPlanStep['state'] };
      }
      return s;
    });
    return { ...plan, steps: newSteps, state: 'cancelled' };
  >>>
```

- [ ] **Step 4: Add exports to core index**

In `packages/core/src/index.ts`, add:
```typescript
export { createCesarPlan, approveCesarPlan, advanceCesarStep, cancelCesarPlan } from './generated/cesar-plan.js';
export type { CesarPlan, CesarPlanStep, CesarStepResult } from './generated/cesar-plan.js';
```

- [ ] **Step 5: Compile, build, test**

```bash
npx kern compile packages/core/src/kern/cesar-plan.kern --outdir=packages/core/src/generated
npm run build
npm test -- --run tests/unit/cesar-plan.test.ts
```
Expected: All 7 tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/kern/cesar-plan.kern packages/core/src/generated/cesar-plan.ts packages/core/src/index.ts tests/unit/cesar-plan.test.ts
git commit -m "feat(cesar-plan): add CesarPlan type and state machine"
```

---

### Task 2: PlanCostEstimator

**Files:**
- Create: `packages/core/src/kern/plan-cost-estimator.kern`
- Modify: `packages/core/src/index.ts`
- Test: `tests/unit/plan-cost-estimator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/plan-cost-estimator.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { planCostEstimator } from '../../packages/core/src/generated/plan-cost-estimator.js';
import { tracker } from '../../packages/core/src/generated/token-tracker.js';

describe('PlanCostEstimator', () => {
  beforeEach(() => {
    tracker.reset();
    planCostEstimator.reset();
  });

  it('returns default estimates when no history', () => {
    const est = planCostEstimator.estimate('forge', ['claude', 'codex', 'gemini']);
    expect(est.tokens).toBeGreaterThan(0);
    expect(est.costUsd).toBeGreaterThan(0);
  });

  it('uses historical averages when available', () => {
    // Simulate some forge dispatches
    tracker.record('claude', { usage: { promptTokens: 5000, completionTokens: 3000, totalTokens: 8000, source: 'sdk' } });
    tracker.record('codex', { usage: { promptTokens: 4000, completionTokens: 2000, totalTokens: 6000, source: 'sdk' } });
    planCostEstimator.recordStepCompletion('forge', 14000, 0.10);

    const est = planCostEstimator.estimate('forge', ['claude', 'codex']);
    // Should be influenced by historical data
    expect(est.tokens).toBeGreaterThan(0);
  });

  it('estimates different costs for different step types', () => {
    const forgeEst = planCostEstimator.estimate('forge', ['claude', 'codex', 'gemini']);
    const selfEst = planCostEstimator.estimate('self', []);
    expect(forgeEst.tokens).toBeGreaterThan(selfEst.tokens);
  });
});
```

- [ ] **Step 2: Create plan-cost-estimator.kern**

Create `packages/core/src/kern/plan-cost-estimator.kern`:

```kern
import from="./token-tracker.js" names="estimateCost"

interface name=CostEstimate export=true
  field name=tokens type=number
  field name=costUsd type=number

service name=PlanCostEstimator export=true
  field name=history type="{ type: string, tokens: number, costUsd: number }[]" default="[]" private=true

  method name=estimate params="stepType:string, engines:string[]" returns=CostEstimate
    doc "Estimate tokens and cost for a plan step based on type and engine count."
    handler <<<
      // Check historical average for this step type
      const typeHistory = this.history.filter((h) => h.type === stepType);
      if (typeHistory.length >= 2) {
        const avgTokens = Math.round(typeHistory.reduce((s, h) => s + h.tokens, 0) / typeHistory.length);
        const avgCost = typeHistory.reduce((s, h) => s + h.costUsd, 0) / typeHistory.length;
        return { tokens: avgTokens, costUsd: avgCost };
      }

      // Default estimates by step type (per engine, then multiply)
      const DEFAULTS: Record<string, number> = {
        self: 2000,
        delegate: 5000,
        brainstorm: 8000,
        campfire: 6000,
        tribunal: 10000,
        forge: 15000,
        teamforge: 20000,
        pipeline: 30000,
      };
      const perEngine = DEFAULTS[stepType] ?? 5000;
      const engineCount = Math.max(engines.length, 1);
      const tokens = perEngine * engineCount;
      // Use first engine for cost estimate, or default
      const costPerEngine = engines[0] ? estimateCost(engines[0], perEngine) : estimateCost('claude', perEngine);
      const costUsd = costPerEngine * engineCount;
      return { tokens, costUsd };
    >>>

  method name=recordStepCompletion params="stepType:string, actualTokens:number, actualCostUsd:number" returns=void
    doc "Record actual step costs so future estimates improve."
    handler <<<
      this.history.push({ type: stepType, tokens: actualTokens, costUsd: actualCostUsd });
      // Keep last 50 entries per type
      const typeEntries = this.history.filter((h) => h.type === stepType);
      if (typeEntries.length > 50) {
        const oldest = this.history.findIndex((h) => h.type === stepType);
        if (oldest >= 0) this.history.splice(oldest, 1);
      }
    >>>

  method name=reset returns=void
    handler <<<
      this.history = [];
    >>>

  singleton name=planCostEstimator
```

- [ ] **Step 3: Add export, compile, build, test**

Add to `packages/core/src/index.ts`:
```typescript
export { planCostEstimator } from './generated/plan-cost-estimator.js';
export type { CostEstimate } from './generated/plan-cost-estimator.js';
```

```bash
npx kern compile packages/core/src/kern/plan-cost-estimator.kern --outdir=packages/core/src/generated
npm run build
npm test -- --run tests/unit/plan-cost-estimator.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/kern/plan-cost-estimator.kern packages/core/src/generated/plan-cost-estimator.ts packages/core/src/index.ts tests/unit/plan-cost-estimator.test.ts
git commit -m "feat(cesar-plan): add PlanCostEstimator with historical averages"
```

---

### Task 3: ProposePlan Tool + Plan Formatter

**Files:**
- Create: `packages/core/src/kern/tool-propose-plan.kern`
- Create: `packages/core/src/kern/cesar-plan-formatter.kern`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/tools.ts`
- Modify: `packages/cli/src/kern/cesar-tools.kern`

- [ ] **Step 1: Create cesar-plan-formatter.kern**

Create `packages/core/src/kern/cesar-plan-formatter.kern`:

```kern
import from="./cesar-plan.js" names="CesarPlan,CesarPlanStep" types=true

fn name=formatCesarPlanMarkdown params="plan:CesarPlan" returns=string export=true
  handler <<<
    const lines: string[] = [];
    lines.push(`# Plan: ${plan.intent}`);
    lines.push('');
    if (plan.planningCost) {
      lines.push(`> Planning cost: ${plan.planningCost.tokens.toLocaleString()} tokens ($${plan.planningCost.costUsd.toFixed(2)})`);
      lines.push('');
    }
    lines.push('## Steps');
    lines.push('');

    for (let i = 0; i < plan.steps.length; i++) {
      const s = plan.steps[i];
      const num = i + 1;
      const typeLabel = formatStepType(s);
      const stateIcon = s.state === 'done' ? '✓' : s.state === 'running' ? '●' : s.state === 'failed' ? '✗' : s.state === 'cancelled' ? '⊘' : '○';
      lines.push(`### Step ${num}: ${s.description} [${typeLabel}] ${stateIcon} ${s.state ?? 'pending'}`);

      if (s.fitnessCmd) lines.push(`- Fitness: \`${s.fitnessCmd}\``);
      if (s.dependsOn && s.dependsOn.length > 0) lines.push(`- Depends on: ${s.dependsOn.join(', ')}`);
      if (s.exports) lines.push(`- Exports: ${s.exports}`);
      if (s.imports && s.imports.length > 0) lines.push(`- Imports: ${s.imports.join(', ')}`);

      if (s.result) {
        lines.push(`- Actual: ${s.result.actualTokens.toLocaleString()} tokens ($${s.result.actualCostUsd.toFixed(4)}) — ${(s.result.durationMs / 1000).toFixed(1)}s`);
      } else {
        lines.push(`- Est: ~${s.estimatedTokens.toLocaleString()} tokens ($${s.estimatedCostUsd.toFixed(2)})`);
      }
      lines.push('');
    }

    lines.push('---');
    if (plan.totalActualTokens > 0) {
      lines.push(`**Planned: ~${plan.totalEstimatedTokens.toLocaleString()} tokens ($${plan.totalEstimatedCostUsd.toFixed(2)})**`);
      lines.push(`**Actual: ${plan.totalActualTokens.toLocaleString()} tokens ($${plan.totalActualCostUsd.toFixed(2)})**`);
    } else {
      lines.push(`**Total estimated: ~${plan.totalEstimatedTokens.toLocaleString()} tokens ($${plan.totalEstimatedCostUsd.toFixed(2)})**`);
    }
    if (plan.steps.some((s) => s.engines && s.engines.length > 0)) {
      const allEngines = [...new Set(plan.steps.flatMap((s) => s.engines ?? (s.engine ? [s.engine] : [])))];
      lines.push(`**Engines: ${allEngines.join(', ')}**`);
    }
    lines.push(`**Status: ${plan.state}**`);

    return lines.join('\n');
  >>>

fn name=formatStepType params="s:CesarPlanStep" returns=string export=false
  handler <<<
    switch (s.type) {
      case 'self': return 'self: Cesar';
      case 'forge': return `forge: ${(s.engines ?? []).join(', ')}`;
      case 'teamforge': return `teamforge: ${(s.engines ?? []).join(', ')}`;
      case 'delegate': return `delegate: ${s.engine ?? 'unknown'}`;
      case 'brainstorm': return `brainstorm: ${(s.engines ?? []).join(', ')}`;
      case 'campfire': return `campfire: ${(s.engines ?? []).join(', ')}`;
      case 'tribunal': return `tribunal: ${(s.engines ?? []).join(', ')}${s.tribunalMode ? ' — ' + s.tribunalMode : ''}`;
      case 'pipeline': return `pipeline: ${(s.engines ?? []).join(', ')}`;
      default: return s.type;
    }
  >>>
```

- [ ] **Step 2: Create tool-propose-plan.kern**

Create `packages/core/src/kern/tool-propose-plan.kern`:

```kern
import from="./tool-registry.js" names="ToolHandler,ToolDefinition,ToolResult,PermissionDecision" types=true
import from="./tool-registry.js" names="ToolContext" types=true

fn name=createProposePlanTool returns=ToolHandler export=true
  handler <<<
    const definition: ToolDefinition = {
      name: 'ProposePlan',
      description: 'Propose a structured execution plan for user approval. Use this when in plan mode to present your strategy with steps, engine assignments, and cost estimates. The user will approve, reject, or give feedback to revise.',
      inputSchema: {
        type: 'object',
        properties: {
          intent: { type: 'string', description: 'What the user asked for — one sentence summary.' },
          planningCost: {
            type: 'object',
            properties: {
              tokens: { type: 'number', description: 'Total tokens spent during planning phase' },
              costUsd: { type: 'number', description: 'Total cost of planning phase' },
            },
          },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique step ID (short, lowercase, e.g. "scan", "implement", "review")' },
                type: { type: 'string', enum: ['self', 'forge', 'teamforge', 'delegate', 'brainstorm', 'campfire', 'tribunal', 'pipeline'], description: 'Step execution type' },
                description: { type: 'string', description: 'What this step does' },
                engines: { type: 'array', items: { type: 'string' }, description: 'Engine IDs for multi-engine steps' },
                engine: { type: 'string', description: 'Single engine ID for delegate steps' },
                fitnessCmd: { type: 'string', description: 'Fitness test command for forge/teamforge steps' },
                tribunalMode: { type: 'string', description: 'Tribunal mode: adversarial, socratic, red-team, etc.' },
                parallel: { type: 'boolean', description: 'Can run alongside other parallel steps' },
                dependsOn: { type: 'array', items: { type: 'string' }, description: 'Step IDs that must complete first' },
                exports: { type: 'string', description: 'Key name for what this step produces (for downstream context)' },
                imports: { type: 'array', items: { type: 'string' }, description: 'Export keys from prior steps this step needs' },
                estimatedTokens: { type: 'number', description: 'Estimated token usage for this step' },
                estimatedCostUsd: { type: 'number', description: 'Estimated cost in USD for this step' },
              },
              required: ['id', 'type', 'description', 'estimatedTokens', 'estimatedCostUsd'],
            },
          },
        },
        required: ['intent', 'steps'],
      },
      maxResultSizeChars: 5000,
      isReadOnly: true,
      isConcurrencySafe: true,
    };

    const validate = (input: Record<string, unknown>, _ctx: ToolContext): string | null => {
      if (!input.intent || typeof input.intent !== 'string') return 'Missing required: intent';
      if (!Array.isArray(input.steps) || input.steps.length === 0) return 'Missing required: steps (must be non-empty array)';

      const steps = input.steps as any[];
      const ids = new Set<string>();
      for (const s of steps) {
        if (!s.id || !s.type || !s.description) return `Step missing required fields: ${JSON.stringify(s)}`;
        if (ids.has(s.id)) return `Duplicate step ID: ${s.id}`;
        ids.add(s.id);
      }

      // Check for circular dependencies
      for (const s of steps) {
        if (s.dependsOn) {
          for (const dep of s.dependsOn) {
            if (!ids.has(dep)) return `Step "${s.id}" depends on unknown step "${dep}"`;
          }
        }
      }

      // Topological sort to detect cycles
      const visited = new Set<string>();
      const visiting = new Set<string>();
      const stepMap = new Map(steps.map((s: any) => [s.id, s]));
      const hasCycle = (id: string): boolean => {
        if (visiting.has(id)) return true;
        if (visited.has(id)) return false;
        visiting.add(id);
        const s = stepMap.get(id);
        for (const dep of (s?.dependsOn ?? [])) {
          if (hasCycle(dep)) return true;
        }
        visiting.delete(id);
        visited.add(id);
        return false;
      };
      for (const s of steps) {
        if (hasCycle(s.id)) return `Circular dependency detected involving step "${s.id}"`;
      }

      return null;
    };

    const checkPermission = (_input: Record<string, unknown>, _ctx: ToolContext): PermissionDecision => {
      return { behavior: 'allow' };
    };

    // ProposePlan is a signal tool — actual plan creation happens in the handler
    const execute = async (_input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
      return { ok: true, content: '[PLAN_PROPOSED] Plan submitted for user approval.' };
    };

    return { definition, validate, checkPermission, execute };
  >>>
```

- [ ] **Step 3: Register ProposePlan tool and add exports**

Add to `packages/core/src/tools.ts`:
```typescript
export { createProposePlanTool } from './generated/tool-propose-plan.js';
```

Add to `packages/core/src/index.ts`:
```typescript
export { createProposePlanTool } from './tools.js';
export { formatCesarPlanMarkdown } from './generated/cesar-plan-formatter.js';
```

In `packages/cli/src/kern/cesar-tools.kern`, add to the import and register:
```
import from="@agon/core" names="...,createProposePlanTool"
```
Inside `createCesarToolRegistry()`:
```javascript
    toolRegistry.register(createProposePlanTool());
```

- [ ] **Step 4: Compile all, build, test**

```bash
npx kern compile packages/core/src/kern/cesar-plan-formatter.kern --outdir=packages/core/src/generated
npx kern compile packages/core/src/kern/tool-propose-plan.kern --outdir=packages/core/src/generated
npx kern compile packages/cli/src/kern/cesar-tools.kern --outdir=packages/cli/src/generated
npm run build
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/kern/cesar-plan-formatter.kern packages/core/src/generated/cesar-plan-formatter.ts packages/core/src/kern/tool-propose-plan.kern packages/core/src/generated/tool-propose-plan.ts packages/core/src/tools.ts packages/core/src/index.ts packages/cli/src/kern/cesar-tools.kern packages/cli/src/generated/cesar-tools.ts
git commit -m "feat(cesar-plan): add ProposePlan tool, plan formatter, and register in Cesar tools"
```

---

### Task 4: Plan Mode System Prompt + Tool Blocking

**Files:**
- Modify: `packages/cli/src/kern/cesar-session.kern` (buildCesarSystemPrompt + buildOnToolCall)

- [ ] **Step 1: Add plan mode rule to system prompt**

In `buildCesarSystemPrompt()`, after the existing rules, add a plan mode section. The function receives `ctx: HandlerContext` — check if plan mode is active by looking at `(ctx as any).activePlan?.state === 'planning'`:

```javascript
    // Plan mode system prompt addition
    if ((ctx as any).activePlan && ['planning', 'awaiting_approval'].includes((ctx as any).activePlan.state)) {
      systemParts.push(`RULE 8 — PLAN MODE: You are in PLAN MODE. Your goal is to produce the best possible plan, then propose it with ProposePlan.

ALLOWED: Brainstorm, Campfire, Tribunal, Delegate, Read, Grep, Glob, Bash (read-only), ReportConfidence, ProposePlan. Use these freely to analyze the task and build your strategy.

BLOCKED: Forge, Pipeline, Edit, Write. No code execution until the plan is approved.

Think deeply. Use other engines to challenge your approach. Then propose a structured plan with specific engine assignments and cost estimates for each step.`);
    }
```

- [ ] **Step 2: Add tool blocking in buildOnToolCall**

In `buildOnToolCall()`, near the top of the function (before the orchestration tool handling), add a plan mode block check:

```javascript
      // Plan mode: block execution tools
      const activePlan = (ctx as any).activePlan;
      if (activePlan && ['planning', 'awaiting_approval'].includes(activePlan.state)) {
        const BLOCKED_IN_PLAN = ['Forge', 'Pipeline', 'Edit', 'Write'];
        if (BLOCKED_IN_PLAN.includes(name)) {
          return `[BLOCKED] Tool "${name}" is not available in plan mode. Use ProposePlan to propose your execution strategy.`;
        }
        // Block write-mode Bash
        if (name === 'Bash') {
          const cmd = String((args as any).command ?? '');
          const writePatterns = /\b(rm|mv|cp|mkdir|touch|chmod|chown|git\s+(commit|push|merge|rebase|reset)|npm\s+(install|uninstall|publish))\b/;
          if (writePatterns.test(cmd)) {
            return `[BLOCKED] Write commands are not available in plan mode. Use ProposePlan to propose your execution strategy.`;
          }
        }
      }
```

- [ ] **Step 3: Handle ProposePlan tool call in buildOnToolCall**

Add handling for the ProposePlan signal tool (before the ReportConfidence handler):

```javascript
      // ProposePlan signal — extract plan data and break
      if (name === 'ProposePlan') {
        return '[PLAN_PROPOSED] Plan submitted for user approval. Stop and wait.';
      }
```

- [ ] **Step 4: Compile, build, test**

```bash
npx kern compile packages/cli/src/kern/cesar-session.kern --outdir=packages/cli/src/generated
npm run build
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/kern/cesar-session.kern packages/cli/src/generated/cesar-session.ts
git commit -m "feat(cesar-plan): add plan mode system prompt and tool blocking"
```

---

### Task 5: /plan Intent + Dispatch + UI State

**Files:**
- Modify: `packages/cli/src/kern/intent.kern` (update /plan parsing)
- Modify: `packages/cli/src/kern/app-dispatch.kern` (route /plan <task>)
- Modify: `packages/cli/src/kern/ui-app.kern` (add activePlan state)
- Modify: `packages/cli/src/kern/handler-types.kern` (add plan-proposal event)

- [ ] **Step 1: Update intent parsing for /plan <task>**

In `intent.kern`, update the `/plan` slash command description:
```
{ cmd: '/plan',        desc: '<task> or no args    — enter plan mode or show plan' },
```

Update the parse case for 'plan':
```javascript
        case 'plan': {
          const text = rest.trim();
          if (text) {
            return { type: 'plan-task', task: text } as Intent;
          }
          return { type: 'plan', planId: undefined } as Intent;
        }
```

Add `plan-task` as a new intent type in the Intent interface if needed.

- [ ] **Step 2: Add activePlan state to ui-app.kern**

After the existing `currentPlan` state (line ~79), add:
```kern
  state name=activePlan type="any" initial="null"
```

Pass `activePlan` and `setActivePlan` through to the HandlerContext builder.

- [ ] **Step 3: Add plan-proposal output event**

In `handler-types.kern`, add near the existing plan variants:
```kern
  variant name=plan-proposal
    field name=plan type=any
    field name=markdown type=string
```

- [ ] **Step 4: Route /plan <task> in app-dispatch.kern**

Add a new case before the existing 'plan' case:
```javascript
      case 'plan-task': {
        // Enter plan mode: create plan, set active, dispatch to Cesar
        const { createCesarPlan } = await import('@agon/core');
        const plan = createCesarPlan(intent.task, []);
        cb.setActivePlan(plan);
        // Dispatch the task to Cesar (he'll use ProposePlan to propose)
        const cesarIntent = { type: 'chat', input: intent.task } as any;
        await dispatchIntent(cesarIntent, intent.task, cb);
        break;
      }
```

- [ ] **Step 5: Compile all modified files, build, test**

```bash
npx kern compile packages/cli/src/kern/intent.kern --outdir=packages/cli/src/generated
npx kern compile packages/cli/src/kern/app-dispatch.kern --outdir=packages/cli/src/generated
npx kern compile packages/cli/src/kern/ui-app.kern --outdir=packages/cli/src/generated
npx kern compile packages/cli/src/kern/handler-types.kern --outdir=packages/cli/src/generated
npm run build
npm run test
```

- [ ] **Step 6: Commit**

```bash
git add -u packages/
git commit -m "feat(cesar-plan): add /plan <task> intent, activePlan state, plan-proposal event"
```

---

### Task 6: Plan Executor (DAG Resolution + Context Handoff)

**Files:**
- Create: `packages/core/src/kern/plan-executor.kern`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create plan-executor.kern**

This is the core execution engine. It takes an approved CesarPlan and executes it step by step.

Create `packages/core/src/kern/plan-executor.kern`:

```kern
import from="./cesar-plan.js" names="CesarPlan,CesarPlanStep,CesarStepResult,advanceCesarStep" types=true
import from="./cesar-plan.js" names="advanceCesarStep"
import from="./token-tracker.js" names="tracker"
import from="./plan-cost-estimator.js" names="planCostEstimator"

interface name=StepExecutor export=true
  field name=execute type="(step:CesarPlanStep, context:Record<string,string>, signal?:AbortSignal)=>Promise<{result:CesarStepResult,contextExport?:string}>"

interface name=PlanExecutorCallbacks export=true
  field name=onStepStart type="(stepId:string)=>void"
  field name=onStepDone type="(stepId:string, result:CesarStepResult)=>void"
  field name=onPlanUpdate type="(plan:CesarPlan)=>void"
  field name=onBudgetWarning type="(actual:number, estimated:number)=>void"

fn name=getReadySteps params="plan:CesarPlan" returns="CesarPlanStep[]" export=true
  doc "Return steps that are pending and have all dependencies met."
  handler <<<
    return plan.steps.filter((s) => s.state === 'pending');
  >>>

fn name=executePlan async=true params="plan:CesarPlan, executors:Record<string,StepExecutor>, callbacks:PlanExecutorCallbacks, signal?:AbortSignal" returns="Promise<CesarPlan>" export=true
  doc "Execute an approved plan step by step, resolving dependencies and handling context handoff."
  handler <<<
    let current = plan;

    while (current.state === 'running') {
      if (signal?.aborted) {
        break;
      }

      const ready = getReadySteps(current);
      if (ready.length === 0) break;

      // Separate parallel and sequential steps
      const parallelSteps = ready.filter((s) => s.parallel);
      const sequentialSteps = ready.filter((s) => !s.parallel);

      // Execute parallel steps concurrently
      if (parallelSteps.length > 0) {
        const results = await Promise.all(parallelSteps.map(async (step) => {
          callbacks.onStepStart(step.id);
          const executor = executors[step.type];
          if (!executor) {
            return { stepId: step.id, result: { status: 'failure' as const, actualTokens: 0, actualCostUsd: 0, durationMs: 0, output: '', error: `No executor for step type: ${step.type}` } };
          }
          try {
            const { result, contextExport } = await executor.execute(step, current.stepContext, signal);
            if (contextExport && step.exports) {
              current = { ...current, stepContext: { ...current.stepContext, [step.exports]: contextExport } };
            }
            return { stepId: step.id, result };
          } catch (err) {
            return { stepId: step.id, result: { status: 'failure' as const, actualTokens: 0, actualCostUsd: 0, durationMs: 0, output: '', error: err instanceof Error ? err.message : String(err) } };
          }
        }));

        for (const { stepId, result } of results) {
          current = advanceCesarStep(current, stepId, result);
          callbacks.onStepDone(stepId, result);
          planCostEstimator.recordStepCompletion(current.steps.find((s) => s.id === stepId)?.type ?? 'unknown', result.actualTokens, result.actualCostUsd);
        }
      }

      // Execute first sequential step
      if (sequentialSteps.length > 0 && current.state === 'running') {
        const step = sequentialSteps[0];
        callbacks.onStepStart(step.id);
        const executor = executors[step.type];
        if (!executor) {
          const result: CesarStepResult = { status: 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: 0, output: '', error: `No executor for step type: ${step.type}` };
          current = advanceCesarStep(current, step.id, result);
          callbacks.onStepDone(step.id, result);
          continue;
        }
        try {
          const { result, contextExport } = await executor.execute(step, current.stepContext, signal);
          if (contextExport && step.exports) {
            current = { ...current, stepContext: { ...current.stepContext, [step.exports]: contextExport } };
          }
          current = advanceCesarStep(current, step.id, result);
          callbacks.onStepDone(step.id, result);
          planCostEstimator.recordStepCompletion(step.type, result.actualTokens, result.actualCostUsd);
        } catch (err) {
          const result: CesarStepResult = { status: 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: 0, output: '', error: err instanceof Error ? err.message : String(err) };
          current = advanceCesarStep(current, step.id, result);
          callbacks.onStepDone(step.id, result);
        }
      }

      // Budget check
      if (current.totalActualCostUsd > 0 && current.totalEstimatedCostUsd > 0) {
        const ratio = current.totalActualCostUsd / current.totalEstimatedCostUsd;
        const threshold = current.totalEstimatedCostUsd > 5 ? 1.25 : current.totalEstimatedCostUsd > 1 ? 1.5 : 2.0;
        if (ratio > threshold) {
          callbacks.onBudgetWarning(current.totalActualCostUsd, current.totalEstimatedCostUsd);
        }
      }

      callbacks.onPlanUpdate(current);
    }

    return current;
  >>>
```

- [ ] **Step 2: Add exports**

```typescript
export { executePlan, getReadySteps } from './generated/plan-executor.js';
export type { StepExecutor, PlanExecutorCallbacks } from './generated/plan-executor.js';
```

- [ ] **Step 3: Compile, build, test**

```bash
npx kern compile packages/core/src/kern/plan-executor.kern --outdir=packages/core/src/generated
npm run build
npm run test
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/kern/plan-executor.kern packages/core/src/generated/plan-executor.ts packages/core/src/index.ts
git commit -m "feat(cesar-plan): add plan executor with DAG resolution and context handoff"
```

---

### Task 7: handlers-plan-mode.kern — Ties It All Together

**Files:**
- Create: `packages/cli/src/kern/handlers-plan-mode.kern`

This is the main handler that:
1. Receives the ProposePlan tool call from Cesar
2. Creates the CesarPlan from the tool args
3. Writes the plan markdown to disk
4. Shows the plan and asks for approval
5. On approve: executes via the plan executor with step executors that call runForge/runBrainstorm/etc.
6. On reject: cancels
7. On feedback: sends feedback to Cesar for revision

- [ ] **Step 1: Create handlers-plan-mode.kern**

Create `packages/cli/src/kern/handlers-plan-mode.kern`. This is a large file — it contains:

```kern
import from="node:fs" names="writeFileSync,mkdirSync"
import from="node:path" names="join"
import from="@agon/core" names="createCesarPlan,approveCesarPlan,cancelCesarPlan,advanceCesarStep,executePlan,getReadySteps,formatCesarPlanMarkdown,planCostEstimator,resolveWorkingDir,RUNS_DIR,tracker"
import from="@agon/core" names="CesarPlan,CesarPlanStep,CesarStepResult,StepExecutor,PlanExecutorCallbacks" types=true
import from="@agon/forge" names="runForge,runBrainstorm,runTribunal,runCampfire,runDelegate"
import from="../handlers/types.js" names="Dispatch,HandlerContext,EngineProgress" types=true
import from="../generated/session-results.js" names="sessionResultStore"

fn name=handleProposePlan params="args:any, dispatch:Dispatch, ctx:HandlerContext" returns="Promise<CesarPlan>" async=true
  doc "Process ProposePlan tool call from Cesar, create plan, show to user, handle approval."
  handler <<<
    const steps: CesarPlanStep[] = (args.steps ?? []).map((s: any) => ({
      id: s.id,
      type: s.type,
      description: s.description,
      engines: s.engines,
      engine: s.engine,
      fitnessCmd: s.fitnessCmd,
      tribunalMode: s.tribunalMode,
      parallel: s.parallel ?? false,
      dependsOn: s.dependsOn,
      exports: s.exports,
      imports: s.imports,
      estimatedTokens: s.estimatedTokens ?? planCostEstimator.estimate(s.type, s.engines ?? []).tokens,
      estimatedCostUsd: s.estimatedCostUsd ?? planCostEstimator.estimate(s.type, s.engines ?? []).costUsd,
    }));

    const plan = createCesarPlan(args.intent, steps);
    const withPlanning = args.planningCost
      ? { ...plan, planningCost: args.planningCost, state: 'awaiting_approval' as const }
      : { ...plan, state: 'awaiting_approval' as const };

    // Write plan markdown
    const slug = args.intent.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const filePath = join('docs', 'plans', `cesar-${Date.now()}-${slug}.md`);
    mkdirSync(join('docs', 'plans'), { recursive: true });
    writeFileSync(filePath, formatCesarPlanMarkdown(withPlanning));

    const finalPlan = { ...withPlanning, planFilePath: filePath };

    // Show plan to user
    dispatch({ type: 'plan-proposal' as any, plan: finalPlan, markdown: formatCesarPlanMarkdown(finalPlan) });

    return finalPlan;
  >>>

fn name=buildStepExecutors params="ctx:HandlerContext" returns="Record<string,StepExecutor>" export=true
  doc "Create step executors that map plan step types to orchestration functions."
  handler <<<
    const cwd = resolveWorkingDir();
    const outputDir = join(RUNS_DIR, `plan-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });

    const wrapExecutor = (fn: (step: CesarPlanStep, context: Record<string,string>, signal?: AbortSignal) => Promise<{result: CesarStepResult, contextExport?: string}>): StepExecutor => ({ execute: fn });

    return {
      self: wrapExecutor(async (step, context, signal) => {
        const startTime = Date.now();
        // Self steps: Cesar reads/analyzes — for now, return the description as output
        // In full implementation, this would dispatch to Cesar's session for analysis
        return {
          result: { status: 'success', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: `Self step completed: ${step.description}` },
          contextExport: step.description,
        };
      }),

      forge: wrapExecutor(async (step, context, signal) => {
        const startTime = Date.now();
        const contextStr = (step.imports ?? []).map((k: string) => context[k] ? `## ${k}\n${context[k]}` : '').filter(Boolean).join('\n\n');
        const task = contextStr ? `${step.description}\n\n${contextStr}` : step.description;

        try {
          const manifest = await runForge(
            { task, fitnessCmd: step.fitnessCmd ?? 'echo "no fitness"', cwd, forgeDir: join(outputDir, step.id), engines: step.engines, signal },
            ctx.registry,
            ctx.adapter,
          );
          const totalTokens = (manifest.dispatchLog ?? []).reduce((s: number, m: any) => s + (m.tokens?.prompt ?? 0) + (m.tokens?.response ?? 0), 0);
          const totalCost = (manifest.dispatchLog ?? []).reduce((s: number, m: any) => s + (m.tokens?.costUsd ?? 0), 0);
          return {
            result: {
              status: manifest.winner ? 'success' : 'failure',
              actualTokens: totalTokens,
              actualCostUsd: totalCost,
              durationMs: Date.now() - startTime,
              output: manifest.winner ? `Winner: ${manifest.winner}` : 'No winner',
              error: manifest.winner ? undefined : 'Forge produced no winner',
            },
            contextExport: manifest.winner ? `Forge winner: ${manifest.winner}` : undefined,
          };
        } catch (err) {
          return { result: { status: 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
        }
      }),

      brainstorm: wrapExecutor(async (step, context, signal) => {
        const startTime = Date.now();
        const contextStr = (step.imports ?? []).map((k: string) => context[k] ? `## ${k}\n${context[k]}` : '').filter(Boolean).join('\n\n');
        const question = contextStr ? `${step.description}\n\n${contextStr}` : step.description;

        try {
          const result = await runBrainstorm({ question, engines: step.engines ?? [], registry: ctx.registry, adapter: ctx.adapter, timeout: 120, outputDir: join(outputDir, step.id), signal });
          return {
            result: { status: 'success', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: `Winner: ${result.winner}\n${result.response}` },
            contextExport: result.response,
          };
        } catch (err) {
          return { result: { status: 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
        }
      }),

      tribunal: wrapExecutor(async (step, context, signal) => {
        const startTime = Date.now();
        const contextStr = (step.imports ?? []).map((k: string) => context[k] ? `## ${k}\n${context[k]}` : '').filter(Boolean).join('\n\n');
        const question = contextStr ? `${step.description}\n\n${contextStr}` : step.description;

        try {
          const result = await runTribunal({ question, engines: step.engines ?? [], rounds: 2, mode: step.tribunalMode as any, registry: ctx.registry, adapter: ctx.adapter, timeout: 120, outputDir: join(outputDir, step.id) });
          return {
            result: { status: 'success', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: result.summary },
            contextExport: result.summary,
          };
        } catch (err) {
          return { result: { status: 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
        }
      }),

      campfire: wrapExecutor(async (step, context, signal) => {
        const startTime = Date.now();
        try {
          const result = await runCampfire({ topic: step.description, engines: step.engines ?? [], registry: ctx.registry, adapter: ctx.adapter, strategy: 'all-respond', timeout: 120, outputDir: join(outputDir, step.id), signal });
          const summary = result.rounds.map((r: any) => `${r.engineId}: ${r.content.slice(0, 200)}`).join('\n');
          return {
            result: { status: 'success', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: summary },
            contextExport: summary,
          };
        } catch (err) {
          return { result: { status: 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
        }
      }),

      delegate: wrapExecutor(async (step, context, signal) => {
        const startTime = Date.now();
        const contextStr = (step.imports ?? []).map((k: string) => context[k] ? `## ${k}\n${context[k]}` : '').filter(Boolean).join('\n\n');
        const task = contextStr ? `${step.description}\n\n${contextStr}` : step.description;

        try {
          const result = await runDelegate({ engineId: step.engine ?? step.engines?.[0] ?? 'claude', task, registry: ctx.registry, adapter: ctx.adapter, timeout: 120, outputDir: join(outputDir, step.id), signal });
          const tokenCount = result.usage ? result.usage.totalTokens : 0;
          return {
            result: { status: 'success', actualTokens: tokenCount, actualCostUsd: 0, durationMs: Date.now() - startTime, output: result.response },
            contextExport: result.response,
          };
        } catch (err) {
          return { result: { status: 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
        }
      }),

      teamforge: wrapExecutor(async (step, context, signal) => {
        // TeamForge is forge with hardened=true
        const startTime = Date.now();
        const contextStr = (step.imports ?? []).map((k: string) => context[k] ? `## ${k}\n${context[k]}` : '').filter(Boolean).join('\n\n');
        const task = contextStr ? `${step.description}\n\n${contextStr}` : step.description;
        try {
          const manifest = await runForge(
            { task, fitnessCmd: step.fitnessCmd ?? 'echo "no fitness"', cwd, forgeDir: join(outputDir, step.id), engines: step.engines, hardened: true, signal },
            ctx.registry,
            ctx.adapter,
          );
          return {
            result: { status: manifest.winner ? 'success' : 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: manifest.winner ? `Winner: ${manifest.winner}` : 'No winner' },
            contextExport: manifest.winner ? `TeamForge winner: ${manifest.winner}` : undefined,
          };
        } catch (err) {
          return { result: { status: 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
        }
      }),

      pipeline: wrapExecutor(async (step, context, signal) => {
        // Pipeline = brainstorm → forge → tribunal
        const startTime = Date.now();
        return { result: { status: 'success', actualTokens: 0, actualCostUsd: 0, durationMs: Date.now() - startTime, output: 'Pipeline step placeholder' } };
      }),
    };
  >>>
```

- [ ] **Step 2: Compile, build, test**

```bash
npx kern compile packages/cli/src/kern/handlers-plan-mode.kern --outdir=packages/cli/src/generated
npm run build
npm run test
```

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/kern/handlers-plan-mode.kern packages/cli/src/generated/handlers-plan-mode.ts
git commit -m "feat(cesar-plan): add plan mode handler with step executors"
```

---

### Task 8: Wire Everything Together + Integration

**Files:**
- Modify: `packages/cli/src/kern/app-dispatch.kern` (handle ProposePlan, approval loop)
- Modify: `packages/cli/src/kern/app-output.kern` (render plan-proposal event)
- Modify: `packages/cli/src/kern/ui-app.kern` (pass activePlan through context)

This task wires the ProposePlan tool call interception in cesar-brain/buildOnToolCall to create the plan, show it, handle approval, and kick off execution. This is the integration task that connects Tasks 1-7.

- [ ] **Step 1: In app-dispatch.kern, wire the plan-task intent**

Update the `plan-task` case to:
1. Set activePlan on the context
2. Dispatch to Cesar with plan mode active
3. When Cesar calls ProposePlan, intercept it in buildOnToolCall
4. Show plan, ask for approval
5. On Y: execute via executePlan
6. On N: cancel
7. On text: send feedback to Cesar for revision

- [ ] **Step 2: In app-output.kern, handle plan-proposal event**

Render the plan markdown and show the approval prompt.

- [ ] **Step 3: In ui-app.kern, pass activePlan to handler context**

Add `activePlan` and `setActivePlan` to the HandlerContext builder.

- [ ] **Step 4: Compile all, build, test**

```bash
npx kern compile packages/cli/src/kern/app-dispatch.kern --outdir=packages/cli/src/generated
npx kern compile packages/cli/src/kern/app-output.kern --outdir=packages/cli/src/generated
npx kern compile packages/cli/src/kern/ui-app.kern --outdir=packages/cli/src/generated
npm run build
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add -u packages/
git commit -m "feat(cesar-plan): wire plan mode end-to-end — intent to execution"
```

---

### Task 9: Save/Load Plans + Resume

**Files:**
- Modify: `packages/core/src/kern/cesar-plan.kern` (add saveCesarPlan, loadCesarPlan)
- Modify: `packages/cli/src/kern/app-dispatch.kern` (handle /plan resume)

- [ ] **Step 1: Add plan persistence functions**

In `cesar-plan.kern`, add:
```kern
fn name=saveCesarPlan params="plan:CesarPlan" returns=void export=true
  handler <<<
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(process.env.HOME ?? '', '.agon', 'runs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${plan.id}.json`), JSON.stringify(plan, null, 2));
    // Also update markdown if path exists
    if (plan.planFilePath) {
      const { formatCesarPlanMarkdown } = await import('./cesar-plan-formatter.js');
      writeFileSync(plan.planFilePath, formatCesarPlanMarkdown(plan));
    }
  >>>

fn name=loadCesarPlan params="planId:string" returns="CesarPlan|null" export=true
  handler <<<
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const path = join(process.env.HOME ?? '', '.agon', 'runs', `${planId}.json`);
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return null;
    }
  >>>
```

- [ ] **Step 2: Handle /plan resume**

In app-dispatch.kern, add handling for `/plan resume` to reload and continue execution.

- [ ] **Step 3: Compile, build, test, commit**

```bash
npx kern compile packages/core/src/kern/cesar-plan.kern --outdir=packages/core/src/generated
npm run build && npm run test
git add -u packages/
git commit -m "feat(cesar-plan): add plan persistence and /plan resume"
```

---

### Task 10: Full Test Suite + Manual Verification

- [ ] **Step 1: Run full test suite**
```bash
npm run test
npm run typecheck
```

- [ ] **Step 2: Manual test**

Start agon, type `/plan add rate limiting to the API`. Verify:
- Cesar enters plan mode (brainstorms/tribunals to think)
- Cesar calls ProposePlan with structured steps
- Plan markdown written to docs/plans/
- User sees plan with costs and approval prompt
- Y starts execution, N cancels, text revises

- [ ] **Step 3: Final commit if needed**
