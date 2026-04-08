# Global Leaderboard — Spec v2 (Post-Campfire)

## Problem

Ratings are local-only, forge-only, and unfair to new engines. Users can't see how engines compare across the community. A new model like opus 4.7 starts at 1500 while gemini sits at 2000 — it can never become advisor.

## Changes from v1 (campfire feedback)

- **Glicko-2 replaces ELO** — tracks rating + deviation (uncertainty) + volatility natively. Codex and Gemini both called this out: provisional K-factors, +50 boosts, and read-time decay are hacks that Glicko-2 handles inherently.
- **Dropped**: provisional boost hack, read-time decay, tiered K-factor table
- **Added**: tribunal cross-judge weighting (Gemini), `derived_from` version lineage (OpenCode), latency/tokens in API payload (all three), client reputation scoring (Codex/OpenCode)
- **Added**: raw scores in payload for future recomputation (OpenCode)

## Goals

1. **Ratings per competitive mode** — forge (code), brainstorm (creative), tribunal (reasoning)
2. **New engine fairness** — Glicko-2 uncertainty handles this natively
3. **Global leaderboard** — anonymized results aggregated at a web URL
4. **Smart advisor selection** — mode-specific, uncertainty-aware

---

## Rating System: Glicko-2

Each engine has three values per scope (global, per-mode, per-task-class):

```typescript
interface GlickoRating {
  mu: number;      // rating (default 1500)
  phi: number;     // rating deviation / uncertainty (default 350)
  sigma: number;   // volatility (default 0.06)
  wins: number;
  losses: number;
  lastActive: string;
}
```

### How Glicko-2 solves our problems

| Problem | ELO hack (v1) | Glicko-2 (v2) |
|---------|--------------|---------------|
| New engine moves slowly | K=80 for first 10 matches | High phi (350) = moves fast naturally |
| Inactive engine blocks newcomers | Read-time decay -1pt/day | phi grows with inactivity — uncertain engines get overtaken |
| Provisional engines over-promoted | +50 boost hack | No boost needed — high phi means fast adjustment up OR down |
| Engine comes back after break | Instantly reclaims old rating | phi increased → must re-prove, but starts near old mu, not 1500 |

### Rating period

Glicko-2 processes matches in "rating periods." For Agon:
- **Local**: every match updates immediately (simplified single-match period)
- **Global API**: aggregates in 24h periods, recomputes nightly

### Inactivity

When an engine hasn't competed for N days, phi increases:
```
phi_new = min(sqrt(phi^2 + sigma^2 * days_inactive), 350)
```
This is standard Glicko-2 — uncertainty grows, capped at the starting deviation. The engine's mu stays the same, but its uncertainty makes it easier to overtake AND easier for it to climb back quickly.

---

## Data Model

### Local: `~/.agon/ratings.json`

```typescript
interface RatingRecord {
  global: Record<string, GlickoRating>;
  byMode: {
    forge:      Record<string, GlickoRating>;
    brainstorm: Record<string, GlickoRating>;
    tribunal:   Record<string, GlickoRating>;
  };
  byTaskClass: Record<TaskClass, Record<string, GlickoRating>>;
  engineMeta: Record<string, EngineMeta>;
  lastUpdated: string;
}

interface EngineMeta {
  firstSeen: string;
  lastActive: string;
  matchCount: number;
  derivedFrom: string | null;  // parent version lineage
  versions: string[];          // all seen versions
}
```

### Global API: D1 tables

```sql
CREATE TABLE matches (
  id            TEXT PRIMARY KEY,
  mode          TEXT NOT NULL,
  task_class    TEXT,
  engines       TEXT NOT NULL,        -- JSON array (see MatchReport.engines)
  ts            TEXT NOT NULL,
  client_id     TEXT NOT NULL,
  agon_version  TEXT NOT NULL,
  engine_count  INTEGER NOT NULL
);

CREATE TABLE ratings (
  engine_id    TEXT NOT NULL,
  mode         TEXT NOT NULL,
  mu           REAL NOT NULL,
  phi          REAL NOT NULL,
  sigma        REAL NOT NULL,
  wins         INTEGER NOT NULL,
  losses       INTEGER NOT NULL,
  match_count  INTEGER NOT NULL,
  last_active  TEXT NOT NULL,
  peak_mu      REAL NOT NULL,
  derived_from TEXT,
  PRIMARY KEY (engine_id, mode)
);

CREATE TABLE client_reputation (
  client_id      TEXT PRIMARY KEY,
  first_seen     TEXT NOT NULL,
  match_count    INTEGER NOT NULL,
  anomaly_score  REAL DEFAULT 0,
  trust_weight   REAL DEFAULT 1.0
);
```

---

## Win Signals per Mode

| Mode | Winner signal | Reliability | Notes |
|------|--------------|-------------|-------|
| **Forge** | Fitness score ranking | High | Automated, deterministic |
| **Brainstorm** | qualityScore ranking | Medium | Calibrated confidence + ELO track record |
| **Tribunal** | Verdict strength scores | Low | Subject to judge bias — needs cross-judge weighting |
| **Campfire** | None | N/A | Never tracked |

### Tribunal Cross-Judge Weighting (Gemini's idea)

When the synthesis judge is the same engine family as a participant:
- Victory weight = 0.5x (half credit)
- When confirmed by a judge from a different family: 1.0x (full credit)

```typescript
function tribunalWeight(judgeEngine: string, winnerEngine: string): number {
  const judgeFamily = engineFamily(judgeEngine);   // 'anthropic', 'openai', 'google'
  const winnerFamily = engineFamily(winnerEngine);
  return judgeFamily === winnerFamily ? 0.5 : 1.0;
}
```

This reduces self-preference bias without blocking same-family judging entirely.

---

## Engine Versioning

```
claude           → current default (resolves to latest)
claude-opus-4    → specific version
claude-opus-4.7  → newer version
```

Rules:
- New versions start with **default Glicko values** (mu=1500, phi=350) — no inheritance by default
- `derivedFrom` field tracks lineage: `claude-opus-4.7.derivedFrom = "claude-opus-4"`
- **Optional partial inheritance**: if `derivedFrom` is set, start at `parent.mu * 0.8` with `phi = 250` (high uncertainty but not blank slate). This is opt-in per engine config, not automatic.
- Leaderboard groups by base family with version drill-down
- Old versions that stop competing naturally fade (phi grows → uncertain → overtaken)

---

## Advisor / Starter Selection

Replace pure rating with confidence-aware selection:

```typescript
function advisorScore(engine: GlickoRating, mode: string): number {
  // Lower bound of 95% confidence interval
  // Penalizes uncertain engines — you need to PROVE yourself
  return engine.mu - 2 * engine.phi;
}
```

This is the "conservative estimate" approach used by Reddit's comment ranking and many game matchmaking systems. It means:
- **Proven engine** (mu=1800, phi=50): score = 1700
- **New hot engine** (mu=1600, phi=200): score = 1200
- **New engine after 30 wins** (mu=1800, phi=80): score = 1640

New engines can overtake established ones, but only after enough matches to reduce their uncertainty. No hacks needed.

Mode-specific: forge starter uses forge ratings, brainstorm advisor uses brainstorm ratings.

---

## Global API

### `POST /api/v1/match`

```typescript
interface MatchReport {
  mode: 'forge' | 'brainstorm' | 'tribunal';
  taskClass: string | null;
  engines: Array<{
    id: string;
    version: string;
    score: number;         // raw composite / quality score
    rank: number;          // 1-based position
    pass: boolean;
    latencyMs: number;     // time to produce result
    inputTokens: number;   // prompt tokens consumed
    outputTokens: number;  // response tokens produced
  }>;
  ts: string;
  clientId: string;        // SHA-256(hostname + username + "agon")
  agonVersion: string;     // e.g. "0.9.5"
  engineCount: number;     // redundant but cheap, useful for filtering
  tribunalJudge?: string;  // engine ID of judge, for cross-judge weighting
}
```

**What we DON'T send:** code, prompts, file contents, user identity, IP addresses, task descriptions.

### `GET /api/v1/leaderboard`

```typescript
interface LeaderboardResponse {
  global: RankedEngine[];
  byMode: {
    forge: RankedEngine[];
    brainstorm: RankedEngine[];
    tribunal: RankedEngine[];
  };
  totalMatches: number;
  uniqueClients: number;
  lastUpdated: string;
}

interface RankedEngine {
  engineId: string;
  mu: number;              // rating
  phi: number;             // uncertainty
  confidenceFloor: number; // mu - 2*phi (what we sort by)
  wins: number;
  losses: number;
  matchCount: number;
  trend: number;           // mu change over last 7 days
  versions: string[];
  derivedFrom: string | null;
}
```

### `GET /api/v1/engine/:id`

Per-mode ratings, match history sparkline data, version timeline, head-to-head vs other engines.

### Anti-Gaming: Client Reputation (replaces flat cap)

No flat 100/day limit. Instead:

```typescript
interface ClientReputation {
  trustWeight: number;      // 0.0 - 1.0, starts at 0.5, grows with history
  matchCount: number;
  firstSeen: string;
  anomalyScore: number;     // 0-1, flags suspicious patterns
}
```

**Trust weight factors:**
- Account age: < 7 days = 0.3, < 30 days = 0.6, 30+ days = 1.0
- Match diversity: same engine winning > 80% = weight * 0.5
- Task diversity: < 3 distinct taskClasses = weight * 0.7
- Engine diversity: always same 2 engines = weight * 0.5
- Volume: > 200 matches/day from one client = flag for review

Match results are weighted by `clientReputation.trustWeight` when computing global ratings. Low-trust clients still contribute, but their impact is dampened.

**Sybil defense:** New client IDs start at 0.3 trust. Rotating IDs gives you LESS influence, not more.

---

## Web Leaderboard Page

**URL:** `kern-lang.dev/leaderboard`

### Layout

```
[Header: Agon AI — Global Engine Leaderboard]
[Subtitle: Real results from N users across M matches]

[Tabs: Overall | Forge | Brainstorm | Tribunal]

[Table — sorted by confidence floor]
#  Engine          Rating   +/-    Floor   W    L    Matches  Trend
1  claude-opus-4   1842     +-38   1766    347  213  560      +12
2  gemini-2.5      1798     +-45   1708    301  198  499      -5
3  codex           1654     +-52   1550    189  245  434      +28
4  opencode        1589     +-61   1467    156  201  357      +8
5  opus-4.7 *      1680     +-180  1320    12   3    15       NEW

* = provisional (high uncertainty, still calibrating)

[Footer: Powered by Agon AI · npm i -g agon-ai]
```

The `+-` column shows phi (uncertainty). Users can see at a glance which ratings are solid vs still volatile. The `Floor` column (mu - 2*phi) is the actual sort key — this is what advisor selection uses.

### Tech Stack

- Astro static site on Cloudflare Pages
- Fetches `/api/v1/leaderboard` on load + 60s polling
- Engine detail page: click engine row → `/leaderboard/claude-opus-4`
- Responsive, no JS framework needed
- Open Graph meta for social sharing: "Claude is #1 on the Agon Leaderboard"

---

## Agon Client Integration

### Config

```json
{
  "telemetry": {
    "shareResults": true,
    "apiUrl": "https://kern-lang.dev/api/v1"
  }
}
```

### First-run prompt

```
Help improve Agon? Share anonymous match results to the global leaderboard.
No code, prompts, or identity sent — just engine scores and timing.
See: kern-lang.dev/leaderboard

Share results? [Y/n]
```

### Rating update flow

```
match completes
  → updateGlickoRanked(ranked, taskClass, mode)  // local ratings.json
  → if config.telemetry.shareResults:
      POST /api/v1/match                          // global API
```

---

## Implementation Plan

### Phase 1: Local Glicko-2 (~4h)
- Implement Glicko-2 algorithm in `glicko.kern` (mu, phi, sigma update)
- Migrate `elo.json` → `ratings.json` with new schema
- Extend `updateGlickoRanked` with `mode` parameter
- Add rating calls to `brainstorm.kern` and `tribunal.kern`
- Tribunal cross-judge weighting
- Update `/leaderboard` command to show per-mode + uncertainty

### Phase 2: Global API (~4h)
- Cloudflare Worker + D1 schema
- `POST /api/v1/match` with validation
- `GET /api/v1/leaderboard` with nightly Glicko-2 recomputation
- `GET /api/v1/engine/:id`
- Client reputation system

### Phase 3: Client telemetry (~2h)
- `shareResults` config + first-run prompt
- POST from forge/brainstorm/tribunal
- Client ID generation
- Version detection + `derivedFrom` tracking

### Phase 4: Web page (~3h)
- Astro site on Cloudflare Pages
- Mode tabs, sortable by floor/mu/matches
- Uncertainty visualization (+- column)
- Engine detail pages
- Mobile responsive, social sharing

### Phase 5: Advisor integration (~1h)
- `advisorScore = mu - 2*phi` replaces raw rating
- Mode-specific selection
- Version-aware: new versions must prove themselves
