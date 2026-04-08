# Session Results Pager (Ctrl+R)

**Date:** 2026-04-07
**Status:** Design approved

## Problem

When engines are running in the agon REPL, the terminal becomes difficult to scroll and copy from (Ink's live rendering fights the scrollback buffer). Users want to review brainstorm/campfire/tribunal/forge results from the current session without scrolling back through output.

## Solution

**Ctrl+R** opens the system pager (`less -R` or `$PAGER`) with a formatted, ANSI-colored summary of all multi-AI results from the current session. The pager provides proper scrolling, search (`/keyword`), and native text selection/copy. Pressing `q` returns to the REPL.

## Architecture

### 1. Session Results Buffer — `session-results.kern`

**Package:** `packages/cli/src/kern/`

In-memory array that persists for the session lifetime. NOT tied to `outputBlocks` (which gets wiped by `/clear`).

```typescript
interface SessionResult {
  type: 'brainstorm' | 'campfire' | 'tribunal' | 'forge';
  timestamp: string;       // ISO string
  question: string;        // the user's prompt/task
  engines: string[];       // engine IDs involved
  winner: string | null;   // winning engine ID (if applicable)
  data: BrainstormData | CampfireData | TribunalData | ForgeData;
}
```

Type-specific data shapes:

```typescript
interface BrainstormData {
  bids: { engineId: string; reasoning: string; approach?: string; score?: number }[];
  response: string;  // winner's full response
}

interface CampfireData {
  rounds: { engineId: string; content: string }[];
}

interface TribunalData {
  rounds: { round: number; engineId: string; position: string; argument: string }[];
  verdict: string;
}

interface ForgeData {
  scoreboard: { engineId: string; pass: boolean; score: number; diffLines: number; filesChanged: number; durationSec: number }[];
  winner: string | null;
  synthesis?: { pass: boolean; score: number };
}
```

**API:**
- `addSessionResult(result: SessionResult): void` — called by handlers when a multi-AI command completes
- `getSessionResults(): SessionResult[]` — returns all results for the current session
- `hasSessionResults(): boolean` — quick check for the keybinding (show "no results" message)

### 2. Handler Integration

Each handler pushes one `SessionResult` after its multi-AI operation completes. This happens at the handler level with structured data — NOT by intercepting OutputEvents at the dispatch layer.

**Brainstorm** (`handlers-brainstorm.kern`, after line 109):
```
addSessionResult({
  type: 'brainstorm',
  timestamp: new Date().toISOString(),
  question,
  engines,
  winner: result.winner,
  data: { bids: result.bids, response: result.response },
});
```

**Campfire** (`handlers-campfire.kern`, after responses complete):
```
addSessionResult({
  type: 'campfire',
  timestamp: new Date().toISOString(),
  question,
  engines,
  winner: null,
  data: { rounds },
});
```

**Tribunal** (`handlers-tribunal.kern`, after verdict):
```
addSessionResult({
  type: 'tribunal',
  timestamp: new Date().toISOString(),
  question,
  engines,
  winner: null,
  data: { rounds: result.rounds, verdict: result.verdict },
});
```

**Forge** (`handlers-forge.kern`, after scoreboard):
```
addSessionResult({
  type: 'forge',
  timestamp: new Date().toISOString(),
  question: plan.task,
  engines: engineIds,
  winner: manifest.winner,
  data: { scoreboard, winner: manifest.winner, synthesis: manifest.synthesis },
});
```

### 3. Results Formatter — `results-formatter.kern`

**Package:** `packages/cli/src/kern/`

Converts `SessionResult[]` into a single ANSI-colored string for the pager.

**Format per result:**

```
══════════════════════════════════════════════════════════════════
 BRAINSTORM #1 · 22:15 · "How should we handle caching?"
 Engines: claude, codex, gemini · Winner: claude
══════════════════════════════════════════════════════════════════

── claude (winner) ──────────────────────────────────────────────
[full reasoning text]

── codex ────────────────────────────────────────────────────────
[full reasoning text]

── gemini ───────────────────────────────────────────────────────
[full reasoning text]

── Winner's Response ────────────────────────────────────────────
[full response]

```

- Headers use bold + engine colors (same `ENGINE_COLORS` map from ui-app.kern)
- Winner gets a highlight marker
- Sections separated by double-line box rules
- Tribunal shows rounds with position labels
- Forge shows a simple ASCII scoreboard table
- Empty state: single line "No results in this session yet. Run /brainstorm, /campfire, /tribunal, or /forge first."

### 4. Keybinding + Pager Launch — `ui-app.kern`

**Keybinding:** Ctrl+R (line ~477, after Ctrl+E handler)

```
if (key.ctrl && input === 'r') {
  openResultsPager();
  return;
}
```

**Pager function** (new callback in ui-app.kern):

1. Call `getSessionResults()` — if empty, dispatch info message and return
2. Call `formatSessionResults(results)` to get the ANSI string
3. Write string to a temp file (`os.tmpdir() + '/agon-results-' + Date.now() + '.txt'`)
4. `spawnSync(process.env.PAGER || 'less', ['-R', tmpFile], { stdio: 'inherit' })`
5. Delete the temp file

Uses the **identical pattern** as the editor launch in `app-review.kern` line 37-44: `spawnSync` with `{ stdio: 'inherit' }`, blocking the event loop while the external process runs. Ink's rendering is frozen (event loop blocked), pager gets full terminal control, returns cleanly when user presses `q`.

### 5. Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| CREATE | `packages/cli/src/kern/session-results.kern` | In-memory results buffer (singleton service) |
| CREATE | `packages/cli/src/kern/results-formatter.kern` | ANSI text formatter |
| MODIFY | `packages/cli/src/kern/handlers-brainstorm.kern` | Add `addSessionResult()` call |
| MODIFY | `packages/cli/src/kern/handlers-campfire.kern` | Add `addSessionResult()` call |
| MODIFY | `packages/cli/src/kern/handlers-tribunal.kern` | Add `addSessionResult()` call |
| MODIFY | `packages/cli/src/kern/handlers-forge.kern` | Add `addSessionResult()` call |
| MODIFY | `packages/cli/src/kern/ui-app.kern` | Add Ctrl+R keybinding + pager callback |

### 6. Edge Cases

- **No results yet:** Info message "No results yet — run /brainstorm, /campfire, /tribunal, or /forge first"
- **Engine actively running:** Pager shows completed results so far; in-progress run not included
- **$PAGER not set / less not installed:** Falls back to `less`, then `more`. If neither available, dump to temp file and dispatch info with the file path so user can open manually
- **Very large results:** Temp file handles any size; `less` is designed for large files
- **Ctrl+R during question prompt:** Input handler already guards — keybinding only fires when no questionState/picker is open

### 7. Testing

- Unit test for `session-results.kern`: add/get/hasResults
- Unit test for `results-formatter.kern`: each result type produces expected format, empty state
- Integration test: handler → addSessionResult → formatter → output string contains expected content
- Manual test: run brainstorm, press Ctrl+R, verify pager opens with correct content
