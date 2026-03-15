# v2 Phase 1: Typed Plan Model

> "The piece that turns it into something shippable is a strict plan/execution contract." — Codex

## What

A `Plan` is the atomic unit of work in Agon v2. Every forge, build, brainstorm, and multi-repo task produces a Plan before execution.

## Why

Currently, commands execute immediately. There's no way to:
- Preview what will happen before it happens
- Approve or reject steps
- Resume after failure
- Track what was done across sessions
- Estimate cost before spending tokens

## Plan Model

```typescript
interface Plan {
  id: string;                    // unique plan ID
  createdAt: number;
  status: 'draft' | 'approved' | 'running' | 'done' | 'failed' | 'paused';

  // What
  intent: string;                // original user input
  mode: 'forge' | 'brainstorm' | 'tribunal' | 'campfire' | 'build';

  // Where
  tasks: PlanTask[];

  // Cost
  estimatedTokens: number;
  estimatedCost: number;
  actualTokens?: number;
  actualCost?: number;

  // Approval
  approvalLevel: 'plan' | 'task' | 'write' | 'none';
}

interface PlanTask {
  id: string;
  description: string;
  workspace: string;             // workspace ID
  engineId?: string;             // assigned engine (or null = auto)
  dependsOn: string[];           // task IDs this depends on
  status: 'pending' | 'approved' | 'running' | 'done' | 'failed' | 'skipped';

  // Results
  output?: string;
  score?: number;
  tokensUsed?: number;
}
```

## Approval Levels

| Level | What happens |
|-------|-------------|
| `none` | Caesar plans + executes everything automatically |
| `plan` | Show the full plan, approve once, all tasks run |
| `task` | Approve each task individually before it runs |
| `write` | Auto-run read-only tasks, approve writes/forge |

Default: `plan` (show plan, approve once).

## Flow

```
User: "fix the parser bug in kern-lang"
                ↓
Caesar splits into Plan:
  Plan #a1b2c3
  Mode: forge
  Tasks:
    1. [kern-lang] Scan codebase for parser issues
    2. [kern-lang] Forge fix (3 engines compete)
    3. [kern-lang] Run tests to verify
  Est. cost: ~$0.08

  Approve? [Y/n/edit]
                ↓
User: Y
                ↓
Execute tasks sequentially
                ↓
Plan #a1b2c3: done ✓
  Actual cost: $0.06
  Winner: claude (score: 87)
```

## Multi-Repo Plan

```
User: "fix parser in kern and update agon to match"
                ↓
Caesar splits:
  Plan #x4y5z6
  Tasks:
    1. [kern-lang] Fix parser bug           → claude
    2. [kern-lang] Run tests                → (local, free)
    3. [agon-ai]   Update context scanner   → codex (depends on #1)
    4. [agon-ai]   Run tests                → (local, free)
  Est. cost: ~$0.12

  Approve? [Y/n/edit]
```

## Files to Create

| File | Purpose |
|------|---------|
| `packages/core/src/plan.ts` | Plan + PlanTask interfaces, create/update/persist |
| `packages/core/src/plan-store.ts` | Save/load plans to ~/.agon/plans/ |
| `packages/cli/src/plan-display.ts` | Render plans in terminal (reuse scoreboard) |

## Files to Modify

| File | Change |
|------|--------|
| `packages/cli/src/repl.ts` | Wrap forge/brainstorm/build handlers in Plan creation |
| `packages/cli/src/intent.ts` | Add `/plan`, `/plans`, `/approve`, `/reject` commands |
| `packages/core/src/types.ts` | Add `approvalLevel` to AgonConfig |

## Implementation Steps

1. Create Plan + PlanTask types in `plan.ts`
2. Create PlanStore (save/load to ~/.agon/plans/)
3. Create plan display (terminal rendering)
4. Add `/plan` and `/plans` commands
5. Wrap `handleForge` in plan flow: create plan → display → approve → execute
6. Add approval levels to config + onboarding
7. Extend to brainstorm and build-with-plan
8. Add plan resume (`/plan resume <id>`)

## Verification

- `npm test` — existing 39 tests still pass
- Manual: forge creates a plan, shows it, waits for approval
- Manual: `/plans` lists past plans
- Manual: `/plan resume <id>` resumes a paused plan
