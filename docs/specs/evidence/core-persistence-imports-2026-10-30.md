# Core persistence consumer ownership

Status: slice qualified in a clean checkout. This is not full modular release acceptance.

Runtime subject: `2299dd13189f64ed0cbea69bd34f0ae71cc99d56`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.

## Change and limits

Core now routes 37 import/export edges in 14 files directly through
`@kernlang/agon-support-persistence`. The dependency already existed.
Public export names, aliases and type-only markers remain unchanged across
all 214 declarations. Core still owns its single `pasteStore` instance.

The twelve compatibility modules remain. This change removes their Core
consumers, not the historical source records or compatibility entrypoints.
The PTY and Plan binding wrappers remain unchanged. No workflow, dependency,
configuration or state-path change is intended.

All 49 modular payload hashes, package metadata hashes and dependency lists
match the base. Launcher output is rebuilt; archive identities, launcher chunk
names and corresponding release/SBOM/channel metadata are regenerated.

## Evidence index

Raw evidence lives in the operator's durable `modular-agon-remediation` archive,
outside Git worktrees and shipping packages. Each run ID has `.log` and
`.receipt.json` files. Preserve the archive until Raphael approves deletion.

| Run ID | Result | Raw log SHA-256 |
| --- | --- | --- |
| `core-persistence-baseline-20261030` | PASS: build, types, lint, guard, 12,112 tests; 7 skips; clean Git | `6c9f3a3eae53b7b710f71e9a5de3fa0e3105f6eec0f55bb6628c0b7dabac3520` |
| `core-persistence-red-20261030` | Expected FAIL: all 37 old edges detected; 15 other checks pass | `1d1b91251b1a4dc353f45926c5faf8803b5b880b9ed7f4087aca6b6fb0dc1c4c` |
| `core-persistence-focused-20261030` | PASS: 97 tests; 1 opt-in compiler skip; types/lint/guard | `3752482e4c6a5f06fb8dec1fe7f92b6955c7d7064045d3a6c49eade7f8206724` |
| `core-persistence-full-build-20261030` | FAIL: build passed; command omitted isolated offline cache | `c95ae3c0968692dda5e37d1164ff4e4f02e7e97cb1eb05435cd826ff0f5f41fb` |
| `core-persistence-full-build-cache-20261030` | PASS: build, metadata, 17 updated tests, types/lint/guard/roadmap | `5e0fbb1185f172fd0ccf0b80f1816e12ac7b7c7a6204c59e53382d42d7f057d9` |
| `core-persistence-full-runtime-20261030` | PASS: 12,129 tests, 7 skips; 129 installed checks; 31 compiler checks | `8c3e33711e1329ff72f7f96a1e7ae7f1fb798555a1efae720360f472fdc03258` |

All completed runs report zero provider launches. Failed cache invocation is
retained, not counted as a passing gate. Corrected runs use the same locked
dependencies from an isolated offline cache; no dependency upgrade occurred.

## Independent review

Isolated Agon/Codex found no production regression. Source-verified follow-ups
added function-existence assertions and a built public-entrypoint identity
test. Both are included in the passing 17-test and full-runtime results.
No production edits followed review. Temporary authentication copy was removed.

- Input: `core-persistence-imports-review-input.txt`, SHA-256
  `00dad2a372f5327f06703fae1d1da95331fde29eb5e672704ff414b0f7c17d06`.
- Output: `core-persistence-imports-codex-review.log`, SHA-256
  `c4dff38c8d4fe698d37bc9d73f5ab3907a1ae7d7bbb6c0c65d389c01abfde15d`.
- Adjudication: `core-persistence-review-adjudication-20261030.md` in the archive.

## Clean qualification

Clean build PASSED on the exact runtime subject: offline locked install,
build/types/lint/re-export guard and clean Git. Run ID
`core-persistence-clean-build-20261030`; log SHA-256
`35567ba150e85104cce960614312112bdf3b911b555987357c79e5ffb27c435f`.
Post-build source-contamination scan: ignored/untracked/unstaged arrays empty.

Clean runtime PASSED on the same committed subject: 12,129 tests/7 skips,
129 installed checks,31 real compiler checks,release/supply-chain negative
controls,roadmap and clean Git. Zero providers launched. Run ID
`core-persistence-clean-runtime-20261030`; log SHA-256
`a818f18d9029d819a57797f4f0ba655c97f467f2fed2ff048ca6df99d103c3bc`.

Clean performance/load PASSED on the same committed subject (macOS arm64,
Node 26.12.1). Run ID `core-persistence-clean-perf-load-20261030`; log SHA-256
`4b140d438ab15233f0ad81ca4735a63990ad8645990c2f44b2e9c5df120bb62a`.
Both sustained phases ran for at least 120 seconds: 30,056 and 680 jobs,
with every output verified. Concurrent fixture jobs reached concurrency four;
failure, cancellation, recovery and shutdown controls passed. All reported
performance budgets passed. Zero real providers launched.

Final source-contamination scan: ignored/untracked/unstaged arrays empty.
Git remained clean at the exact runtime subject after qualification. The
following evidence-only commit does not alter the qualified runtime tree.

Native platform, live-provider and publishing cells remain separate release
requirements. No active/global Agon installation was changed.
