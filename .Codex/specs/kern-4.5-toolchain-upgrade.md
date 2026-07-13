# KERN 4.5.0 Toolchain Upgrade

**Status:** Complete; local gate and final multi-engine review green  
**Date:** 2026-07-13  
**Confidence:** 0.98

## Claims

- **VERIFIED:** npm `latest` for `@kernlang/cli` is `4.5.0`.
- **VERIFIED:** `@kernlang/context`, `@kernlang/protocol`, and `@kernlang/terminal` publish matching `4.5.0` packages.
- **VERIFIED:** Agon currently pins the KERN toolchain and workspace runtime packages to the `~4.0.0` line.
- **VERIFIED:** `@kernlang/terminal@4.5.0` requires Ink 7+ and React 19.2+, which Agon already satisfies.
- **VERIFIED:** `@kernlang/core@4.5.0` peers on TypeScript 6, so Agon must align its project compiler to 6.0.3 to keep the installed dependency graph valid.
- **VERIFIED:** The upgrade should consume only the published 4.5.0 ABI. The unreleased `kern-lang` runtime work has no relevant host-validation or stdlib delta and cannot unblock Agon's compile.
- **VERIFIED:** KERN 4.5 intentionally rejects TypeScript host namespaces inside portable expression properties; Agon's remaining Date/process/console/Set/RegExp and non-portable regex/JSON uses require source migration.
- **VERIFIED:** KERN's default directory compile can report diagnostics, leave partial output, and still exit zero. Agon's wrapper must enforce `--strict-parse` unless `--tolerant` is explicitly requested.

## Change

1. Move every root optional `@kernlang/*` package from `~4.0.0` to `~4.5.0` so the compiler/runtime family stays coherent.
2. Move direct workspace runtime dependencies (`context`, `protocol`, `terminal`) to `~4.5.0` and align the root compiler to TypeScript 6.0.3.
3. Refresh the npm lockfile and install tree from the registry.
4. Enforce strict compiler exit semantics in Agon's wrapper so partial generation cannot masquerade as success.
5. Migrate portable KERN expressions to 4.5 stdlib forms and move genuinely Node/TypeScript-specific logic behind explicit foreign handler boundaries.
6. Preserve ECMAScript Unicode-regex behavior at explicit host boundaries and Set-backed diff membership where portable lowering would regress runtime behavior.
7. Compile all KERN sources using the resolved 4.5.0 CLI, then run typecheck, full tests, production build, and mandatory multi-engine Agon review.

## Non-goals

- Publishing KERN, weakening its portability validator, or consuming the dirty/unreleased local `kern-lang` tree.
- Adopting unrelated TypeScript 6 language or module-resolution changes beyond the required peer-alignment settings.
- Adopting unrequested new KERN APIs before the dependency-only compatibility gate is green.

## Verification

- KERN 4.5 strict compile: core 170/170, forge 38/38, adapter-cli 2/2, CLI 179/179, MCP 3/3, SaaS 1/1.
- KERN tests: 183 passed, 0 warnings, 0 failed.
- Full TypeScript suite: 4,020 passed, 1 skipped.
- TypeScript 6 dependency graph: valid (`npm ls typescript --all`).
- Typecheck with TypeScript 6.0.3: passed.
- Production build with TypeScript 6.0.3: passed.
- Final review: Claude, Codex, and Agy all completed; 0 verified findings (`review-1783973023328-vk219m-kern-4-5-agon-migration-final-v4`).

## Published 4.5 Follow-ups

1. Extend the existing `buildKernContextSpine` integration into Cesar session initialization so the agent receives cached navigational context instead of repeatedly rediscovering the same repository structure.
2. Establish native KERN coverage and `kern self-coverage --json` baselines, then fail only on regression so new foreign handlers cannot silently erode portability.
3. Wrap Agon's persistent RAG implementation with KERN 4.5's vector-store adapter contract and run its conformance suite before considering any retrieval-runtime replacement.
4. After parity benchmarks, evaluate KERN's local persistent RAG capability session and direct source-execution runtime for one contained policy workflow; do not move filesystem/network execution until those capabilities ship.
