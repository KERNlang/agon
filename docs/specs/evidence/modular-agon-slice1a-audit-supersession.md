# Slice 1A acceptance supersession

**Status:** RED — the prior green receipt is superseded
**Audit date:** 2026-08-23
**Subject:** staged Slice 1A candidate on `feat/modular-agon-slice-1a`

This document supersedes the acceptance conclusion in
`modular-agon-slice1a-verification-receipt.json` and the “acceptance gates
green” heading in `modular-agon-slice1a-implementation.md`. Those files remain
unchanged as historical evidence; they must not be used as release evidence.

## Verified failures

1. The exact staged index was materialized into an isolated directory and
   installed with `npm ci --ignore-scripts`. The install passed, but
   `npm run build` failed with TS7016 for `semver` in `mod-api/src/manifest.ts`,
   `mod-kernel/src/lock.ts`, and `mod-kernel/src/resolver.ts`.
2. The dirty worktree passed because two hand-written declarations,
   `packages/mod-api/src/semver.d.ts` and
   `packages/mod-kernel/src/semver.d.ts`, were ignored by
   `packages/*/src/**/*.d.ts`. They were read by the compiler and by the old
   working-tree hash but were absent from the staged subject.
3. The old untracked-file check used `git ls-files --others
   --exclude-standard`; by definition it could not report ignored files.
4. The prior review evidence used a working-tree subject hash. The staged
   subject and the materialized clean subject have a different hash, so the
   review is not reproducibly bound to the candidate that a clean checkout
   receives.
5. The package graph declared 148 dependency entries but only 144 unique
   directed edges. `think`, `research`, `naturalize`, and `sanitize` each list
   `@kernlang/agon-support-engine-runtime` twice. The old invariant checked
   acyclicity and dangling IDs, not uniqueness.
6. The current worktree is not a clean qualification subject: Slice 1A is
   staged and unrelated operator changes also exist. Passing commands in that
   worktree are diagnostic evidence only.

## Correct acceptance model

A Slice 1A acceptance receipt is valid only when all of these are true:

- the subject is a committed tree, or an explicitly named staged index whose
  hash is recorded separately from `HEAD`;
- the receipt hashes Git object content, never ambient working-tree bytes;
- ignored and untracked source-bearing files inside the subject paths are
  empty;
- the committed tree has a clean worktree before qualification;
- an independently materialized checkout performs `npm ci --ignore-scripts`,
  compiles both physical packages, runs qualification negative controls, pack
  checks, contract/property tests, and the repository gates;
- every declared dependency array and every global directed edge is unique;
- independent review artifacts are repository-relative, non-empty,
  content-hashed, engine-distinct, and bound to the same committed subject;
- a second clean checkout can re-run the commands without access to the
  original run directory or ignored files.

The executable detector is
`scripts/spec/qualify-modular-agon-clean-checkout.mjs`. Its current expected
result is red. S1B may turn it green; this planning goal does not authorize the
production fix.

## Classification

- **Verified:** all six failures above and the present red disposition.
- **Inferred:** adding a tracked declaration or the correct type dependency is
  likely sufficient for the TS7016 symptom; implementation must prove which
  solution has the correct package boundary.
- **External blocker:** none for repairing Slice 1A locally.
- **Product decision:** none; acceptance truth is not optional.
