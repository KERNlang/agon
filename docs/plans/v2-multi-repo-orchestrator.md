# Agon v2 — Multi-Repo AI Orchestrator

> One terminal. Multiple repos. Multiple engines. No window switching.
> "A world for AIs, not a prison."

## What v1 proved (today)

- REPL with natural language intent routing works
- Engines can compete (forge), brainstorm (Kern drafts), debate (tribunal), think (campfire)
- Kern Draft Protocol saves 70% tokens
- Token tracking gives visibility
- Caesar (local LLM) can route intents
- Context scanning feeds engines project knowledge
- Brainstorm → forge/build pipeline connects ideas to code

## v2 Vision

You open one terminal. You add workspaces. You talk naturally.
Agon figures out which engines work on which repos, in parallel.
You see everything. You control the cost.

```
⚔ agon ❯ /workspace add ~/GitHub/kern-lang
⚔ agon ❯ /workspace add ~/GitHub/patrol
⚔ agon ❯ /workspace add ~/GitHub/Agon-AI

⚔ agon ❯ fix the parser bug in kern, update patrol rules to match

  [auto mode]
  Caesar: I'll split this into 2 tasks across 2 repos.

  claude  → kern-lang   "fix parser bug"        ⚒️ working...
  codex   → patrol      "update rules"          ⚒️ working...

  claude  → kern-lang   ✓ done (score: 87)
  codex   → patrol      ✓ done (score: 91)

  Cross-repo test: npm test in both... ✓ all passing
```

## Architecture

### Core Concepts

```
┌─────────────────────────────────────────────────────┐
│  AGON REPL                                          │
│  ⚔ agon ❯ [natural language input]                  │
├─────────────────────────────────────────────────────┤
│  CAESAR (local orchestrator)                         │
│  - Parses intent                                     │
│  - Splits multi-repo tasks                           │
│  - Assigns engines to repos                          │
│  - Coordinates cross-repo dependencies               │
│  - Reports progress                                  │
├─────────────────────────────────────────────────────┤
│  WORKSPACES                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ kern-lang │ │ patrol   │ │ agon-ai  │             │
│  │ context:  │ │ context: │ │ context: │             │
│  │ .kern     │ │ rules    │ │ forge    │             │
│  └──────────┘ └──────────┘ └──────────┘             │
├─────────────────────────────────────────────────────┤
│  ENGINES                                             │
│  claude ● codex ● gemini ● ollama ●                  │
│  (any engine can work on any workspace)              │
├─────────────────────────────────────────────────────┤
│  MODES                                               │
│  auto — Caesar decides everything                    │
│  manual — you approve each step                      │
│  campfire — no tasks, just thinking                  │
└─────────────────────────────────────────────────────┘
```

### Workspace Manager

```typescript
interface Workspace {
  id: string;           // "kern-lang"
  path: string;         // "/Users/x/GitHub/kern-lang"
  context: string;      // scanned project context
  isKern: boolean;      // auto-detected
  lastActivity: number; // for staleness
}

// Commands
/workspace add <path>        // add a repo
/workspace remove <id>       // remove
/workspace list              // show all
/workspace switch <id>       // set active (for single-repo commands)
/ws                          // alias for /workspace list
```

### Two Modes

#### Auto Mode (`/mode auto`)

Caesar makes all decisions:
- Splits tasks into sub-tasks
- Assigns engines to repos
- Manages dependencies between sub-tasks
- Reports progress
- User only sees results

Token budget: set a session budget, Caesar stays within it.

```
/mode auto
/budget $0.50

⚔ agon ❯ add websocket support to kern and update agon to use it

  Caesar: Planning...
  Budget: $0.50 remaining

  Task 1: kern-lang — add WebSocket node type to parser
    → claude (best ELO for kern-lang)
  Task 2: kern-lang — add WS transpiler for express target
    → codex (challenger)
  Task 3: agon-ai — integrate kern WS in engine dispatch
    → claude (after task 1+2 complete, needs their output)

  Estimated cost: $0.12
  Proceed? [Y/n]
```

#### Manual Mode (`/mode manual`)

You are Caesar:
- You see the plan before execution
- You approve each sub-task
- You pick which engine handles what
- You can redirect mid-flight
- Zero token spend until you approve

```
/mode manual

⚔ agon ❯ add websocket support to kern and update agon to use it

  Caesar suggests:
  1. [kern-lang] add WebSocket node type  → claude?
  2. [kern-lang] add WS transpiler        → codex?
  3. [agon-ai]   integrate kern WS        → claude? (after 1+2)

  ❯ approve / edit / cancel
  ❯ edit
  ❯ task 2: use gemini instead
  ❯ approve

  Running task 1...
```

### Cross-Repo Intelligence

When engines work across repos, they need to understand dependencies:

```
kern-lang exports → agon-ai imports
patrol rules → agon-ai uses

Caesar maintains a dependency graph:
  kern-lang → agon-ai (via npm dependency)
  patrol → agon-ai (via plugin system)
```

When a task in kern-lang changes an export, Caesar knows to:
1. Run kern-lang tests first
2. Then update agon-ai imports
3. Then run agon-ai tests

### Token Budget System

```typescript
interface TokenBudget {
  sessionLimit: number;      // max USD per session
  taskLimit: number;         // max USD per task
  spent: number;             // running total
  remaining: number;
  autoApproveUnder: number;  // auto-approve tasks under $X
}

// Commands
/budget $1.00              // set session budget
/budget                    // show remaining
/budget task $0.10         // max per task
/budget auto $0.05         // auto-approve under 5 cents
```

### Campfire v2 — Cross-Repo Thinking

```
⚔ agon ❯ /campfire how should kern and agon evolve together?

  🔥 Campfire (3 workspaces loaded)

  ┌── claude
  │  Looking at kern-lang's parser and agon's dispatch layer,
  │  the WebSocket primitives could enable real-time forge
  │  streaming...
  └──

  ┌── codex
  │  The dependency is one-way right now (agon → kern).
  │  Making it bidirectional risks circular deps. Consider
  │  extracting shared types into a third package...
  └──

  ┌── gemini
  │  What if agon.kern wasn't just an example? What if
  │  every agon plugin was a .kern file that gets compiled
  │  at install time?
  └──
```

Engines see ALL workspace contexts and can reason across repos.

## Implementation Phases

### Phase 1: Workspace Manager (foundation)
- `/workspace add/remove/list/switch`
- Multi-workspace context scanning
- Active workspace indicator in prompt
- Store in `~/.agon/workspaces.json`

### Phase 2: Task Splitter
- Caesar splits natural language into sub-tasks
- Each sub-task tagged with target workspace
- Dependency detection between sub-tasks
- Plan display before execution

### Phase 3: Auto/Manual Modes
- `/mode auto` — Caesar runs everything
- `/mode manual` — approve each step
- Token budget with auto-approve threshold
- Mid-flight redirection

### Phase 4: Cross-Repo Forge
- Engines dispatch to specific workspace cwd
- Results from one workspace feed into next task
- Cross-repo test verification
- Unified scoreboard across workspaces

### Phase 5: Persistent World
- Engine memory across sessions (not just ELO)
- Workspace relationship graph
- Caesar learns which engines are best at which repos
- "Morning briefing" — what changed since last session

## What stays from v1

Everything. v2 is additive:
- REPL, intent detection, dashboard → same
- Forge, brainstorm, tribunal, campfire → same
- Kern Draft Protocol → same
- Token tracking → extended with budgets
- Caesar → upgraded to task splitter
- Context scanner → extended for multi-workspace

## What changes

- `index.ts` entry: workspace-aware
- Caesar: from intent router to full orchestrator
- Prompt builder: multi-workspace context injection
- Token tracker: budget enforcement
- New: workspace manager, task splitter, dependency graph

## The Tagline

```
Any AI can join.
They can compete. They can collaborate. They can just talk.
You build with all of them.

Agon — a world for AIs, not a prison.
Powered by KERNlang.
```
