# Phase A: Real Token Capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace estimated token counts (4 chars/token) with real usage data from the Vercel AI SDK, add provenance tracking (`sdk`/`cli-reported`/`estimated`), and support model-based pricing.

**Architecture:** Extend `DispatchResult` with an optional `usage` field carrying real token counts and provenance. Update `TokenTracker` to accept real usage or fall back to estimation. Capture `result.usage` from Vercel AI SDK in `apiDispatch()` and `apiStreamDispatchWithHistory()`. All existing code continues working — changes are additive.

**Tech Stack:** KERN lang, Vercel AI SDK (`ai` package), Node.js

**Spec:** `docs/superpowers/specs/2026-04-08-cesar-plan-mode-design.md` — Part 1

---

### Task 1: Add `source` and `model` to TokenUsage, add `usage` to DispatchResult

**Files:**
- Modify: `packages/core/src/kern/types.kern:64-69` (DispatchResult)
- Modify: `packages/core/src/kern/token-tracker.kern:1-7` (TokenUsage interface)
- Test: `tests/unit/token-tracker.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/token-tracker.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { tracker, estimateTokens, estimateCost } from '../../packages/core/src/generated/token-tracker.js';
import type { TokenUsage } from '../../packages/core/src/generated/token-tracker.js';

describe('TokenTracker', () => {
  beforeEach(() => {
    tracker.reset();
  });

  it('estimateTokens uses 4-char rule', () => {
    expect(estimateTokens('hello world!')).toBe(3); // 12 chars / 4 = 3
  });

  it('record with text estimates tokens and marks source as estimated', () => {
    const usage = tracker.record('claude', { prompt: 'hello', response: 'world' });
    expect(usage.source).toBe('estimated');
    expect(usage.promptTokens).toBe(2); // 'hello' = 5 chars, ceil(5/4) = 2
    expect(usage.responseTokens).toBe(2); // 'world' = 5 chars
  });

  it('record with real usage uses exact numbers and marks source', () => {
    const usage = tracker.record('claude', {
      usage: { promptTokens: 150, completionTokens: 80, totalTokens: 230, source: 'sdk' },
    });
    expect(usage.source).toBe('sdk');
    expect(usage.promptTokens).toBe(150);
    expect(usage.responseTokens).toBe(80);
    expect(usage.totalTokens).toBe(230);
  });

  it('record with model uses model-specific pricing', () => {
    const usage = tracker.record('claude', {
      usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500, source: 'sdk' },
      model: 'claude-haiku-4-5',
    });
    // Haiku is cheaper than default Claude pricing
    expect(usage.costUsd).toBeLessThan(estimateCost('claude', 1500));
    expect(usage.model).toBe('claude-haiku-4-5');
  });

  it('getStats aggregates across mixed source types', () => {
    tracker.record('claude', { prompt: 'aaa', response: 'bbb' });
    tracker.record('codex', {
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, source: 'sdk' },
    });
    const stats = tracker.getStats();
    expect(stats.dispatches).toBe(2);
    expect(stats.byEngine['claude']).toBeDefined();
    expect(stats.byEngine['codex']).toBeDefined();
    expect(stats.byEngine['codex'].promptTokens).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/token-tracker.test.ts`
Expected: FAIL — `record` doesn't accept object form, no `source` field on TokenUsage

- [ ] **Step 3: Update TokenUsage interface in token-tracker.kern**

Edit `packages/core/src/kern/token-tracker.kern` — replace the TokenUsage interface (lines 1-7):

```kern
interface name=TokenUsage
  field name=engineId type=string
  field name=promptTokens type=number
  field name=responseTokens type=number
  field name=totalTokens type=number
  field name=costUsd type=number
  field name=timestamp type=number
  field name=source type="'sdk'|'cli-reported'|'estimated'"
  field name=model type=string optional=true
```

- [ ] **Step 4: Add model-based pricing to estimateCost**

Edit `packages/core/src/kern/token-tracker.kern` — replace `estimateCost` function (lines 22-33):

```kern
fn name=estimateCost params="engineId:string, tokens:number, model?:string" returns=number
  handler <<<
    // Model-specific pricing per 1M tokens (blended input+output). Updated 2026-04.
    const MODEL_COST: Record<string, number> = {
      'claude-opus-4-6': 45.00,
      'claude-sonnet-4-6': 9.00,
      'claude-haiku-4-5': 2.00,
      'gpt-4.1': 6.00,
      'gpt-4.1-mini': 1.20,
      'gpt-4.1-nano': 0.30,
      'gemini-2.5-pro': 5.00,
      'gemini-2.5-flash': 0.60,
      'o3': 30.00,
      'o4-mini': 2.80,
    };
    if (model && MODEL_COST[model]) {
      return (tokens / 1_000_000) * MODEL_COST[model];
    }
    // Fallback: engine-level blended average
    const ENGINE_COST: Record<string, number> = {
      claude: 9.00, codex: 5.00, gemini: 1.25, ollama: 0.00,
      aider: 9.00, openrouter: 3.00, qwen: 0.50, mistral: 0.50,
      opencode: 5.00,
    };
    const rate = ENGINE_COST[engineId] ?? 2.00;
    return (tokens / 1_000_000) * rate;
  >>>
```

- [ ] **Step 5: Update TokenTracker.record to accept unified input**

Edit `packages/core/src/kern/token-tracker.kern` — replace the `record` method (lines 38-47):

```kern
  method name=record params="engineId:string, input:{prompt:string,response:string}|{usage:{promptTokens:number,completionTokens:number,totalTokens:number,source:'sdk'|'cli-reported'|'estimated'},model?:string}" returns=TokenUsage
    handler <<<
      let promptTokens: number, responseTokens: number, totalTokens: number, source: TokenUsage['source'], model: string | undefined, costUsd: number;

      if ('usage' in input) {
        promptTokens = input.usage.promptTokens;
        responseTokens = input.usage.completionTokens;
        totalTokens = input.usage.totalTokens;
        source = input.usage.source;
        model = input.model;
        costUsd = estimateCost(engineId, totalTokens, model);
      } else {
        promptTokens = estimateTokens(input.prompt);
        responseTokens = estimateTokens(input.response);
        totalTokens = promptTokens + responseTokens;
        source = 'estimated';
        model = undefined;
        costUsd = estimateCost(engineId, totalTokens);
      }

      const usage: TokenUsage = { engineId, promptTokens, responseTokens, totalTokens, costUsd, timestamp: Date.now(), source, model };
      this.usages.push(usage);
      return usage;
    >>>
```

- [ ] **Step 6: Add `usage` field to DispatchResult in types.kern**

Edit `packages/core/src/kern/types.kern` — add after the `timedOut` field (line 69):

```kern
  field name=usage type="{promptTokens:number,completionTokens:number,totalTokens:number,source:'sdk'|'cli-reported'|'estimated'}" optional=true
```

- [ ] **Step 7: Compile, build, test**

```bash
npx kern compile packages/core/src/kern/token-tracker.kern --outdir=packages/core/src/generated
npx kern compile packages/core/src/kern/types.kern --outdir=packages/core/src/generated
npm run build
npm test -- --run tests/unit/token-tracker.test.ts
```
Expected: PASS — all 5 tests green

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/kern/token-tracker.kern packages/core/src/generated/token-tracker.ts packages/core/src/kern/types.kern packages/core/src/generated/types.ts tests/unit/token-tracker.test.ts
git commit -m "feat(tokens): add source provenance, model pricing, and unified record() API"
```

---

### Task 2: Capture real usage from Vercel AI SDK in apiDispatch

**Files:**
- Modify: `packages/core/src/kern/api-dispatch.kern:145-155` (generateText path)
- Modify: `packages/core/src/kern/api-dispatch.kern:197-291` (streamText path)
- Test: `tests/unit/api-dispatch.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/api-dispatch.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AI SDK before importing
vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  jsonSchema: vi.fn(),
}));
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => vi.fn(() => 'mock-model')),
}));
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => 'mock-model')),
}));

import { generateText } from 'ai';
import { apiDispatch } from '../../packages/core/src/generated/api-dispatch.js';

const mockGenerateText = vi.mocked(generateText);

describe('apiDispatch usage capture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEST_API_KEY = 'test-key';
  });

  it('includes usage in result when SDK provides it', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'Hello world',
      usage: { promptTokens: 100, completionTokens: 50 },
    } as any);

    const result = await apiDispatch(
      { baseUrl: 'http://test', apiKeyEnv: 'TEST_API_KEY', model: 'test-model' },
      'test prompt',
      30,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('Hello world');
    expect(result.usage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      source: 'sdk',
    });
  });

  it('returns undefined usage when SDK does not provide it', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'Hello world',
    } as any);

    const result = await apiDispatch(
      { baseUrl: 'http://test', apiKeyEnv: 'TEST_API_KEY', model: 'test-model' },
      'test prompt',
      30,
    );

    expect(result.exitCode).toBe(0);
    expect(result.usage).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/api-dispatch.test.ts`
Expected: FAIL — `result.usage` is undefined even when SDK provides it

- [ ] **Step 3: Update apiDispatch to capture usage**

Edit `packages/core/src/kern/api-dispatch.kern` — replace line 155 (the return statement in the generateText try block):

Before:
```javascript
      return { exitCode: 0, stdout: text, stderr: '', durationMs: Date.now() - startTime, timedOut: false };
```

After:
```javascript
      const usage = result.usage ? {
        promptTokens: result.usage.promptTokens ?? 0,
        completionTokens: result.usage.completionTokens ?? 0,
        totalTokens: (result.usage.promptTokens ?? 0) + (result.usage.completionTokens ?? 0),
        source: 'sdk' as const,
      } : undefined;
      return { exitCode: 0, stdout: text, stderr: '', durationMs: Date.now() - startTime, timedOut: false, usage };
```

- [ ] **Step 4: Update apiStreamDispatchWithHistory to capture usage**

Edit `packages/core/src/kern/api-dispatch.kern` — replace line 290 (the return at the end of the stream function):

Before:
```javascript
    return { exitCode: 0, stdout, stderr: '', durationMs: Date.now() - startTime, timedOut: false };
```

After:
```javascript
    // Try to capture usage from the stream result
    let usage: DispatchResult['usage'] = undefined;
    try {
      const finalUsage = await (result as any).usage;
      if (finalUsage) {
        usage = {
          promptTokens: finalUsage.promptTokens ?? 0,
          completionTokens: finalUsage.completionTokens ?? 0,
          totalTokens: (finalUsage.promptTokens ?? 0) + (finalUsage.completionTokens ?? 0),
          source: 'sdk' as const,
        };
      }
    } catch {}
    return { exitCode: 0, stdout, stderr: '', durationMs: Date.now() - startTime, timedOut: false, usage };
```

Note: `streamText` returns a `result` object with an async `usage` property that resolves when the stream completes. We await it after the stream loop.

- [ ] **Step 5: Compile, build, test**

```bash
npx kern compile packages/core/src/kern/api-dispatch.kern --outdir=packages/core/src/generated
npm run build
npm test -- --run tests/unit/api-dispatch.test.ts
```
Expected: PASS

- [ ] **Step 6: Run full test suite**

```bash
npm run test
```
Expected: All tests pass — no regressions

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/kern/api-dispatch.kern packages/core/src/generated/api-dispatch.ts tests/unit/api-dispatch.test.ts
git commit -m "feat(tokens): capture real usage from Vercel AI SDK in api dispatch"
```

---

### Task 3: Migrate existing tracker.record calls to new API

**Files:**
- Modify: `packages/cli/src/kern/handlers-brainstorm.kern` (lines 106-109)
- Modify: `packages/cli/src/kern/handlers-campfire.kern` (lines 91, 128, 157)
- Modify: `packages/cli/src/kern/handlers-tribunal.kern` (lines 101-105)
- Modify: `packages/cli/src/kern/handlers-chat.kern` (tracker.record calls)
- Modify: `packages/forge/src/kern/stages.kern` (tracker.record calls)

- [ ] **Step 1: Update handlers-brainstorm.kern**

All `tracker.record(engineId, text1, text2)` calls become `tracker.record(engineId, { prompt: text1, response: text2 })`. In `handlers-brainstorm.kern`, replace:

```javascript
    for (const bid of result.bids) {
      tracker.record(bid.engineId, question, bid.reasoning);
    }
    tracker.record(result.winner, question, result.response);
```

With:
```javascript
    for (const bid of result.bids) {
      tracker.record(bid.engineId, { prompt: question, response: bid.reasoning });
    }
    tracker.record(result.winner, { prompt: question, response: result.response });
```

- [ ] **Step 2: Update handlers-campfire.kern**

Replace all `tracker.record(engineId, topic, text)` with `tracker.record(engineId, { prompt: topic, response: text })`:

Line 91: `tracker.record(leadId, { prompt: topic, response: leadResponse });`
Line 128: `tracker.record(engineId, { prompt: topic, response: response });`  
Line 157: `tracker.record(engineId, { prompt: topic, response: result.stdout });`

- [ ] **Step 3: Update handlers-tribunal.kern**

Replace `tracker.record(pos.engineId, question, pos.arguments.join(' '))` with:
```javascript
      tracker.record(pos.engineId, { prompt: question, response: pos.arguments.join(' ') });
```

- [ ] **Step 4: Find and update all remaining tracker.record calls**

Search for all `tracker.record(` across the codebase and update each to the new object form. Key files:
- `handlers-chat.kern` 
- `handlers-cesar-brain.kern`
- `handlers-pipeline.kern`
- `forge/src/kern/stages.kern`
- `forge/src/kern/forge.kern`

Each `tracker.record(id, str1, str2)` → `tracker.record(id, { prompt: str1, response: str2 })`

- [ ] **Step 5: Compile all modified files**

```bash
npx kern compile packages/cli/src/kern/handlers-brainstorm.kern --outdir=packages/cli/src/generated
npx kern compile packages/cli/src/kern/handlers-campfire.kern --outdir=packages/cli/src/generated
npx kern compile packages/cli/src/kern/handlers-tribunal.kern --outdir=packages/cli/src/generated
# Compile any other modified .kern files found in Step 4
npm run build
```

- [ ] **Step 6: Run full test suite**

```bash
npm run test
```
Expected: All tests pass — the new API is backwards compatible via the unified `record()` signature

- [ ] **Step 7: Commit**

```bash
git add -u packages/
git commit -m "refactor(tokens): migrate all tracker.record calls to unified object API"
```

---

### Task 4: Wire real usage from DispatchResult into TokenTracker

**Files:**
- Modify: `packages/adapter-cli/src/kern/adapter.kern:37-41` (API dispatch path)
- Modify: `packages/cli/src/kern/handlers-chat.kern` (chat dispatch)
- Modify: `packages/cli/src/kern/cesar-session.kern` (Delegate tool dispatch)
- Test: verify via `/tokens` in manual test

- [ ] **Step 1: Pass usage through in CLI adapter API fallback**

In `packages/adapter-cli/src/kern/adapter.kern`, the API fallback path (line 37) calls `apiDispatch()` and returns the result directly. Since `apiDispatch` now includes `usage` in its return, this already flows through. Verify by reading the code — no change needed here if the result is returned as-is.

- [ ] **Step 2: Update handlers-chat.kern to use real usage when available**

In the chat handler, after dispatching to an engine and getting the result, check if `result.usage` exists:

```javascript
    if (result.usage) {
      tracker.record(engineId, { usage: result.usage, model: engine.api?.model });
    } else {
      tracker.record(engineId, { prompt: question, response: result.stdout });
    }
```

Find the existing `tracker.record` call in `handlers-chat.kern` and replace it with this pattern.

- [ ] **Step 3: Update Delegate tool handler to record real usage**

In `packages/cli/src/kern/cesar-session.kern`, inside the Delegate tool handler (the `if (name === 'Delegate')` block), after the successful dispatch, add usage tracking:

```javascript
        // Track token usage
        if (result.usage) {
          tracker.record(targetId, { usage: result.usage });
        } else {
          tracker.record(targetId, { prompt: task, response: cleaned });
        }
```

Add `tracker` import if not already present: `import from="@agon/core" names="tracker"`.

- [ ] **Step 4: Compile all modified files**

```bash
npx kern compile packages/cli/src/kern/handlers-chat.kern --outdir=packages/cli/src/generated
npx kern compile packages/cli/src/kern/cesar-session.kern --outdir=packages/cli/src/generated
npm run build
```

- [ ] **Step 5: Run full test suite**

```bash
npm run test
```
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add -u packages/
git commit -m "feat(tokens): wire real DispatchResult usage into TokenTracker"
```

---

### Task 5: Update `/tokens` display to show provenance

**Files:**
- Modify: `packages/cli/src/kern/handlers-info.kern:357-380` (handleTokens)

- [ ] **Step 1: Update the tokens display table**

In `handlers-info.kern`, the `handleTokens()` function displays a table. Update it to show whether costs are real or estimated. Find the table rendering code and add a provenance column.

In the header row, add `Source` column:
```javascript
    const header = `${'Engine'.padEnd(12)} ${'Calls'.padEnd(6)} ${'Prompt'.padEnd(10)} ${'Response'.padEnd(10)} ${'Total'.padEnd(10)} ${'Cost (USD)'.padEnd(12)} ${'Source'.padEnd(10)}`;
```

In the per-engine row, determine the dominant source for that engine (check the most recent usage for each engine) and display it. If all usages for an engine are `sdk`, show `sdk`. If mixed, show `mixed`. If all estimated, show `est`.

For the cost column, prefix with `~` when source is `estimated`: `~$0.0180` vs `$0.0180`.

- [ ] **Step 2: Compile and build**

```bash
npx kern compile packages/cli/src/kern/handlers-info.kern --outdir=packages/cli/src/generated
npm run build
```

- [ ] **Step 3: Run tests**

```bash
npm run test
```
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/kern/handlers-info.kern packages/cli/src/generated/handlers-info.ts
git commit -m "feat(tokens): show provenance in /tokens display"
```

---

### Task 6: Full Integration Verification

- [ ] **Step 1: Run full test suite**

```bash
npm run test
npm run typecheck
```
Expected: All 654+ tests pass, zero type errors

- [ ] **Step 2: Manual verification**

Start agon, send a message to an API engine, run `/tokens`. Verify:
- Token counts come from SDK (not estimated) for API engines
- Source column shows `sdk` for API dispatches
- Cost uses model-specific pricing when model is known
- Estimated dispatches (CLI engines) show `est` and `~` prefix on cost

- [ ] **Step 3: Final commit if any fixups needed**

Only if previous tasks required adjustments during testing.
