# Cesar Plan Mode

**Date:** 2026-04-08
**Status:** Design approved

## Problem

Cesar (Agon's AI orchestrator) currently routes tasks based on confidence thresholds and executes immediately — forge, brainstorm, tribunal, delegate all fire without the user seeing what's about to happen or what it will cost. There's no way to see Cesar's strategy before he spends tokens, no way to adjust engine choices, and no visibility into per-operation cost.

Additionally, token tracking is based on rough estimates (4 chars/token) — real API usage metadata from the Vercel AI SDK is discarded.

## Solution

### Part 1: Real Token Capture

**Extend DispatchResult with usage data.**

Currently `DispatchResult` is: `{ exitCode, stdout, stderr, durationMs, timedOut }`. Add an optional `usage` field with provenance tracking:

```typescript
interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  source: 'sdk' | 'cli-reported' | 'estimated';  // how we got these numbers
}

interface DispatchResult {
  // ... existing fields
  usage?: TokenUsage;
}
```

**Provenance matters.** SDK numbers are exact. CLI-reported numbers are parsed from stderr (best-effort). Estimated numbers are the old 4-chars/token fallback. Cost display should indicate confidence: "$0.35" (sdk) vs "~$0.35" (estimated).

**Capture from Vercel AI SDK.** In `apiDispatch()` (`packages/core/src/kern/api-dispatch.kern`), the `generateText` and `streamText` responses include `result.usage`. Extract and include in the return:

```typescript
return {
  exitCode: 0,
  stdout: text,
  stderr: '',
  durationMs,
  timedOut: false,
  usage: result.usage ? {
    promptTokens: result.usage.promptTokens,
    completionTokens: result.usage.completionTokens,
    totalTokens: result.usage.totalTokens,
    source: 'sdk',
  } : undefined,
};
```

**CLI adapter: best-effort parsing.** Some CLI tools emit usage in stderr or structured output. Parse when available (source: `cli-reported`), fall back to estimation (source: `estimated`).

**TokenTracker update.** Unify `record()` to accept either real usage or text:
```typescript
record(engineId: string, opts: { usage: TokenUsage } | { prompt: string, response: string }): void
```
When real usage is provided, use it directly. When text is provided, estimate as before but mark source as `estimated`. All existing calls migrate to the text form (backwards compatible via overload).

**Cost estimation by model, not just engine.** Stop pricing by `engineId` alone — the same engine can use different models (e.g., claude with Haiku vs Opus). Add optional `model` field to TokenUsage. The pricing table maps `model` → cost, falling back to `engineId` → cost for CLI engines where model is unknown.

### Part 2: Plan Mode

**Entering plan mode — per-request, not a sticky toggle:**
- `/plan <task>` — enters plan mode for this specific task. Cesar plans it, proposes, you approve/reject, then plan mode ends. No hidden state.
- `/plan` (no args) — shows the current or most recent plan (existing behavior preserved)
- Auto-suggest: Cesar can SUGGEST planning when a task is complex, but does NOT auto-enter. He says "This looks like it needs a plan. Want me to plan it first?" and the user confirms.

**Auto-suggest heuristics** (concrete criteria):
- Task would trigger multi-engine orchestration (forge, brainstorm, tribunal, pipeline)
- Cesar's confidence is below 88% (the delegation threshold)
- Task description mentions multiple files, modules, or components
- Cesar does NOT silently enter plan mode — he suggests and the user confirms

**Session state:** New `activePlan: CesarPlan | null` on the app state. Plan mode is active when `activePlan` is not null and its state is `planning` or `awaiting_approval`. No separate boolean toggle.

**Intent detection:** `/plan` already exists in `intent.kern`. Extend: `/plan <text>` creates a new plan. `/plan` with no args shows current/recent plan.

**Cesar's behavior during planning:**

When a plan is active in `planning` state, Cesar gets an additional system prompt rule:

```
RULE 8 — PLAN MODE: You are planning a task. Your goal is to produce the best possible plan, 
then propose it with ProposePlan. 

ALLOWED: Brainstorm, Campfire, Tribunal, Delegate, Read, Grep, Glob, Bash (read-only), 
ReportConfidence, ProposePlan. Use these freely to analyze the task and build your strategy.

BLOCKED: Forge, Pipeline, Edit, Write. No code execution until the plan is approved.

Think deeply. Use other engines to challenge your approach. Then propose a structured plan.
```

**Allowed tools (thinking):** Brainstorm, Campfire, Tribunal (all modes), Delegate, Read, Grep, Glob, ReportConfidence, ProposePlan.

**Blocked tools (execution):** Forge, Pipeline, Edit, Write.

**Bash handling:** Bash is allowed but validated at runtime — read-only commands (`ls`, `cat`, `git log`, `git diff`, `npm test --dry-run`) are permitted. Write commands (`rm`, `mv`, `git commit`, `npm install`) are blocked. Uses the existing `isReadOnlyCommand()` check from `tool-permissions.kern`.

The key insight: Cesar uses his full orchestration power to THINK (brainstorm approaches, tribunal to stress-test, delegate for specialist analysis) but cannot EXECUTE (no forge, no file writes, no code changes).

**Planning budget awareness:** The planning phase (brainstorm/tribunal/delegate to think) has a soft budget. If planning cost exceeds $1.00, Cesar warns: "Planning has used $X so far. Should I wrap up and propose now?" This prevents runaway planning on expensive tasks.

**Exiting plan mode:**
- Plan completes (all steps done) → auto-exits
- `/cancel` aborts the current plan and clears `activePlan`
- User rejects the proposal (N) → plan dropped, auto-exits
- No sticky toggle to forget about

### Part 3: Plan Structure & ProposePlan Tool

**ProposePlan tool** — new Cesar tool that outputs a structured execution plan.

**Tool definition:**
```typescript
ProposePlan({
  intent: string,              // what the user asked for
  planningCost: {              // what Cesar spent thinking (informational)
    tokens: number,
    costUsd: number,
  },
  steps: PlanStep[],
  totalEstimatedTokens: number,
  totalEstimatedCostUsd: number,
})
```

**PlanStep:**
```typescript
interface PlanStep {
  id: string;
  type: 'self' | 'forge' | 'teamforge' | 'delegate' | 'brainstorm' | 'campfire' | 'tribunal' | 'pipeline';
  description: string;
  
  // Engine assignment — who does what
  engines?: string[];           // engine IDs (for multi-engine steps)
  engine?: string;              // single engine (for delegate)
  
  // Type-specific
  fitnessCmd?: string;          // forge/teamforge fitness test
  tribunalMode?: string;        // adversarial, socratic, red-team, etc.
  parallel?: boolean;           // can run alongside other steps
  dependsOn?: string[];         // step IDs that must complete first
  
  // Context flow — how steps share knowledge
  exports?: string;             // what this step produces (summary key for downstream steps)
  imports?: string[];           // exports from prior steps this step needs as context
  
  // Cost estimate
  estimatedTokens: number;
  estimatedCostUsd: number;
}
```

**Cost estimation is not guesswork.** The plan executor includes a `PlanCostEstimator` that uses historical TokenTracker data: average tokens per forge (by engine count), per brainstorm, per tribunal mode, per delegate. Cesar calls the estimator when building the plan — he doesn't invent numbers.

**Step types explained:**
- `self` — Cesar does it himself (read code, analyze, write directly)
- `forge` — multi-engine competition, engines work independently, best wins
- `teamforge` — collaborative forge, engines build on each other
- `delegate` — single engine subtask, result returns to Cesar
- `brainstorm` — multi-engine confidence bidding for approach selection
- `campfire` — open multi-engine discussion
- `tribunal` — structured debate/review with specified mode
- `pipeline` — full brainstorm-forge-tribunal chain

### Part 3b: Context Handoff Between Steps

**Problem:** If Step 1 scans the codebase and Step 2 forges an implementation, Step 2 needs Step 1's findings. Without explicit handoff, each step runs blind.

**Solution: `exports` and `imports` fields.**

Each step can declare an `exports` key — a short name for what it produces. The plan executor captures the step's output and summarizes it into a `stepContext` map:

```typescript
stepContext: Record<string, string>  // export key → summarized output
```

Downstream steps declare `imports` — which export keys they need. The executor injects the relevant summaries into the step's prompt as context:

```
## Context from prior steps
### codebase-scan (Step 1)
[summarized findings from Step 1]
```

**Summarization:** Cesar summarizes each step's output into a concise context block (not the raw output — that could be thousands of lines). This is a lightweight Cesar call between steps. The summary is stored in the plan JSON for auditability.

**Example:**
```
Step 1: scan [self] → exports: "codebase-patterns"
Step 2: forge [claude, codex, gemini] → imports: ["codebase-patterns"]
Step 3: tribunal [claude, codex] → imports: ["codebase-patterns"]
```

**Plan saved to disk** — two formats:

1. **Human-readable markdown:** `docs/plans/cesar-<timestamp>-<slug>.md`
2. **Machine-readable JSON:** `~/.agon/runs/plan-<id>.json` (for execution engine)

**Markdown format:**

```markdown
# Plan: Add rate limiting to the API

> Planning cost: 8,500 tokens ($0.07) — brainstorm + tribunal used to evaluate approach

## Steps

### Step 1: Scan codebase [self: Cesar]
Read middleware patterns, find existing rate limit code, check dependencies.
- Tools: Read, Grep, Glob
- Est: ~2k tokens ($0.02)

### Step 2: Implement rate limiter [forge: claude, codex, gemini]
Build rate limiter middleware with sliding window, per-route config, and tests.
- Mode: forge (3 engines compete in parallel)
- Fitness: `npm test`
- Depends on: Step 1
- Est: ~30k tokens ($0.35)

### Step 3: Review implementation [tribunal: claude, codex — adversarial]
Adversarial review checking edge cases, race conditions, failure modes.
- Mode: tribunal (adversarial, 2 rounds)
- Depends on: Step 2
- Est: ~5k tokens ($0.05)

---
**Total estimated: ~37.5k tokens ($0.42)**
**Engines used: claude, codex, gemini**
**Status: awaiting approval**
```

### Part 4: Approval Flow

After Cesar calls ProposePlan, the plan is rendered and the user gets prompted:

```
Approve plan? [Y/n] or give feedback to revise
```

**Three response paths:**

1. **Y (or Enter)** — approve, begin execution
2. **N** — reject, plan dropped, Cesar acknowledges and plan mode exits
3. **Any other text** — treated as feedback. Cesar reads the feedback, revises the plan, calls ProposePlan again. Examples:
   - "use teamforge instead of forge for step 2"
   - "skip the tribunal, just forge it"
   - "too expensive, can you do it with just claude and codex?"
   - "add a campfire step first to discuss the approach"
   - "step 3 should be red-team not adversarial"

The revision loop continues until the user approves or rejects. Each revision updates the plan markdown on disk.

### Part 5: Execution Engine

Once approved, Cesar executes the plan step by step.

**Execution flow:**
1. Plan state changes to `running`
2. For each step (respecting dependency order):
   - Steps with `parallel: true` and no unmet dependencies run simultaneously
   - Progress bar shows: current step, engine(s) active, elapsed time, tokens/cost so far
   - Step results (actual tokens, cost, duration, output summary) are recorded
3. Plan markdown is updated live with actual results after each step completes
4. When all steps complete, plan state changes to `done`

**Step execution — low-level dispatch, not handler reuse.**

The existing handlers (`handleForge`, `handleBrainstorm`, etc.) are user-flow entrypoints — they contain approval prompts, plan management, UI events, and interactive behavior. Calling them from a plan executor would create re-entrancy bugs (nested plans, double approval prompts, conflicting UI state).

Instead, extract **low-level dispatch functions** that both the handlers and the plan executor can call:

```
runForgeCore(task, fitnessCmd, engines, cwd, context, signal) → ForgeManifest
runBrainstormCore(question, engines, context, signal) → BrainstormResult  
runTribunalCore(question, engines, mode, context, signal) → TribunalResult
runCampfireCore(topic, engines, context, signal) → CampfireResult
runDelegateCore(engine, task, mode, signal) → string
```

These are pure orchestration — no UI, no prompts, no plan management. They take inputs, dispatch engines, return results. The existing handlers become thin wrappers that add UI, approval, and plan tracking on top.

**Step type → executor mapping:**
- `self` → Cesar processes directly via a scoped session (Read/Grep/Glob, then synthesize)
- `forge` → `runForgeCore()` with specified engines and fitness command
- `teamforge` → `runForgeCore()` with hardened/team mode
- `delegate` → `runDelegateCore()` to dispatch to the specified engine
- `brainstorm` → `runBrainstormCore()`
- `campfire` → `runCampfireCore()`
- `tribunal` → `runTribunalCore()` with specified mode
- `pipeline` → sequential: `runBrainstormCore()` → `runForgeCore()` → `runTribunalCore()`

**Execution runs from persisted plan state, not Cesar's conversational memory.** The plan JSON is the source of truth. If the session crashes mid-execution, the plan can be resumed from the last completed step.

**Real cost tracking during execution:**
- Each dispatch captures real token usage (Part 1)
- Step actual cost = sum of all dispatches within that step
- Plan total cost = sum of all step costs + planning overhead
- `/tokens` command reflects the real numbers

**Progress display:**
The status bar (same pattern as forge progress) shows:
```
Plan: "Add rate limiting" · Step 2/3 · forge ◆claude: building ◆codex: scoring ◆gemini: done · $0.18 spent
```

**Plan markdown updates live:**
```markdown
### Step 1: Scan codebase [self: Cesar] ✓ done (12s)
...
- Actual: 1,847 tokens ($0.017)

### Step 2: Implement rate limiter [forge: claude, codex, gemini] ● running
- Winner: pending...
```

### Part 6: Failure Handling

**General step failure:** Cesar pauses the plan and reports to the user:
- "Step N failed: [error message]. Continue with remaining steps, retry, or abort?"
- The plan stays in `paused` state until user decides

**Forge-specific failure (no winner):** When a forge step produces no passing engine:
1. Cesar collects the best parts from all engine outputs (diffs, partial passes)
2. Shows the user the raw situation: "Forge step failed — no winner. Here's what each engine produced: [per-engine summary with scores]. Want me to try synthesizing from the best parts, retry with different engines, or abort?"
3. Synthesis only happens if the user asks for it — no auto-Frankencode
4. This convergence behavior is ONLY for forge steps — other step types just report the error directly

**Budget awareness:** Dynamic threshold based on plan size:
- Plans under $1.00 estimated: warn at 2x overrun
- Plans $1.00–$5.00: warn at 1.5x overrun  
- Plans over $5.00: warn at 1.25x overrun
- Hard stop: never exceed 3x estimated without explicit user approval

### Part 6b: Cancellation & Resume

**Mid-step cancellation:** `/cancel` during execution sends abort signal to the active step. The step is marked `cancelled`, remaining steps are marked `skipped`. Plan state becomes `cancelled`. Active engine dispatches receive the abort signal.

**Resume:** If a plan is in `paused` state (from failure), `/plan resume` picks up from the failed step. The plan executor re-reads the plan JSON, skips completed steps, and retries the failed one.

**Crash recovery:** Plan state is persisted to `~/.agon/runs/plan-<id>.json` after every step transition. If agon crashes mid-execution, the plan can be resumed in the next session via `/plan resume`.

### Part 6c: ProposePlan Validation

Before presenting a plan to the user, validate:
- All referenced engines exist and are available (`registry.get()` doesn't throw)
- Dependencies are acyclic (topological sort succeeds)
- Parallel steps don't conflict (no two write-steps targeting the same workspace simultaneously)
- Every step maps to a known executor
- Fitness commands are specified for all forge/teamforge steps
- Cost estimates are non-zero (estimator produced numbers)

If validation fails, Cesar is told to fix the plan before re-proposing.

### Part 7: Files to Create/Modify

**Phase A — Real Token Capture:**

| Action | File | Description |
|--------|------|-------------|
| MODIFY | `packages/core/src/kern/types.kern` | Add `TokenUsage` interface (with `source` + `model` fields), `usage` field to `DispatchResult` |
| MODIFY | `packages/core/src/kern/api-dispatch.kern` | Capture Vercel AI SDK `result.usage` in return value |
| MODIFY | `packages/core/src/kern/token-tracker.kern` | Unify `record()` to accept real usage or text, add model-based pricing |
| MODIFY | `packages/adapter-cli/src/kern/adapter.kern` | Best-effort usage parsing from CLI stderr, source: `cli-reported` |

**Phase B — Low-Level Dispatch Extraction:**

| Action | File | Description |
|--------|------|-------------|
| CREATE | `packages/forge/src/kern/forge-core.kern` | `runForgeCore()` — pure orchestration, no UI/prompts |
| CREATE | `packages/forge/src/kern/brainstorm-core.kern` | `runBrainstormCore()` — pure orchestration |
| CREATE | `packages/forge/src/kern/tribunal-core.kern` | `runTribunalCore()` — pure orchestration |
| CREATE | `packages/forge/src/kern/campfire-core.kern` | `runCampfireCore()` — pure orchestration |
| MODIFY | `packages/cli/src/kern/handlers-forge.kern` | Refactor to thin wrapper over `runForgeCore()` |
| MODIFY | `packages/cli/src/kern/handlers-brainstorm.kern` | Refactor to thin wrapper over `runBrainstormCore()` |
| MODIFY | `packages/cli/src/kern/handlers-tribunal.kern` | Refactor to thin wrapper over `runTribunalCore()` |
| MODIFY | `packages/cli/src/kern/handlers-campfire.kern` | Refactor to thin wrapper over `runCampfireCore()` |

**Phase C — Plan Mode:**

| Action | File | Description |
|--------|------|-------------|
| CREATE | `packages/core/src/kern/cesar-plan.kern` | CesarPlan type, state machine, creation, validation |
| CREATE | `packages/core/src/kern/plan-cost-estimator.kern` | Historical-data-based cost estimation per step type |
| CREATE | `packages/core/src/kern/plan-formatter.kern` | Markdown and JSON serialization of plans |
| CREATE | `packages/core/src/kern/plan-executor.kern` | Step-by-step execution, dependency resolution, context handoff |
| CREATE | `packages/core/src/kern/tool-propose-plan.kern` | ProposePlan tool definition and validation |
| MODIFY | `packages/cli/src/kern/cesar-session.kern` | Add PLAN MODE rule to system prompt, tool blocking logic |
| MODIFY | `packages/cli/src/kern/cesar-tools.kern` | Register ProposePlan tool |
| MODIFY | `packages/cli/src/kern/intent.kern` | Extend `/plan` intent for `/plan <task>` and `/plan resume` |
| MODIFY | `packages/cli/src/kern/app-dispatch.kern` | Route `/plan <task>`, `/plan resume` |
| MODIFY | `packages/cli/src/kern/ui-app.kern` | `activePlan` state, plan approval prompt rendering |
| MODIFY | `packages/cli/src/kern/handler-types.kern` | New output events: `plan-proposal`, `plan-progress`, `plan-step-done` |
| MODIFY | `packages/cli/src/kern/app-output.kern` | Handle new plan output events |
| CREATE | `packages/cli/src/kern/handlers-plan-mode.kern` | Plan mode orchestration: planning dispatch, approval loop, execution |

### Part 8: What This Does NOT Change

- Existing forge/brainstorm/tribunal/campfire behavior outside plan mode — unchanged (handlers become thin wrappers but user-facing behavior is identical)
- The existing `Plan` type used by forge (plan.kern) — separate concern, not touched. CesarPlan is a new type for Cesar's orchestration plans, not a replacement for forge's internal plan tracking
- Normal Cesar chat — stays direct, no plan overhead unless user says `/plan <task>` or Cesar suggests it
- ELO system — not affected

### Part 9: Implementation Phases

This is a large feature. Implementation should be phased:

**Phase A: Real Token Capture** (~4 tasks)
Foundation. Extend DispatchResult, capture Vercel SDK usage, unify TokenTracker. No UX change — `/tokens` just shows better numbers. Can ship independently.

**Phase B: Low-Level Dispatch Extraction** (~4 tasks)
Extract `runForgeCore`, `runBrainstormCore`, `runTribunalCore`, `runCampfireCore` from handlers. Refactor handlers to thin wrappers. All existing tests must pass — behavior unchanged. This is a prerequisite for Phase C but ships independently.

**Phase C: Plan Mode** (~8 tasks)
The main feature. CesarPlan type, ProposePlan tool, plan executor with dependency resolution and context handoff, `/plan <task>` command, approval flow, progress display, failure handling, resume. Depends on Phase A (real costs) and Phase B (low-level dispatch).

Each phase has its own implementation plan and can be reviewed/merged independently.
