# Modular Agon S6 review adjudication

Qualified product subject: `sha256:7581221503f5450dc5330b5e92b7f07a0eb49c7a8ca391207811e32d8b5cc9e1` (Git index).

The two local Ollama reviews were produced from a strict superset of this product subject. The only removed paths were the machine-local Python host runner and its wrapper. Those files were moved outside the repository because qualification machinery is not a shipping Agon Python/native component. No reviewed S6 product path changed during that narrowing. This adjudication rechecked every finding against the exact qualified index.

## Verified evidence

- The unsandboxed host corpus passed 7 files and 72 tests, including loopback server, daemon survival, room tail/work, capability authorization, and serve command behavior.
- The independent clean checkout passed offline install, build, S6 surface tests, support and first-party package checks, disable matrix, cutover contract, typecheck, lint, and the full repository suite.
- The qualifier found one real failure: the temporary Python host runner entered the generated Python/native inventory without an owner. Moving it outside the product repository restored the frozen 863-assignment inventory; `npm run spec:modular-generated:check` then passed.
- The generated catalog contains 440 entries, 36 physical first-party mod packages, 49 total packages, and 144 unique dependency edges.

## Qwen review

All seven blocking claims were refuted against the exact source:

1. Registration disposal is not leaked. `beginRegistration()` stores each committed disposer on its staged entry; the disposer returned to the mod invokes it after commit. Partial commit failure disposes already-registered entries in reverse order. Existing registry tests exercise commit, rollback, disposal, collision, and projection cleanup.
2. CLI availability is asserted before `resolve()` in the `run` handler. Argument/help metadata may resolve lazily by design; it cannot execute a disabled command.
3. JSON-RPC correctly returns a typed `-32602` response for an unknown or disabled tool. Closing the entire MCP connection would violate normal JSON-RPC request-error behavior and was never an S6 contract.
4. The Cesar catalog gate is the documented temporary first-party compatibility executor (`s6-cesar-tool-executor`). Third-party contributions are S8 scope; direct registry payload execution is its recorded removal condition.
5. CLI catalog IDs and command metadata use the same non-slash canonical names. Alias keys reuse the primary command object and disappear with it. The generated surface and disabled-reachability tests passed.
6. Documentation generation must fail closed when `docs/modes.md` is absent or disabled. Falling back and exiting zero would create the false green the S6 contract forbids.
7. TUI slash commands and hidden intent variants are intentionally distinct generated categories. Disabled reachability is tested through both help projection and parser dispatch.

## GPT-OSS review

The claimed duplicate export and duplicate/unused imports do not exist; clean TypeScript compilation and zero-warning lint passed. `lazySubCommands` has one export. `FIRST_PARTY_SURFACE_CATALOG` is used by both TUI projection functions. The Cesar catalog set and the selected-generation availability set enforce two different boundaries. Measured total surface readiness p95 is 23.97 ms, so the claimed help-latency regression is not evidenced. The explicit CLI dependency closure is deliberate physical-package evidence, not an accidental duplicate catalog.

## Brainstorm and tribunal

The registry-signature, `AGON_OWNER_KEY`, Discord UI, snapshot cache, Forge deployment, and cache-refresh claims cited nonexistent files or requirements. Searches found none of the alleged runtime signing architecture, registry reference files, deployment modules, Discord commands, or tests. They are not S6 findings.

## Disposition

No locally actionable product finding remains from the external reviews. The five compatibility executors remain explicitly temporary and owned; their S9 removal conditions are unchanged. Third-party folder mods remain S8 scope.
