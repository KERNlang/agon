# RFC: Dynamic Engine Pool Management

## Problem
The engine pool is static. Engines like Qwen (2% win rate) and Codex (13%) remain in the pool despite consistent underperformance. Newcomers like Kimi (50%, ~2 tasks) have no structured path to prove themselves before graduating to full competition.

## Proposal

### 1. Probation Bucket
- New engines start in **probation**.
- They only receive tasks when:
  - No lead/specialist engine bid above a confidence threshold (e.g., 70), OR
  - The task class is "other" and complexity is "plain-chat" (low-stakes).
- Minimum 20 successful tasks to graduate from probation.

### 2. Win-Rate Floor
- Engines below **30% win rate** over last 50 tasks are moved to **probation**.
- Engines below **20% win rate** over last 50 tasks are **dropped** from the pool entirely.
- Dropped engines can be reinstated only after a benchmark run (synthetic task suite, 20 tasks, >40% win rate).

### 3. Promotion / Demotion Cycle
- Evaluated weekly based on rolling 50-task window.
- State transitions:
  - `probation → active`: 20+ tasks, >40% win rate.
  - `active → probation`: <30% win rate over 50 tasks.
  - `active → dropped`: <20% win rate over 50 tasks.
  - `dropped → probation`: benchmark >40%.

### 4. Current Pool Actions
| Engine | Current WR | Action |
|--------|-----------|--------|
| ZAI    | 80%       | active (lead) |
| Gemini | 74%       | active |
| Claude | 61%       | active |
| Kimi   | 50% (2T)  | probation |
| Qwen   | 27%       | probation |
| Minimax| 33%       | active (borderline) |
| Codex  | 13%       | dropped → benchmark or remove |

### 5. Implementation
- Store pool state in `.agon/engine-pool.json`.
- Update after every scored task (forge/agent/brainstorm outcome).
- Routing context reads this file to filter eligible engines.

## Open Questions
- Should win rate be weighted by task complexity? (e.g., hard tasks count more)
- Should we keep a "legacy" mode where dropped engines can still be manually invoked?
