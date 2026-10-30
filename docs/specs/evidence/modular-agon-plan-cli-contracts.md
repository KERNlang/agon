# Plan CLI public contracts

Date: 2026-10-30. Runtime subject:
`ebf71f4095c4be06d2613b7390950ffc4dc7ba20`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
This index is added after qualification; it changes no executable code.

## Scope

Twelve CLI consumers now import Plan persistence, formatter and public types
from the existing `@kernlang/agon-mod-plan` exports rather than Core's facade.
CLI already declares that dependency. TypeScript AST comparison confirmed all
non-import production statements unchanged. Core compatibility exports and
runtime estimator/executor bindings remain. This does not finish A20 retirement.

Twelve import-boundary cases failed before migration and pass afterward. Six
existing test mocks now intercept storage at its real owner. Behavioral
assertions remain unchanged. The frozen callback fixture remains unchanged;
its parity harness intercepts both legacy and current storage boundaries.

## Qualification

Two successful full-suite runs: development checkout and clean committed
checkout, each 12,124 passed / 7 skipped. Each also passed 129 installed checks,
including cache-deletion survival, idempotent setup and fixture-provider flows.
Clean checkout additionally passed all 31 diagnostic-runner tests with
`AGON_IT=1`, including the real TypeScript compiler negative case.

Build, typecheck, lint, re-export guard, migration-ledger drift, release and
supply-chain self-tests passed. Clean checkout used offline `npm ci` with
scripts and audit disabled, and regenerated no acceptance artifacts.
Tracked status stayed clean. Source-contamination checks before and after
qualification found no ignored, untracked or unstaged source paths, using the
existing validator without additional exclusions. Provider launches: zero.

The development checkout contains 314 pre-existing ignored `.kern-gaps` JSON
diagnostics. They were preserved, not excluded or deleted. The clean checkout
proved the build and tests do not need them.

## Durable receipts

Raw logs and receipts are preserved in the operator's durable archive outside
Git worktrees, identified here as `$MODULAR_AGON_EVIDENCE_ARCHIVE`. A run ID
resolves to `<run ID>.receipt.json` and `<run ID>.log`. Receipts contain exact
commands, exit codes, duration and log hashes. Never delete the archive without
Raphael's approval. Runtime receipt hashes were checked against the raw logs.

| Run ID | Result | Log SHA-256 |
| --- | --- | --- |
| `plan-cli-contracts-red-20261030` | Expected 12 failures / 2 passes | `7bcf2df824b4cf2bc7f9e64451578bda19049423061e9594ec2a6653a547f455` |
| `plan-cli-contracts-build-20261030` | Build, hygiene and 113 focused tests pass | `07a402044b6603fe1e60fce2afb73b566c8061f5044182563d3e8ea81a72b043` |
| `plan-cli-contracts-full-20261030` | Failed: 36 failures / 12088 passes / 7 skipped | `5f7de1c0d6cb2dab841e47db51740888f89ed9aa385d47a757875b20577cfb26` |
| `plan-cli-contracts-mock-boundary-20261030` | Corrected mock boundaries: 125 tests, types and lint pass | `377a0d8ff6f60f89fb3de08704b5f41944e931d950d1de4226e0b7ec165397ff` |
| `plan-cli-contracts-full-corrected-20261030` | Full tests and installed checks pass | `6920f65d5511d3e18162405775fe5041944b2cb1f14e3fc9508b34fd5e6e7836` |
| `plan-cli-contracts-clean-build-20261030` | Exact committed checkout builds cleanly | `a213e4b118333fe7b4848b17ad5d8f2310a9662dd44e41a77c66960aba2b0ebb` |
| `plan-cli-contracts-clean-runtime-20261030` | Full tests, installed checks and real compiler check pass | `31b58424de7396288811e6983c24d2d199ea75fa4dd7da4f7066cddb2fa1061e` |

The failed full run exposed stale Core storage mocks and one exact import-string
assertion. It is diagnostic, not qualification: mock corrections were made after
the affected suites finished while unrelated tests were still running. The
later successful runs cover the corrected tests. No assertion was removed to
make the behavior pass.

## Independent review and limits

Isolated Agon Codex review found no findings in the production import changes
and new boundary test. Input SHA-256:
`a0d1eb26e269012666f2f8da15b7f6a300e8d42d5e4066463cd9bfdc5bec2a9c`.
Review log SHA-256:
`363697bcd03a19301e2b4acc16e2c17eb91ae08b8c5e476edfc2152b28005110`.
The reviewer ran no tests. Later mock corrections were verified locally and
are not claimed as part of that earlier review packet.

Evidence is native macOS arm64, Node 26.12.1. Default-suite skips comprise four
live-provider probes, one unavailable Go-toolchain case, one opt-in TUI case
requiring unavailable `pyte`, and the compiler case covered separately above.
No dependencies, global installation or personal state changed. No live model
dispatch. Other platforms and remaining modular acceptance stay open.
