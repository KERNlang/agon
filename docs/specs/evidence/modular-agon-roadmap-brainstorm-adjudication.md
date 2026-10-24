# Roadmap brainstorm adjudication

**Agon run:** `/tmp/modular-agon-spec.nLtfrv/runs/brainstorm-1787503092217-6bg7vv`
**Engines:** `zai-coding-plan-glm-5.2`, `minimax-api`
**Input:** source-free architecture summary; no repository content

The first local-only Brainstorm attempt failed because both local llama
backends could not allocate a Metal command queue. It produced no draft and is
not counted. The isolated external retry completed 2/2; MiniMax's draft was a
truncated reasoning preamble, while GLM produced the substantive findings.

## Accepted and verified

1. **Transition evidence was under-specified.** The roadmap contained rollback
   prose and state checks, but no explicit pre-extraction legacy oracle corpus.
   Accepted: S1B now freezes a hash-bound legacy-authoritative workflow corpus;
   each later slice already carries an inverse/rollback gate.
2. **Public compatibility needs a gate before extraction.** Boundary checks do
   not prove semver stability. Accepted: S4 now requires a committed public type
   baseline plus N-1/N-2 compile/load compatibility.
3. **Fault injection needs concurrent and filesystem failures.** Process death
   alone misses torn writes, concurrent writers, ENOSPC, and EACCES. Accepted:
   S7 now names and gates these cases.
4. **Persisted schemas need historical migration evidence.** Accepted: S9 now
   requires an upgrade/downgrade policy tested against a historical state
   corpus.

## Refined

The model suggested moving all trust work before installer work. Local plan
inspection shows S7 installs only bundled/qualified first-party artifacts and
S8 is the first slice that permits third-party folder mods. Reordering is not
required, but the safety dependency is now explicit: S7 must fail closed for
third-party activation until S8 is green.

## Rejected

No accepted model claim was treated as source fact. The model's statement that
all current gates validate only snapshots was too broad: journal interruption,
rollback, safe-mode, and disabled-surface gates already describe transitions.
The missing piece was a frozen legacy oracle and more complete transition fault
classes, not a wholesale second roadmap.
