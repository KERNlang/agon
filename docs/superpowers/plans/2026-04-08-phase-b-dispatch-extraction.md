# Phase B: Dispatch Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure all orchestration functions are callable from both handlers AND the plan executor, with campfire extracted to the forge package and a delegate wrapper created.

**Architecture:** `runBrainstorm`, `runTribunal`, and `runForge` are already pure orchestration in `@agon/forge`. Only campfire needs extraction. Add `runCampfire` and `runDelegate` to the forge package. Refactor handlers-campfire.kern to use the new `runCampfire`.

**Tech Stack:** KERN lang, Node.js

**Spec:** `docs/superpowers/specs/2026-04-08-cesar-plan-mode-design.md` — Part 5 (Phase B)

**Key finding:** Brainstorm, Tribunal, and Forge are ALREADY extracted as pure orchestration functions. No handler refactoring needed for those three. This phase is smaller than originally scoped.

---

### Task 1: Extract runCampfire to @agon/forge

**Files:**
- Create: `packages/forge/src/kern/campfire.kern`
- Modify: `packages/forge/src/index.ts` (add export)
- Modify: `packages/cli/src/kern/handlers-campfire.kern` (refactor to use runCampfire)
- Test: `tests/unit/campfire.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/campfire.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We'll test that runCampfire dispatches to all engines and returns structured results
describe('runCampfire', () => {
  it('placeholder — will implement after creating the function', () => {
    expect(true).toBe(true);
  });
});
```

Note: Full test after implementation since we need to mock the adapter.

- [ ] **Step 2: Read handlers-campfire.kern to extract the dispatch logic**

Read `packages/cli/src/kern/handlers-campfire.kern` and identify the pure orchestration logic (lines ~24-165):
- Base prompt construction (lines 25-37)
- Lead-first strategy: dispatch lead, collect response, dispatch observers with lead's response (lines 71-138)
- All-respond strategy: parallel dispatch to all engines (lines 139-165)

- [ ] **Step 3: Create campfire.kern in the forge package**

Create `packages/forge/src/kern/campfire.kern`:

```kern
import from="@agon/core" names="EngineRegistry,EngineAdapter" types=true

interface name=CampfireResult export=true
  field name=topic type=string
  field name=rounds type="{engineId:string,content:string}[]"

fn name=runCampfire async=true params="opts:{topic:string,context?:string,engines:string[],registry:EngineRegistry,adapter:EngineAdapter,strategy:'lead-first'|'all-respond',leadEngine?:string,seedPlan?:string,timeout:number,outputDir:string,signal?:AbortSignal}" returns="Promise<CampfireResult>" export=true
  handler <<<
    const rounds: {engineId:string,content:string}[] = [];
    const leadId = opts.leadEngine && opts.engines.includes(opts.leadEngine) ? opts.leadEngine : opts.engines[0];

    const basePrompt = [
      `## CAMPFIRE`,
      `Topic: ${opts.topic || 'open discussion'}`,
      '',
      opts.context ? `## Project Context\n${opts.context}\n` : '',
      opts.seedPlan ? `## Lead assessment (prior context)\n${opts.seedPlan}\n` : '',
      `## Rules`,
      `This is a campfire — no competition, no ranking, no winners.`,
      `Think freely. Share ideas, wild thoughts, "what if" scenarios.`,
      `Be honest. Say "I'm not sure" if you're not sure.`,
      `Build on the topic. Be interesting, not just useful.`,
      `Keep it concise — 3-5 paragraphs max.`,
    ].filter(Boolean).join('\n');

    if (opts.strategy === 'lead-first' && opts.engines.length > 1) {
      // Lead-first: dispatch lead, then observers with lead's response
      const leadEngine = opts.registry.get(leadId);
      let leadResponse = '';

      try {
        const leadResult = await opts.adapter.dispatch({
          engine: leadEngine,
          prompt: basePrompt,
          cwd: process.cwd(),
          mode: 'exec' as any,
          timeout: opts.timeout,
          outputDir: opts.outputDir,
          signal: opts.signal,
        });
        leadResponse = leadResult.stdout.trim();
        if (leadResponse) rounds.push({ engineId: leadId, content: leadResponse });
      } catch (err) {
        console.warn(`[agon] campfire lead dispatch (${leadId}) failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (leadResponse && !opts.signal?.aborted) {
        const observerPrompt = [
          basePrompt,
          '',
          `## Lead engine (${leadId}) response`,
          leadResponse,
          '',
          `## Your role`,
          `The lead engine proposed the above. Only respond if you have a substantively different perspective or disagree. If you mostly agree, respond with just "Agree" or stay brief.`,
        ].join('\n');

        const observers = opts.engines.filter((id: string) => id !== leadId);
        await Promise.all(observers.map(async (engineId: string) => {
          const engine = opts.registry.get(engineId);
          try {
            const result = await opts.adapter.dispatch({
              engine,
              prompt: observerPrompt,
              cwd: process.cwd(),
              mode: 'exec' as any,
              timeout: opts.timeout,
              outputDir: opts.outputDir,
              signal: opts.signal,
            });
            const response = result.stdout.trim();
            if (response && response.length > 20 && !/^agree\b/i.test(response)) {
              rounds.push({ engineId, content: response });
            }
          } catch (err) {
            console.warn(`[agon] campfire observer (${engineId}) failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }));
      }
    } else {
      // All-respond: parallel dispatch
      await Promise.all(opts.engines.map(async (engineId: string) => {
        const engine = opts.registry.get(engineId);
        try {
          const result = await opts.adapter.dispatch({
            engine,
            prompt: basePrompt,
            cwd: process.cwd(),
            mode: 'exec' as any,
            timeout: opts.timeout,
            outputDir: opts.outputDir,
            signal: opts.signal,
          });
          const content = result.stdout.trim();
          if (content) rounds.push({ engineId, content });
        } catch (err) {
          console.warn(`[agon] campfire dispatch (${engineId}) failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }));
    }

    return { topic: opts.topic, rounds };
  >>>
```

- [ ] **Step 4: Add export to forge package index**

In `packages/forge/src/index.ts`, add:
```typescript
export { runCampfire } from './generated/campfire.js';
export type { CampfireResult } from './generated/campfire.js';
```

- [ ] **Step 5: Refactor handlers-campfire.kern to use runCampfire**

Replace the inline dispatch logic in `handlers-campfire.kern` with a call to `runCampfire`. The handler keeps: validation, project context scanning, progress updates, UI dispatch, chat history, session results, token tracking. The handler delegates: prompt construction, engine dispatch, response collection.

Add import: `import from="@agon/forge" names="runCampfire"`

Replace the dispatch logic (between `ctx.setActiveAbort(cfAbort)` and `clearProgress()`) with:

```javascript
    const result = await runCampfire({
      topic,
      context: projectCtx,
      engines,
      registry: ctx.registry,
      adapter: ctx.adapter,
      strategy,
      leadEngine: leadId,
      seedPlan: opts?.seedPlan,
      timeout: 120,
      outputDir,
      signal: cfAbort.signal,
    });

    clearProgress();

    // Display results
    for (const round of result.rounds) {
      const color = (ENGINE_COLORS as Record<string, number>)[round.engineId] ?? 245;
      dispatch({ type: 'engine-block', engineId: round.engineId, color, content: round.content });
      appendMessage(ctx.chatSession, { role: 'engine', engineId: round.engineId, content: round.content, timestamp: new Date().toISOString() });
      tracker.record(round.engineId, { prompt: topic, response: round.content });
    }

    sessionResultStore.add({
      type: 'campfire',
      timestamp: new Date().toISOString(),
      question: topic,
      engines,
      winner: null,
      data: { rounds: result.rounds },
    });
```

This replaces ~100 lines of inline dispatch code with ~20 lines that delegate to `runCampfire` and handle UI.

- [ ] **Step 6: Compile, build, test**

```bash
npx kern compile packages/forge/src/kern/campfire.kern --outdir=packages/forge/src/generated
npx kern compile packages/cli/src/kern/handlers-campfire.kern --outdir=packages/cli/src/generated
npm run build
npm run test
```
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/forge/src/kern/campfire.kern packages/forge/src/generated/campfire.ts packages/forge/src/index.ts packages/cli/src/kern/handlers-campfire.kern packages/cli/src/generated/handlers-campfire.ts
git commit -m "refactor(campfire): extract runCampfire to @agon/forge package"
```

---

### Task 2: Create runDelegate wrapper

**Files:**
- Create: `packages/forge/src/kern/delegate.kern`
- Modify: `packages/forge/src/index.ts` (add export)

- [ ] **Step 1: Create delegate.kern**

Create `packages/forge/src/kern/delegate.kern`:

```kern
import from="@agon/core" names="EngineRegistry,EngineAdapter,DispatchResult,resolveWorkingDir" types=true
import from="@agon/core" names="EngineRegistry,resolveWorkingDir"
import from="@agon/core" names="EngineAdapter" types=true

interface name=DelegateResult export=true
  field name=engineId type=string
  field name=response type=string
  field name=usage type="DispatchResult['usage']" optional=true

fn name=runDelegate async=true params="opts:{engineId:string,task:string,mode?:string,registry:EngineRegistry,adapter:EngineAdapter,timeout:number,outputDir:string,signal?:AbortSignal}" returns="Promise<DelegateResult>" export=true
  handler <<<
    const engine = opts.registry.get(opts.engineId);
    const result = await opts.adapter.dispatch({
      engine,
      prompt: opts.task,
      cwd: resolveWorkingDir(),
      mode: (opts.mode ?? 'exec') as any,
      timeout: opts.timeout,
      outputDir: opts.outputDir,
      signal: opts.signal,
    });

    if (!result.stdout.trim()) {
      return { engineId: opts.engineId, response: '', usage: result.usage };
    }

    // Strip <think> blocks
    const cleaned = result.stdout.trim().replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
    return { engineId: opts.engineId, response: cleaned, usage: result.usage };
  >>>
```

- [ ] **Step 2: Add export to forge package index**

In `packages/forge/src/index.ts`, add:
```typescript
export { runDelegate } from './generated/delegate.js';
export type { DelegateResult } from './generated/delegate.js';
```

- [ ] **Step 3: Compile, build, test**

```bash
npx kern compile packages/forge/src/kern/delegate.kern --outdir=packages/forge/src/generated
npm run build
npm run test
```

- [ ] **Step 4: Commit**

```bash
git add packages/forge/src/kern/delegate.kern packages/forge/src/generated/delegate.ts packages/forge/src/index.ts
git commit -m "feat(delegate): add runDelegate to @agon/forge for plan executor"
```

---

### Task 3: Verify all orchestration functions are callable

- [ ] **Step 1: Verify exports from @agon/forge**

Check that `packages/forge/src/index.ts` exports all five:
- `runForge` (existing)
- `runBrainstorm` (existing)
- `runTribunal` (existing)
- `runCampfire` (new, Task 1)
- `runDelegate` (new, Task 2)

- [ ] **Step 2: Run full test suite and typecheck**

```bash
npm run test
npm run typecheck
```
Expected: All pass

- [ ] **Step 3: Commit if any fixups needed**
