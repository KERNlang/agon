# Plan: Speculative Execution Cost-Gating

**Branch:** `kimi-cesar`  
**Goal:** Make Cesar's speculative execution (scout-then-agent-team) cost-aware so it only fires when the expected value justifies the spend.

---

## Background

Agon already has:
- `PlanCostEstimator` — estimates tokens/cost per step type from historical averages
- `Speculator` — runs parallel agents over VirtualFS and picks a winner
- `AgonConfig` — user-tunable knobs
- ELO/Glicko ratings per engine per task class

What's missing: **the wiring that prevents speculation on cheap/sure tasks**.

---

## Changes

### 1. Config Knobs (`packages/core/src/kern/models/types.kern`)

Add to `AgonConfig`:

```
field name=speculativeThresholdUsd type=number default=0.50
  doc "Max estimated USD cost for a single plan step below which speculation is skipped. Scout+team costs more than this → stay solo."
field name=speculativeEloSpreadThreshold type=number default=15
  doc "Min ELO spread between top two engines for a task class. Below this, engines are too close to call — speculation is worthwhile. Above it, the leader is clear enough to skip speculation."
```

### 2. Cost-aware Routing (`packages/cli/src/kern/cesar/routing.kern`)

Extend `CesarRoutingHints`:
```
field name=estimatedStepCost type=CostEstimate optional=true
field name=eloSpread type=number optional=true
```

In `deriveRoutingHints`:
- Import `PlanCostEstimator`
- For the recommended step type (e.g. `self` → `agent` if fanout), call `planCostEstimator.estimate(stepType, engines)`
- Compute ELO spread: `topEngine.mu - secondEngine.mu` from `getRatings().byTaskClass[taskClass]`
- Attach both to hints

In `buildRoutingContext`:
- Print `ESTIMATED COST: $0.42 (self) | $1.20 (team)` in the routing context string
- Print `ELO SPREAD: 23 (claude clear leader)`

### 3. ELO Speculation Gate (`packages/cli/src/kern/cesar/brain.kern`)

Add `shouldSpeculate(input, ctx, hints)`:

```typescript
function shouldSpeculate(hints, config) {
  const cost = hints.estimatedStepCost;
  if (!cost || cost.costUsd < config.speculativeThresholdUsd) return false; // too cheap
  if (hints.uncertaintyFamily === 'none' || hints.escalationHint === 'self') return false; // too sure
  if (hints.eloSpread && hints.eloSpread > config.speculativeEloSpreadThreshold) return false; // clear leader
  return true; // borderline confidence + close engines + not trivially cheap
}
```

Wire into Cesar's decision flow: when `shouldSpeculate` is false, override any `team` recommendation to `solo` and skip scout bids.

### 4. Tests (`tests/unit/cesar-routing.test.ts`)

Add cases:
- `$0.10 task → shouldSpeculate = false`
- `$2.00 task, ELO spread 8 → shouldSpeculate = true`
- `$2.00 task, ELO spread 25 → shouldSpeculate = false`
- `uncertaintyFamily=none → shouldSpeculate = false`

### 5. Plan Persistence Integration (`packages/core/src/kern/cesar/plan.kern`)

Ensure `CesarPlanStep` can carry `estimatedCostUsd` and `eloSpread` so plan proposals show the cost-aware rationale.

---

## Verification

After each step:
```bash
npm run typecheck
vitest run tests/unit/cesar-routing.test.ts
```

---

## Rollout

1. Config knobs + defaults
2. Cost estimation in routing hints
3. `shouldSpeculate()` + brain wiring
4. Tests + plan schema update
5. Integration test: run a cheap task, verify no speculation; run an expensive borderline task, verify speculation fires
