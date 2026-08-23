# Modular Agon Slice 1A independent-review adjudication

**Date:** 2026-08-22
**Scope:** non-shipping Slice 1A foundation
**Primary run:** `/Users/ra/.agon/runs/review-1787430092188-pv7yyb-modular-slice1a-final-focused`
**Fix review:** `/Users/ra/.agon/runs/review-1787430519012-u1tsvf-modular-slice1a-review-fixes`

The primary Agon review used independent Kimi, GLM, and MiniMax seats over a
sanitized copy. Kimi completed, MiniMax completed, and GLM timed out. Every
machine finding was then checked against the actual worktree and executable
evidence. The focused follow-up reviewed the resulting three-file hardening
diff with Claude and Kimi; Claude completed with no blocking or important
finding, while Kimi timed out.

## Accepted and resolved

- TUI probe parsing now throws on a missing or non-finite p95 rather than merely
  producing a failed budget receipt.
- The topological queue now explicitly prevents duplicate enqueue/emission,
  asserts complete output, and has a diamond-graph regression test.
- `DeepReadonly` is intentionally data-only because its sole input is the
  JSON-shaped Zod manifest type. The unused function branch was removed.
- Static manifest discovery opens with `O_NOFOLLOW`, validates an open file
  descriptor, limits allocation to 256 KiB, and checks the post-read size.

## Refuted with source evidence

- **Parity test typo:** the test already calls `expected.get(...)` and passes
  against all 441 frozen occurrences.
- **TUI parse failure would pass:** `Infinity <= 12` was already false; the new
  explicit throw improves diagnostics but does not repair a false-green gate.
- **Missing TUI probe:** `scripts/perf/repl-typing-probe.mjs` exists and ran
  successfully in every recorded performance measurement.
- **Diamond dependencies duplicate queue entries:** a node reaches indegree zero
  exactly once because required dependency IDs are unique. The added guards and
  witness test make that invariant defensive and explicit.
- **`DeepReadonly` lacked rest arguments:** the reviewed code used
  `(...args: never[])`; the review text omitted the ellipsis. The branch is now
  unnecessary and removed.
- **Mutable `ImmutableMap`:** the private backing `Map` never escapes. Consumers
  receive only the `ReadonlyMap` interface and iterators, none of which exposes
  `set`, `delete`, or `clear`.

## Boundary findings

The hardlink/TOCTOU observation is not a path-containment escape: a hardlink
inside the canonical package root is itself an in-root file, and Slice 1A only
parses metadata—it never imports or executes a referenced artifact. Concurrent
mutation of an unsealed source directory remains outside this slice by design.
Before executable activation, Slice 1B must copy into content-addressed staging,
verify every digest there, and activate only the sealed generation. No claim of
durable trust or safe execution is made here.

## Final disposition

No blocking or important finding remains locally fixable in Slice 1A. Remaining
review comments are future-slice trust/staging requirements or optional
maintainability notes, not unresolved defects in this non-shipping foundation.
