# Campfire Prompt: KERN Compiler Gaps

Paste this into Agon to let the engines work on it.

---

## For brainstorm (syntax design)

```
I'm building KERNlang — a universal IR that compiles to 11 targets (nextjs, vue, native, express, etc). It's working: core is 95% KERN, forge is 90%. But the CLI package is only 20% because the compiler is missing 5 primitives.

I need syntax proposals for each. Here are the gaps with test cases:

1. CLASS — need stateful objects with methods. Current TS: `class TokenTracker { private entries = []; record(usage) { ... } getStats() { ... } }`. What should `.kern` syntax look like? Options: `service` node with `method`, `object` with closure-state, or something else?

2. INK TRANSPILER — I have `screen name=X target=ink` blocks with JSX in handler blocks. The compiler needs to generate React/Ink function components from these. What's the compilation model?

3. ASYNC-FN — handlers use `for await`, `AbortController`, `setInterval`, `try/finally`. Should KERN add `async-fn` with `signal` + `cleanup` blocks, or just allow `async=true` on regular `fn`, or introduce a `flow` orchestration node?

4. FUNCTION TYPES — `type Dispatch = (event: E) => void` can't be expressed. Should `type` node accept a `value` attribute for arbitrary TS type expressions?

5. DEFAULT PARAMS — `fn params="spread:number=8"` doesn't parse. Should the parser support `=default` inline in the params string?

6. DISCRIMINATED UNIONS — `type ContentSegment = { type: 'prose'; text: string } | { type: 'code'; ... }`. Should KERN add a `union` node with `variant` children?

Rank by leverage: which gap, if solved first, unlocks the most hand-maintained code to move to KERN? Propose concrete syntax for the top 3.
```

## For tribunal (architecture debate)

```
Debate: should KERNlang add a `class` primitive or stay purely functional?

FOR classes: 3 substantial files (EngineRegistry, TokenTracker, CliAdapter) are blocked. These are stateful objects with encapsulated mutation. A `service` node with `method` and `field` is the natural model. Every target language has classes.

AGAINST classes: KERN's strength is declarative IR. Classes introduce mutable state, `this` binding, inheritance questions. A functional approach with `object` + closures keeps KERN simple and maps better to functional targets. The 3 blocked files could be refactored to pure functions + module-level state.

Which approach serves a language that targets 11 platforms better?
```

## For forge (implementation)

```
Implement default parameter values in the KERN compiler.

Current behavior: `fn name=foo params="x:number=8"` fails to parse.
Expected behavior: generates `function foo(x: number = 8)`.

The compiler lives at /Users/nicolascukas/GitHub/kern-lang/packages/core/
Parser is in the core package. The `fn` node handler extracts params as a comma-separated string of `name:type` pairs.

Test: add a .kern fixture with default params, verify compiled output matches expected TS.
Fitness: npm test in kern-lang root.
```
