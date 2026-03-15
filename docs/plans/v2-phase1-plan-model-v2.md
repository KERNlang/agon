# v2 Phase 1: Typed Plan Model (Revised)

> Incorporates Codex + Gemini review feedback. Scoped to forge + build only.

## Scope: Forge + Build ONLY

Brainstorm, tribunal, campfire don't need approval or plans. They're read-only.
Plans exist for code-changing operations: forge and build-with-engine.

## Types

```typescript
// ── Step kinds ──────────────────────────────────────────────────────

type PlanStepKind = 'scan' | 'forge' | 'build' | 'test' | 'shell';

type StepEffect = 'read' | 'write' | 'exec';

// ── Plan ────────────────────────────────────────────────────────────

interface Plan {
  id: string;
  version: number;                    // increments on edit
  createdAt: number;
  approvedAt?: number;                // frozen at approval
  state: PlanState;
  intent: string;                     // original user input
  mode: 'forge' | 'build';

  // Frozen at approval — can't change after user says Y
  configSnapshot: {
    engines: string[];
    approvalLevel: ApprovalLevel;
    timeout: number;
    caesarModel: string;
  };

  steps: PlanStep[];

  // Cost
  estimatedCost: { min: number; max: number };  // range, not single number
  actualCost: number;
}

type PlanState =
  | 'draft'
  | 'awaiting_approval'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled';

type ApprovalLevel = 'plan' | 'task' | 'write' | 'none';

// ── Step ────────────────────────────────────────────────────────────

interface PlanStep {
  id: string;
  kind: PlanStepKind;
  effect: StepEffect;                 // determines auto-approve for 'write' level
  description: string;

  // What to execute — discriminated by kind
  action: PlanAction;

  // Where
  workspace: WorkspaceSnapshot;

  // Dependencies
  dependsOn: string[];                // step IDs

  // State
  state: StepState;
  attempts: StepAttempt[];
  result?: StepResult;
  artifacts: ArtifactRef[];
}

type StepState =
  | 'pending'
  | 'blocked'                         // waiting on dependsOn
  | 'awaiting_approval'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped';

// ── Actions (discriminated union) ───────────────────────────────────

type PlanAction =
  | { type: 'scan'; target: string }
  | { type: 'forge'; task: string; fitnessCmd: string; engines: string[] }
  | { type: 'build'; task: string; engineId: string }
  | { type: 'test'; command: string }
  | { type: 'shell'; command: string };

// ── Workspace snapshot (frozen at plan creation) ────────────────────

interface WorkspaceSnapshot {
  id: string;
  path: string;
  headSha: string;
  branch: string;
  dirty: boolean;
}

// ── Results ─────────────────────────────────────────────────────────

interface StepResult {
  status: 'success' | 'failure';
  output: string;
  data?: ForgeManifest | Record<string, unknown>;  // structured results
  tokensUsed: number;
  cost: number;
  durationMs: number;
  error?: string;
}

interface StepAttempt {
  attemptNumber: number;
  startedAt: number;
  finishedAt: number;
  result: StepResult;
}

interface ArtifactRef {
  type: 'patch' | 'manifest' | 'output' | 'worktree';
  path: string;
}
```

## Approval Flow

```
ApprovalLevel: 'plan'
  → Show full plan → approve once → all steps run

ApprovalLevel: 'task'
  → Show full plan → approve each step before it runs

ApprovalLevel: 'write'
  → Auto-run steps where effect='read' (scan, test)
  → Pause for approval on effect='write' or 'exec' (forge, build, shell)

ApprovalLevel: 'none'
  → Run everything (Caesar decides)
```

## Execution Flow

```
1. User: "fix the parser bug"
2. Caesar creates Plan (state: draft)
   - step 1: scan (read) → detect issue
   - step 2: forge (write) → 3 engines compete
   - step 3: test (read) → verify fix
3. Plan → state: awaiting_approval
4. Display plan with cost estimate range
5. User: approve
6. Plan → state: running, approvedAt frozen
7. Execute steps respecting dependsOn order
8. Each step: pending → running → done/failed
9. On failure: plan → paused (user can retry/skip/cancel)
10. All done: plan → done, actual cost recorded
```

## Resume Semantics

Resume = re-execute from the first non-done step. NOT replay.
- Done steps keep their results
- Failed steps get a new attempt (attempts[] grows)
- Artifacts from previous attempts are preserved
- Workspace snapshot checked: if HEAD changed since approval, warn

## Files to Create

| File | Purpose |
|------|---------|
| `packages/core/src/plan.ts` | Plan, PlanStep, PlanAction types + createPlan(), advanceStep() |
| `packages/core/src/plan-store.ts` | Save/load plans as JSON in ~/.agon/plans/{id}.json |
| `packages/cli/src/plan-display.ts` | Render plan in terminal: tree view with step status |

## Files to Modify

| File | Change |
|------|--------|
| `packages/cli/src/intent.ts` | Add /plan, /plans, /approve, /retry, /cancel |
| `packages/cli/src/repl.ts` | Wrap handleForge + handleBuildWithPlan in plan creation |
| `packages/core/src/types.ts` | Add approvalLevel to AgonConfig, default 'plan' |
| `packages/core/src/workspace.ts` | Add snapshotWorkspace() → WorkspaceSnapshot |
| `packages/core/src/index.ts` | Export new plan types + functions |

## Build Sequence

| Step | Task | Gate |
|------|------|------|
| 1 | Create types in plan.ts | tsc |
| 2 | Create plan-store.ts (save/load) | tsc |
| 3 | Add snapshotWorkspace() to workspace.ts | tsc |
| 4 | Create plan-display.ts (terminal renderer) | tsc |
| 5 | Add /plan commands to intent.ts | tsc |
| 6 | Wrap handleForge in plan flow | npm test |
| 7 | Wrap handleBuildWithPlan in plan flow | npm test |
| 8 | Add approval level to config + onboarding | npm test |
| 9 | Add /plan resume | manual test |

## What This Does NOT Cover (later phases)

- Multi-repo plans (Phase 2 — needs serial execution first)
- Caesar as task splitter (Phase 3 — needs Plan model first)
- Parallel step execution (Phase 4 — after serial is solid)
- Brainstorm/tribunal/campfire plans (never — they're read-only)
