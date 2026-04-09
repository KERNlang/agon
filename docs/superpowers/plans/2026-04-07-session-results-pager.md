# Session Results Pager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ctrl+R keybinding that opens past brainstorm/campfire/tribunal/forge results from the current session in the system pager (`less -R`).

**Architecture:** A singleton `SessionResultStore` collects structured results from each handler. A formatter converts them to ANSI-colored text. The Ctrl+R keybinding writes to a temp file and spawns the pager with `{ stdio: 'inherit' }` (same pattern as the existing editor launch in `app-review.kern`).

**Tech Stack:** KERN lang, Node.js `child_process.spawnSync`, `node:os.tmpdir`, `node:fs`

---

### Task 1: Create SessionResultStore

**Files:**
- Create: `packages/cli/src/kern/session-results.kern`
- Test: `tests/unit/session-results.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/session-results.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { sessionResultStore } from '../packages/cli/src/generated/session-results.js';

describe('SessionResultStore', () => {
  beforeEach(() => {
    sessionResultStore.clear();
  });

  it('starts empty', () => {
    expect(sessionResultStore.hasResults()).toBe(false);
    expect(sessionResultStore.getResults()).toEqual([]);
  });

  it('stores a brainstorm result', () => {
    sessionResultStore.add({
      type: 'brainstorm',
      timestamp: '2026-04-07T22:00:00.000Z',
      question: 'caching strategy?',
      engines: ['claude', 'codex'],
      winner: 'claude',
      data: {
        bids: [
          { engineId: 'claude', reasoning: 'Use Redis', score: 92 },
          { engineId: 'codex', reasoning: 'Use Memcached', score: 85 },
        ],
        response: 'Full Redis implementation plan...',
      },
    });

    expect(sessionResultStore.hasResults()).toBe(true);
    expect(sessionResultStore.getResults()).toHaveLength(1);
    expect(sessionResultStore.getResults()[0].type).toBe('brainstorm');
    expect(sessionResultStore.getResults()[0].winner).toBe('claude');
  });

  it('stores multiple results in order', () => {
    sessionResultStore.add({
      type: 'brainstorm',
      timestamp: '2026-04-07T22:00:00.000Z',
      question: 'first',
      engines: ['claude'],
      winner: 'claude',
      data: { bids: [], response: '' },
    });
    sessionResultStore.add({
      type: 'campfire',
      timestamp: '2026-04-07T22:05:00.000Z',
      question: 'second',
      engines: ['claude', 'gemini'],
      winner: null,
      data: { rounds: [] },
    });

    const results = sessionResultStore.getResults();
    expect(results).toHaveLength(2);
    expect(results[0].type).toBe('brainstorm');
    expect(results[1].type).toBe('campfire');
  });

  it('clear removes all results', () => {
    sessionResultStore.add({
      type: 'tribunal',
      timestamp: '2026-04-07T22:00:00.000Z',
      question: 'debate topic',
      engines: ['claude', 'codex'],
      winner: null,
      data: { rounds: [], verdict: 'Some verdict' },
    });
    expect(sessionResultStore.hasResults()).toBe(true);
    sessionResultStore.clear();
    expect(sessionResultStore.hasResults()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/session-results.test.ts`
Expected: FAIL — cannot resolve `../packages/cli/src/generated/session-results.js`

- [ ] **Step 3: Write the KERN source**

Create `packages/cli/src/kern/session-results.kern`:

```kern
import from="@agon/core" names="SessionResult" types=true

service name=SessionResultStore singleton=true
  field name=results type="SessionResult[]" initial="[]"

  method name=add params="result:SessionResult" returns=void
    handler <<<
      this.results.push(result);
    >>>

  method name=getResults returns="SessionResult[]"
    handler <<<
      return [...this.results];
    >>>

  method name=hasResults returns=boolean
    handler <<<
      return this.results.length > 0;
    >>>

  method name=clear returns=void
    handler <<<
      this.results = [];
    >>>
```

- [ ] **Step 4: Add the SessionResult type to @agon/core**

Create `packages/core/src/kern/session-result-types.kern`:

```kern
interface name=BrainstormResultData export=true
  field name=bids type="{ engineId: string; reasoning: string; approach?: string; score?: number }[]"
  field name=response type=string

interface name=CampfireResultData export=true
  field name=rounds type="{ engineId: string; content: string }[]"

interface name=TribunalResultData export=true
  field name=rounds type="{ round: number; engineId: string; position: string; argument: string }[]"
  field name=verdict type=string

interface name=ForgeResultData export=true
  field name=scoreboard type="{ engineId: string; pass: boolean; score: number; diffLines: number; filesChanged: number; durationSec: number }[]"
  field name=winner type="string | null"
  field name=synthesis type="{ pass: boolean; score: number } | undefined" optional=true

interface name=SessionResult export=true
  field name=type type="'brainstorm' | 'campfire' | 'tribunal' | 'forge'"
  field name=timestamp type=string
  field name=question type=string
  field name=engines type="string[]"
  field name=winner type="string | null"
  field name=data type="BrainstormResultData | CampfireResultData | TribunalResultData | ForgeResultData"
```

- [ ] **Step 5: Compile KERN files and add exports**

```bash
npx kern compile packages/core/src/kern/session-result-types.kern --outdir=packages/core/src/generated
npx kern compile packages/cli/src/kern/session-results.kern --outdir=packages/cli/src/generated
```

Add export to `packages/core/src/index.ts`:
```typescript
export type { SessionResult, BrainstormResultData, CampfireResultData, TribunalResultData, ForgeResultData } from './generated/session-result-types.js';
```

Add export to `packages/cli/src/kern/session-results.kern` (the singleton instance):
Verify the compiled output exports `sessionResultStore` as the singleton instance.

- [ ] **Step 6: Build and run test**

```bash
npm run build
npm test -- --run tests/unit/session-results.test.ts
```
Expected: PASS — all 4 tests green

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/kern/session-result-types.kern packages/core/src/generated/session-result-types.ts packages/core/src/index.ts packages/cli/src/kern/session-results.kern packages/cli/src/generated/session-results.ts tests/unit/session-results.test.ts
git commit -m "feat(session-results): add SessionResultStore for in-memory result tracking"
```

---

### Task 2: Create Results Formatter

**Files:**
- Create: `packages/cli/src/kern/results-formatter.kern`
- Test: `tests/unit/results-formatter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/results-formatter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatSessionResults } from '../packages/cli/src/generated/results-formatter.js';
import type { SessionResult } from '@agon/core';

describe('formatSessionResults', () => {
  it('returns empty-state message when no results', () => {
    const output = formatSessionResults([]);
    expect(output).toContain('No results in this session yet');
  });

  it('formats a brainstorm result with header and bids', () => {
    const results: SessionResult[] = [{
      type: 'brainstorm',
      timestamp: '2026-04-07T22:15:00.000Z',
      question: 'caching strategy?',
      engines: ['claude', 'codex'],
      winner: 'claude',
      data: {
        bids: [
          { engineId: 'claude', reasoning: 'Use Redis for speed', score: 92 },
          { engineId: 'codex', reasoning: 'Use Memcached', score: 85 },
        ],
        response: 'Full Redis plan here',
      },
    }];

    const output = formatSessionResults(results);
    expect(output).toContain('BRAINSTORM #1');
    expect(output).toContain('caching strategy?');
    expect(output).toContain('claude');
    expect(output).toContain('codex');
    expect(output).toContain('Use Redis for speed');
    expect(output).toContain('Use Memcached');
    expect(output).toContain('Full Redis plan here');
    expect(output).toContain('Winner: claude');
  });

  it('formats a campfire result with rounds', () => {
    const results: SessionResult[] = [{
      type: 'campfire',
      timestamp: '2026-04-07T22:20:00.000Z',
      question: 'discuss caching',
      engines: ['claude', 'gemini'],
      winner: null,
      data: {
        rounds: [
          { engineId: 'claude', content: 'I think Redis is best' },
          { engineId: 'gemini', content: 'Consider edge caching too' },
        ],
      },
    }];

    const output = formatSessionResults(results);
    expect(output).toContain('CAMPFIRE #1');
    expect(output).toContain('discuss caching');
    expect(output).toContain('I think Redis is best');
    expect(output).toContain('Consider edge caching too');
  });

  it('formats a tribunal result with rounds and verdict', () => {
    const results: SessionResult[] = [{
      type: 'tribunal',
      timestamp: '2026-04-07T22:25:00.000Z',
      question: 'Redis vs Memcached',
      engines: ['claude', 'codex'],
      winner: null,
      data: {
        rounds: [
          { round: 1, engineId: 'claude', position: 'pro', argument: 'Redis has persistence' },
          { round: 1, engineId: 'codex', position: 'con', argument: 'Memcached is simpler' },
        ],
        verdict: 'Redis wins for this use case',
      },
    }];

    const output = formatSessionResults(results);
    expect(output).toContain('TRIBUNAL #1');
    expect(output).toContain('Redis vs Memcached');
    expect(output).toContain('Round 1');
    expect(output).toContain('Redis has persistence');
    expect(output).toContain('Memcached is simpler');
    expect(output).toContain('Redis wins for this use case');
  });

  it('formats a forge result with scoreboard', () => {
    const results: SessionResult[] = [{
      type: 'forge',
      timestamp: '2026-04-07T22:30:00.000Z',
      question: 'fix auth bug',
      engines: ['claude', 'codex'],
      winner: 'claude',
      data: {
        scoreboard: [
          { engineId: 'claude', pass: true, score: 95, diffLines: 42, filesChanged: 3, durationSec: 15 },
          { engineId: 'codex', pass: false, score: 60, diffLines: 100, filesChanged: 8, durationSec: 22 },
        ],
        winner: 'claude',
      },
    }];

    const output = formatSessionResults(results);
    expect(output).toContain('FORGE #1');
    expect(output).toContain('fix auth bug');
    expect(output).toContain('PASS');
    expect(output).toContain('FAIL');
    expect(output).toContain('95');
    expect(output).toContain('42 lines');
  });

  it('numbers multiple results sequentially', () => {
    const results: SessionResult[] = [
      {
        type: 'brainstorm',
        timestamp: '2026-04-07T22:00:00.000Z',
        question: 'first',
        engines: ['claude'],
        winner: 'claude',
        data: { bids: [], response: '' },
      },
      {
        type: 'forge',
        timestamp: '2026-04-07T22:10:00.000Z',
        question: 'second',
        engines: ['claude'],
        winner: 'claude',
        data: { scoreboard: [], winner: 'claude' },
      },
    ];

    const output = formatSessionResults(results);
    expect(output).toContain('#1');
    expect(output).toContain('#2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/results-formatter.test.ts`
Expected: FAIL — cannot resolve `../packages/cli/src/generated/results-formatter.js`

- [ ] **Step 3: Write the KERN source**

Create `packages/cli/src/kern/results-formatter.kern`:

```kern
import from="@agon/core" names="SessionResult,BrainstormResultData,CampfireResultData,TribunalResultData,ForgeResultData" types=true

const name=BOLD type=string
  handler <<< '\x1b[1m' >>>

const name=DIM type=string
  handler <<< '\x1b[2m' >>>

const name=RESET type=string
  handler <<< '\x1b[0m' >>>

const name=CYAN type=string
  handler <<< '\x1b[36m' >>>

const name=GREEN type=string
  handler <<< '\x1b[32m' >>>

const name=RED type=string
  handler <<< '\x1b[31m' >>>

const name=YELLOW type=string
  handler <<< '\x1b[33m' >>>

const name=RULE type=string
  handler <<< '═'.repeat(70) >>>

const name=THIN_RULE type=string
  handler <<< '─'.repeat(70) >>>

fn name=formatTime params="iso:string" returns=string
  handler <<<
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  >>>

fn name=formatBrainstorm params="r:SessionResult, idx:number" returns=string
  handler <<<
    const data = r.data as BrainstormResultData;
    const lines: string[] = [];
    lines.push(`${BOLD}${CYAN}${RULE}${RESET}`);
    lines.push(`${BOLD} BRAINSTORM #${idx} ${DIM}· ${formatTime(r.timestamp)} · ${RESET}${BOLD}"${r.question}"${RESET}`);
    lines.push(`${DIM} Engines: ${r.engines.join(', ')}${r.winner ? ` · Winner: ${r.winner}` : ''}${RESET}`);
    lines.push(`${BOLD}${CYAN}${RULE}${RESET}`);
    lines.push('');

    for (const bid of data.bids) {
      const isWinner = bid.engineId === r.winner;
      const marker = isWinner ? `${GREEN} (winner)${RESET}` : '';
      const scoreTag = bid.score != null ? `${DIM} [score: ${bid.score}]${RESET}` : '';
      lines.push(`${BOLD}── ${bid.engineId}${marker}${scoreTag} ──${RESET}`);
      lines.push(bid.reasoning);
      if (bid.approach) lines.push(bid.approach);
      lines.push('');
    }

    if (data.response) {
      lines.push(`${BOLD}${GREEN}── Winner's Response ──${RESET}`);
      lines.push(data.response);
      lines.push('');
    }

    return lines.join('\n');
  >>>

fn name=formatCampfire params="r:SessionResult, idx:number" returns=string
  handler <<<
    const data = r.data as CampfireResultData;
    const lines: string[] = [];
    lines.push(`${BOLD}${YELLOW}${RULE}${RESET}`);
    lines.push(`${BOLD} CAMPFIRE #${idx} ${DIM}· ${formatTime(r.timestamp)} · ${RESET}${BOLD}"${r.question}"${RESET}`);
    lines.push(`${DIM} Engines: ${r.engines.join(', ')}${RESET}`);
    lines.push(`${BOLD}${YELLOW}${RULE}${RESET}`);
    lines.push('');

    for (const round of data.rounds) {
      lines.push(`${BOLD}── ${round.engineId} ──${RESET}`);
      lines.push(round.content);
      lines.push('');
    }

    return lines.join('\n');
  >>>

fn name=formatTribunal params="r:SessionResult, idx:number" returns=string
  handler <<<
    const data = r.data as TribunalResultData;
    const lines: string[] = [];
    lines.push(`${BOLD}${RED}${RULE}${RESET}`);
    lines.push(`${BOLD} TRIBUNAL #${idx} ${DIM}· ${formatTime(r.timestamp)} · ${RESET}${BOLD}"${r.question}"${RESET}`);
    lines.push(`${DIM} Engines: ${r.engines.join(', ')}${RESET}`);
    lines.push(`${BOLD}${RED}${RULE}${RESET}`);
    lines.push('');

    const roundNums = [...new Set(data.rounds.map(r => r.round))].sort();
    for (const num of roundNums) {
      lines.push(`${BOLD}${DIM}── Round ${num} ──${RESET}`);
      const positions = data.rounds.filter(r => r.round === num);
      for (const pos of positions) {
        lines.push(`${BOLD}${pos.engineId}${RESET} ${DIM}(${pos.position})${RESET}`);
        lines.push(pos.argument);
        lines.push('');
      }
    }

    lines.push(`${BOLD}── Verdict ──${RESET}`);
    lines.push(data.verdict);
    lines.push('');

    return lines.join('\n');
  >>>

fn name=formatForge params="r:SessionResult, idx:number" returns=string
  handler <<<
    const data = r.data as ForgeResultData;
    const lines: string[] = [];
    lines.push(`${BOLD}${GREEN}${RULE}${RESET}`);
    lines.push(`${BOLD} FORGE #${idx} ${DIM}· ${formatTime(r.timestamp)} · ${RESET}${BOLD}"${r.question}"${RESET}`);
    lines.push(`${DIM} Engines: ${r.engines.join(', ')}${r.winner ? ` · Winner: ${r.winner}` : ''}${RESET}`);
    lines.push(`${BOLD}${GREEN}${RULE}${RESET}`);
    lines.push('');

    // ASCII scoreboard
    const header = `${'Engine'.padEnd(20)} ${'Result'.padEnd(12)} ${'Score'.padEnd(8)} ${'Diff'.padEnd(12)} ${'Files'.padEnd(8)} ${'Time'.padEnd(8)}`;
    lines.push(`${BOLD}${header}${RESET}`);
    lines.push(THIN_RULE);

    for (const row of data.scoreboard) {
      const result = row.pass ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
      const isWinner = row.engineId === data.winner;
      const name = isWinner ? `${BOLD}${row.engineId}${RESET}` : row.engineId;
      // Pad with raw lengths since ANSI codes add invisible chars
      lines.push(`${name.padEnd(isWinner ? 28 : 20)} ${result.padEnd(21)} ${String(row.score).padEnd(8)} ${(row.diffLines + ' lines').padEnd(12)} ${String(row.filesChanged).padEnd(8)} ${row.durationSec + 's'}`);
    }

    if (data.synthesis) {
      lines.push('');
      const synthResult = data.synthesis.pass ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
      lines.push(`${BOLD}Synthesis:${RESET} ${synthResult} (score: ${data.synthesis.score})`);
    }

    lines.push('');
    return lines.join('\n');
  >>>

fn name=formatSessionResults params="results:SessionResult[]" returns=string export=true
  handler <<<
    if (results.length === 0) {
      return `${DIM}No results in this session yet. Run /brainstorm, /campfire, /tribunal, or /forge first.${RESET}\n`;
    }

    const sections: string[] = [];
    sections.push(`${BOLD}Session Results (${results.length})${RESET}\n`);

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const idx = i + 1;
      switch (r.type) {
        case 'brainstorm': sections.push(formatBrainstorm(r, idx)); break;
        case 'campfire': sections.push(formatCampfire(r, idx)); break;
        case 'tribunal': sections.push(formatTribunal(r, idx)); break;
        case 'forge': sections.push(formatForge(r, idx)); break;
      }
    }

    return sections.join('\n');
  >>>
```

- [ ] **Step 4: Compile and build**

```bash
npx kern compile packages/cli/src/kern/results-formatter.kern --outdir=packages/cli/src/generated
npm run build
```

- [ ] **Step 5: Run test**

Run: `npm test -- --run tests/unit/results-formatter.test.ts`
Expected: PASS — all 6 tests green

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/kern/results-formatter.kern packages/cli/src/generated/results-formatter.ts tests/unit/results-formatter.test.ts
git commit -m "feat(results-formatter): ANSI text formatter for session results pager"
```

---

### Task 3: Wire Handlers to Push Results

**Files:**
- Modify: `packages/cli/src/kern/handlers-brainstorm.kern:1-3,109-111`
- Modify: `packages/cli/src/kern/handlers-campfire.kern:1-5,89-91,126-128,155-157,167`
- Modify: `packages/cli/src/kern/handlers-tribunal.kern:1-5,94-99`
- Modify: `packages/cli/src/kern/handlers-forge.kern:1-8,203-218`

- [ ] **Step 1: Add import and result push to handlers-brainstorm.kern**

Add import at the top (after line 6):
```kern
import from="../generated/session-results.js" names="sessionResultStore"
```

Add result push after line 109 (`tracker.record(result.winner, question, result.response);`):
```javascript
    sessionResultStore.add({
      type: 'brainstorm',
      timestamp: new Date().toISOString(),
      question,
      engines,
      winner: result.winner,
      data: {
        bids: result.bids.map((b: any) => ({ engineId: b.engineId, reasoning: b.reasoning, approach: b.approach, score: b.score })),
        response: result.response,
      },
    });
```

- [ ] **Step 2: Add import and result push to handlers-campfire.kern**

Add import at the top (after line 4):
```kern
import from="../generated/session-results.js" names="sessionResultStore"
```

The campfire handler collects responses in two code paths (lead-first and all-respond). Collect rounds in a mutable array. Add before line 46 (`const cfStatus`):
```javascript
    const campfireRounds: { engineId: string; content: string }[] = [];
```

In the lead-first path, after line 90 (`appendMessage(...)`) add:
```javascript
        campfireRounds.push({ engineId: leadId, content: leadResponse });
```

In the lead-first observer path, after line 128 (`tracker.record(...)`) add:
```javascript
              campfireRounds.push({ engineId, content: response });
```

In the all-respond path, after line 157 (`tracker.record(...)`) add:
```javascript
          campfireRounds.push({ engineId, content: result.stdout.trim() });
```

After line 167 (`clearProgress();`), before the handler body closes, add:
```javascript
    sessionResultStore.add({
      type: 'campfire',
      timestamp: new Date().toISOString(),
      question: topic,
      engines,
      winner: null,
      data: { rounds: campfireRounds },
    });
```

- [ ] **Step 3: Add import and result push to handlers-tribunal.kern**

Add import at the top (after line 5):
```kern
import from="../generated/session-results.js" names="sessionResultStore"
```

Add result push after line 99 (`appendMessage(...)` — the second one):
```javascript
    sessionResultStore.add({
      type: 'tribunal',
      timestamp: new Date().toISOString(),
      question,
      engines,
      winner: null,
      data: {
        rounds: result.rounds.flatMap((round: any) =>
          round.positions.map((pos: any) => ({
            round: round.round,
            engineId: pos.engineId,
            position: pos.position,
            argument: pos.arguments[0] ?? '',
          }))
        ),
        verdict: result.summary,
      },
    });
```

- [ ] **Step 4: Add import and result push to handlers-forge.kern**

Add import at the top (after line 8):
```kern
import from="../generated/session-results.js" names="sessionResultStore"
```

Add result push after line 311 (`dispatch({ type: 'info', message: \`Plan: ${plan.id}\` });`), before the tracker loop:
```javascript
    sessionResultStore.add({
      type: 'forge',
      timestamp: new Date().toISOString(),
      question: task,
      engines: engineIds,
      winner: finalWinner ?? null,
      data: {
        scoreboard: engineIds.map((id: string, i: number) => {
          const r = results[i] as any;
          return { engineId: id, pass: r.pass, score: r.score, diffLines: r.diffLines, filesChanged: r.filesChanged, durationSec: r.durationSec };
        }),
        winner: finalWinner ?? null,
        synthesis: manifest.synthesis ?? undefined,
      },
    });
```

Also add the same push to the convergence early-return path. After line 260 (`dispatch({ type: 'info', message: \`Plan: ${plan.id}\` });`) inside the convergence block:
```javascript
            sessionResultStore.add({
              type: 'forge',
              timestamp: new Date().toISOString(),
              question: task,
              engines: engineIds,
              winner: 'convergence',
              data: {
                scoreboard: engineIds.map((id: string) => {
                  const r = (manifest.results as any)[id];
                  return { engineId: id, pass: r.pass, score: r.score, diffLines: r.diffLines, filesChanged: r.filesChanged, durationSec: r.durationSec };
                }),
                winner: 'convergence',
                synthesis: manifest.synthesis ?? undefined,
              },
            });
```

- [ ] **Step 5: Compile all modified KERN files**

```bash
npx kern compile packages/cli/src/kern/handlers-brainstorm.kern --outdir=packages/cli/src/generated
npx kern compile packages/cli/src/kern/handlers-campfire.kern --outdir=packages/cli/src/generated
npx kern compile packages/cli/src/kern/handlers-tribunal.kern --outdir=packages/cli/src/generated
npx kern compile packages/cli/src/kern/handlers-forge.kern --outdir=packages/cli/src/generated
```

- [ ] **Step 6: Build and run all tests**

```bash
npm run build
npm run test
```
Expected: All existing tests pass, no regressions

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/kern/handlers-brainstorm.kern packages/cli/src/kern/handlers-campfire.kern packages/cli/src/kern/handlers-tribunal.kern packages/cli/src/kern/handlers-forge.kern packages/cli/src/generated/handlers-brainstorm.ts packages/cli/src/generated/handlers-campfire.ts packages/cli/src/generated/handlers-tribunal.ts packages/cli/src/generated/handlers-forge.ts
git commit -m "feat(session-results): wire brainstorm/campfire/tribunal/forge handlers to store results"
```

---

### Task 4: Add Ctrl+R Keybinding and Pager Launch

**Files:**
- Modify: `packages/cli/src/kern/ui-app.kern:4,34,477-478`

- [ ] **Step 1: Add imports to ui-app.kern**

After the existing `import from="node:fs"` line (line 34), add:
```kern
import from="node:child_process" names="spawnSync"
import from="node:os" names="tmpdir"
```

Add after the session-results-related imports (around line 30 area — after other `../generated/` imports):
```kern
import from="../generated/session-results.js" names="sessionResultStore"
import from="../generated/results-formatter.js" names="formatSessionResults"
```

- [ ] **Step 2: Add pager callback inside the App screen**

Add a new callback after the `handleReviewActionCb` callback (after line 413):

```kern
  callback name=openResultsPager params="" deps="dispatch"
    handler <<<
      if (!sessionResultStore.hasResults()) {
        dispatch({ type: 'info', message: 'No results yet — run /brainstorm, /campfire, /tribunal, or /forge first' } as any);
        return;
      }
      const content = formatSessionResults(sessionResultStore.getResults());
      const tmpFile = join(tmpdir(), `agon-results-${Date.now()}.txt`);
      try {
        writeFileSync(tmpFile, content, 'utf-8');
        const pager = process.env.PAGER || 'less';
        const args = pager === 'less' ? ['-R', tmpFile] : [tmpFile];
        spawnSync(pager, args, { stdio: 'inherit' });
      } catch (err) {
        dispatch({ type: 'error', message: `Pager failed: ${err instanceof Error ? err.message : String(err)}` } as any);
      } finally {
        try { unlinkSync(tmpFile); } catch {}
      }
    >>>
```

Note: `join`, `writeFileSync`, `unlinkSync` are already imported in ui-app.kern (line 34). `tmpdir` is the new import from `node:os` (but `homedir` is already imported from `node:os` — just add `tmpdir` to that import).

- [ ] **Step 3: Add Ctrl+R keybinding in the input handler**

In the `on event=input` handler, after the Ctrl+E block (after line 478), add:

```javascript
      if (key.ctrl && input === 'r') {
        openResultsPager();
        return;
      }
```

- [ ] **Step 4: Compile and build**

```bash
npx kern compile packages/cli/src/kern/ui-app.kern --outdir=packages/cli/src/generated
npm run build
```

- [ ] **Step 5: Verify typecheck passes**

```bash
npm run typecheck
```
Expected: Clean build, no type errors

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/kern/ui-app.kern packages/cli/src/generated/ui-app.tsx
git commit -m "feat(pager): Ctrl+R opens session results in system pager"
```

---

### Task 5: Manual Integration Test

- [ ] **Step 1: Start agon and run a brainstorm**

```bash
cd ~/KERN/agon && node dist/cli/src/index.js
```

In the REPL: `best approach for error handling?`
Wait for brainstorm to complete.

- [ ] **Step 2: Press Ctrl+R**

Expected: `less` opens with formatted output showing:
- `BRAINSTORM #1` header with timestamp and question
- Each engine's bid with reasoning
- Winner's full response
- ANSI colors rendering correctly (`-R` flag)

Press `q` to exit. Verify the REPL resumes cleanly with no ghost characters.

- [ ] **Step 3: Run /clear then Ctrl+R again**

Type `/clear` to wipe the output blocks.
Press Ctrl+R again.

Expected: Pager still shows the brainstorm result (session results buffer survives /clear).

- [ ] **Step 4: Run a second command and verify numbering**

Run another brainstorm or `/campfire discuss something`.
Press Ctrl+R.

Expected: Both results shown, numbered #1 and #2 in chronological order.

---

### Task 6: Full Test Suite Verification

- [ ] **Step 1: Run full test suite**

```bash
npm run test
```

Expected: All tests pass, including the 2 new test files.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: Clean.

- [ ] **Step 3: Final commit if any fixups were needed**

Only if previous tasks required adjustments during integration testing.
