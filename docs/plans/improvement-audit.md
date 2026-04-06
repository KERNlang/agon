# Agon Improvement Audit — Synthesized Plan

**Status:** Active  
**Created:** 2026-04-06  
**Branch:** feat/agent-mode

## Verdict: Strong Foundation, Needs Hardening Before Expansion

The architecture is genuinely solid — KERN-first core logic, clear orchestration modes, sidechain logging, ELO/memory, and meaningful test surface. The weak spots are operational reliability and data-driven validation, not concept or feature breadth.

**Shipping more features before consolidation is the #1 risk right now.**

---

## Phase 1: Freeze & Diagnose (Days 1-2)

### 1a. Bug Triage

- Freeze `docs/task-a-bugs.md` — reproduce every bug, tag severity (P0-P3)
- Cross-reference against recent feat/agent-mode commits to identify which are already fixed
- Deliverable: Ranked bug backlog with file-level evidence

### 1b. Coverage Gap Analysis

```bash
vitest --coverage
```

- Focus on `packages/core` — especially the Nero escalation ladder and Cesar efficiency gate
- Current ratio (2 integration tests vs ~35 unit tests) is a red flag; integration gaps are where production failures hide
- Deliverable: List of untested branches with one concrete failing scenario per finding

### 1c. Engine Config Audit

- Walk every `engine/*.json` for schema consistency
- Verify required fields (endpoint, auth, modelDefaults) are present and validated at load time
- Current JSON configs lack runtime validation → silent failures at runtime
- Deliverable: Documented schema gaps and invalid configs

---

## Phase 2: Hardening (Days 3-5)

### 2a. Zod-Validated Engine Registry

Define Zod schemas for engine configs in `packages/core/src/schemas/engine.ts`:

- Fields: `baseUrl`, `apiKey`, `model`, `capabilities`, `costPerToken`
- Create a typed engine registry class that:
  - Validates JSON configs on load (kills silent failures)
  - Exports `getEngine<T>(id)` with full type inference
  - Enables IDE autocomplete for config authors

**Tradeoff:** Adds a dependency and stricter configs may break existing setups. Worth it — silent failures are worse than loud ones.

### 2b. Integration Test Battery

Write failing integration tests first for these specific seams:

1. Stream abort cleanup
2. Per-engine timeout isolation
3. Output directory creation
4. Config corruption handling
5. Manifest/history writes
6. Agent handover points (Nero ↔ Cesar transitions)

**Target:** bring integration test count to parity with unit tests.

### 2c. KERN Orchestration Boundary

- Remove silent failure paths (every catch block must warn or log)
- Make writes atomic (manifest, sidechain logs)
- Ensure one slow/broken engine cannot stall the whole session
- Walk CLI dispatch path end-to-end: adapter-cli → core → engine selection → response — document every failure mode

---

## Phase 3: Data-Driven Calibration (Days 6-8)

### 3a. Orchestration Benchmark

1. Extract successful task traces from `persistent-session.ts` logs → create a baseline Intent Library
2. Build a scoring engine in `packages/forge` that measures agent performance vs. token consumption
3. Instrument the forge loop so manifests and sidechain logs answer: Is the starter heuristic, close-call threshold, synthesis step, and scoring weights actually choosing the best engine?
4. Refine `task-classifier.ts` thresholds using collected data
5. Add `tests/integration/scoring.test.ts` targeting agent handover points

### 3b. Cost-Aware Fallback Orchestration

- Implement try-engine-with-cost-tracking logic
- Add `inferResponseSchema<T>()` utility — use first successful response to auto-generate Zod types
- CLI displays Dispatch Confidence metrics explaining why a specific agent/engine was chosen

### 3c. Tune Constants from Data

- Adjust `DEFAULT_WEIGHTS`, winner selection, and routing heuristics from observed data
- Rerun the full audit to confirm fixes improved pass rate, latency, and trustworthiness

---

## Phase 4: Validation Gate

Before merging feat/agent-mode or shipping new features:

```bash
vitest --coverage
# KERN check
```

### Checklist

- [ ] All P0 bugs closed with regression tests
- [ ] Integration test count ≥ unit test count
- [ ] Engine configs validated at load time (zero silent failures)
- [ ] Orchestration benchmark shows Nero auto-activation provides measurable accuracy gain
- [ ] Orchestration benchmark shows Cesar tracing provides measurable cost-efficiency gain
- [ ] One slow engine cannot stall a session (verified by timeout isolation test)
- [ ] CLI dispatch path has zero silent catch blocks

---

## Ranked Backlog

| Finding | Axis | Impact | Effort | Owner | Status |
|---|---|---|---|---|---|
| Silent engine config failures | Reliability | High | Low | core | ☐ |
| 2 integration tests for 35 paths | Coverage | High | Med | qa | ☐ |
| Untested Nero escalation ladder | Coverage | High | Med | core | ☐ |
| No empirical dispatch validation | Calibration | Med | High | forge | ☐ |
| No cost-aware fallback | Efficiency | Med | Med | orchestrator | ☐ |
| Zod schemas for configs | DX | Med | Low | core | ☐ |
