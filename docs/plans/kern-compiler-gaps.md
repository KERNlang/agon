# KERN Compiler Gaps — What Blocks Full Agon-in-KERN

> **Superseded on 2026-04-16.**
> This document reflects an older Kern baseline and now overstates what is
> missing. In current Kern, `service`/class generation, `implements`,
> `singleton`, discriminated unions, default params, and `signal` + `cleanup`
> are already available, and the specific Ink gaps called out here have been
> closed in regenerated Agon output. The remaining real blocker is narrower:
> `machine` transitions still need typed payload parameters and first-class
> guards. See `kern-lang/docs/superpowers/specs/2026-04-16-agon-gap-closure-backlog.md`
> for the current backlog.
>
> This document is input for Agon engines. Each gap is a concrete problem
> with test cases. Engines should propose KERN syntax + compiler output.
> Confidence: 0.4 on the right syntax for each — that's why this is here.

## Status: core 95% | forge 90% | adapter-cli 60% | cli 20%

The remaining hand-maintained TypeScript exists because KERNlang lacks
5 primitives. This doc specifies each gap, shows what the TS looks like,
and asks: what should the .kern source look like?

---

## Gap 1: `class` — P0, highest leverage

### Problem
3 substantial classes cannot be expressed in KERN:
- `EngineRegistry` (core) — Map-backed registry with load/register/get/list
- `TokenTracker` (core) — accumulator with record/getStats/reset + singleton
- `CliAdapter` (adapter-cli) — implements `EngineAdapter` interface

### What the TS looks like
```typescript
export class TokenTracker {
  private entries: TokenUsage[] = [];

  record(usage: TokenUsage): void {
    this.entries.push(usage);
  }

  getStats(): SessionStats {
    return {
      totalTokens: this.entries.reduce((s, e) => s + e.total, 0),
      totalCost: this.entries.reduce((s, e) => s + estimateCost(e), 0),
      calls: this.entries.length,
    };
  }

  reset(): void { this.entries = []; }
}

export const tracker = new TokenTracker();
```

### What should the .kern look like?

Option A — `service` node:
```kern
service name=TokenTracker
  field name=entries type="TokenUsage[]" default="[]" private=true

  method name=record params="usage:TokenUsage" returns=void
    handler <<<
      this.entries.push(usage);
    >>>

  method name=getStats returns=SessionStats
    handler <<<
      return {
        totalTokens: this.entries.reduce((s, e) => s + e.total, 0),
        totalCost: this.entries.reduce((s, e) => s + estimateCost(e), 0),
        calls: this.entries.length,
      };
    >>>

  method name=reset returns=void
    handler <<<
      this.entries = [];
    >>>

singleton name=tracker type=TokenTracker
```

Option B — `object` with closures (no `this`):
```kern
object name=TokenTracker
  state name=entries type="TokenUsage[]" init="[]"
  fn name=record params="entries:TokenUsage[], usage:TokenUsage" returns="TokenUsage[]"
    handler <<< return [...entries, usage]; >>>
  fn name=getStats params="entries:TokenUsage[]" returns=SessionStats
    handler <<< ... >>>
```

Option C — something else entirely?

### Test case for compiler output
Input: the .kern source above
Expected output: a TypeScript class with methods, exported.
Verify: `new TokenTracker()` works, methods are callable, state is encapsulated.

### Also needed: `implements`
```kern
service name=CliAdapter implements=EngineAdapter
  ...
```
This must produce `class CliAdapter implements EngineAdapter { ... }`.

---

## Gap 2: Ink transpiler — P1, unlocks CLI UI

### Problem
4 KERN files define `screen` components for `target=ink`:
- `ui-app.kern` — full REPL layout
- `ui-blocks.kern` — all output block renderers
- `ui-slash-picker.kern` — command picker
- `ui-onboarding.kern` — setup wizard

These compile to nothing. The actual UI is 700+ lines of hand-maintained
React/Ink in `app.tsx` and `onboarding.tsx`.

### What the compiler should produce
```kern
screen name=SpinnerBlock target=ink
  spinner message={message} color={color}
```
Should compile to:
```typescript
import React from 'react';
import { Text } from 'ink';
import Spinner from 'ink-spinner';

export function SpinnerBlock({ message, color }: { message: string; color?: string }) {
  return (
    <Text>
      <Text color={color ?? 'yellow'}><Spinner type="dots" /></Text>
      <Text> {message}</Text>
    </Text>
  );
}
```

### Complexity: handler blocks with JSX
The `ui-blocks.kern` screens already use `handler <<<...>>>` with raw JSX
inside. The compiler needs to:
1. Detect `target=ink`
2. Generate proper React/Ink imports
3. Wrap handler JSX in a function component
4. Derive props from referenced variables

### Test case
Compile `ui-blocks.kern` → generate `generated/ui-blocks.tsx`
Verify: components render in Ink, match current `app.tsx` behavior.

---

## Gap 3: `async-fn` / signal pattern — P2, unlocks handlers

### Problem
All 7 CLI handlers use async patterns KERN can't express:
- `for await (const chunk of stream) { ... }`
- `setInterval` + `clearInterval` for progress
- `AbortController` / `signal` for cancellation
- `try/finally` cleanup

### What the TS looks like
```typescript
async function handleChat(input: string, dispatch: Dispatch, ctx: HandlerContext): Promise<void> {
  const abort = new AbortController();
  ctx.setActiveAbort(abort);
  try {
    const gen = adapter.dispatchStream(engine, prompt, { signal: abort.signal });
    for await (const chunk of gen) {
      dispatch({ type: 'streaming-chunk', engineId, chunk });
    }
  } finally {
    ctx.setActiveAbort(null);
  }
}
```

### What should the .kern look like?

Option A — `async-fn` with signal support:
```kern
async-fn name=handleChat params="input:string, dispatch:Dispatch, ctx:HandlerContext"
  signal name=abort
  handler <<<
    const gen = adapter.dispatchStream(engine, prompt, { signal: abort.signal });
    for await (const chunk of gen) {
      dispatch({ type: 'streaming-chunk', engineId, chunk });
    }
  >>>
  cleanup <<<
    ctx.setActiveAbort(null);
  >>>
```

Option B — just allow `async` flag on regular `fn`:
```kern
fn name=handleChat params="..." returns="Promise<void>" async=true
  handler <<<
    // full async body, no special syntax
  >>>
```

Option C — `flow` node for orchestration patterns?

### Test case
Compile → produces async function with proper try/finally.
Verify: abort mid-stream cancels cleanly.

---

## Gap 4: Function types in `type` node — P3

### Problem
```typescript
type ForgeEventCallback = (event: ForgeEvent) => void;
type Dispatch = (event: OutputEvent) => void;
```
KERN `type` node produces string literal unions, not function signatures.

### Proposed syntax
```kern
type name=ForgeEventCallback value="(event: ForgeEvent) => void"
type name=Dispatch value="(event: OutputEvent) => void"
```
Compiler output: `export type ForgeEventCallback = (event: ForgeEvent) => void;`

---

## Gap 5: Default parameter values — P3

### Problem
```typescript
function determineWinner(results: StageResult[], spread: number = 8): ...
```
KERN `fn` params have no default syntax.

### Proposed syntax
```kern
fn name=determineWinner params="results:StageResult[], spread:number=8" returns=...
```
Compiler output: `function determineWinner(results: StageResult[], spread: number = 8): ...`

---

## Gap 6: Discriminated unions — P3

### Problem
```typescript
export type ContentSegment =
  | { type: 'prose'; text: string }
  | { type: 'code'; language: string; code: string };
```
KERN `interface` produces flat interfaces with optional fields.
No way to express a proper tagged union where each variant has different fields.

### Proposed syntax
```kern
union name=ContentSegment discriminant=type
  variant name=prose
    field name=text type=string
  variant name=code
    field name=language type=string
    field name=code type=string
```
Compiler output: the TypeScript discriminated union above.

---

## Priority order for the engines

| Priority | Gap | Unlocks | Lines freed |
|----------|-----|---------|-------------|
| P0 | `class`/`service` | EngineRegistry, TokenTracker, CliAdapter | ~400 |
| P1 | Ink transpiler | 4 ui-*.kern screens → real components | ~500 |
| P2 | `async-fn` | 7 handler files | ~1200 |
| P3 | Function types + defaults + unions | Thin wrappers elimination | ~100 |

**Total: ~2200 lines of hand-maintained TS that would become KERN.**

---

## How to use this document

### As a brainstorm prompt
```
brainstorm: given these 6 KERN compiler gaps, which syntax proposals
are best? evaluate each Option A/B/C. propose alternatives.
```

### As a forge task
```
implement Gap 5 (default params) in the KERN compiler at
/Users/nicolascukas/GitHub/kern-lang/packages/core/
test with: npm test
```

### As a tribunal debate
```
tribunal: should KERN add a `class` primitive (Option A) or stay
purely functional with `object` closures (Option B)?
```
