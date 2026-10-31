# SessionHost ownership qualification

Status: qualified for review as one bounded ownership/consumer slice.
Clean-checkout, installed, performance/load and contamination gates passed.

Runtime subject: `0cb6c5abc7465d8f1369929e0cafef4baf6445c5`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.

## Scope

Persistence owns the existing SessionHost implementation next to EventLog.
Core's public values and types still delegate to that same owner. Attach and
Browser HTTP/SSE import the public Persistence package. The implementation move
is byte-identical: SHA-256
`779ea387de49ef757cd880a5826c3296703d0d4c1c842b0e4b7bb44c3ed70bca`.

The live consumer check also reproduced an inherited detach hang on clean
pre-migration commit `03f3226a4b806c02727a683c7657bff950116487`.
Attach now releases its stdin hold on SIGINT. Readiness is printed after its
signal handler is installed. No transport, daemon or provider behavior changed.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Clean base full gate | 12,112 tests passed, 7 skipped | `session-host-owner-baseline-20261031` |
| Owner negative control | Five tests failed before migration | `session-host-owner-red-20261031` |
| Detach baseline | Replay and detached output, but deadline kill | `session-host-owner-detach-baseline-20261031` |
| Detach regression negative control | Real CLI test failed before cleanup fix | `session-host-owner-detach-red-20261031` |
| Final working gate | 12,118 tests passed, 7 skipped; types/lint/guard passed | `session-host-owner-final-inventory-gate-20261031` |
| Focused setup/detach | 81 passed without weakening assertions | Same final gate |
| Built runtime | Seven checks passed: identity, unflushed buffer, timer unref/disposal/idempotence, CLI listing/replay/detach | Same final gate |
| Exact clean build | Passed: offline locked install, build, typecheck, lint and re-export guard; clean before/after | `session-host-owner-clean-build-20261031` |
| Exact clean full suite | 12,118 passed, seven skipped; 714 files passed, one skipped | `session-host-owner-clean-runtime-localnet-20261031` |
| Exact clean runtime attempt | Failed: 51 tests, socket EPERM and file-watch failures; installed checks not reached | `session-host-owner-clean-runtime-20261031` |
| Exact clean runtime with local socket permission | Passed: 129 installed checks, 31 diagnostic tests including real tsc; clean after run; zero provider launches | `session-host-owner-clean-runtime-localnet-20261031` |
| Performance/load | Passed on darwin-arm64, Node v26.12.1; 712 completed jobs and verified outputs, zero pending fixtures | `session-host-owner-clean-perf-load-20261031` |
| Source contamination | Passed after all qualification: exact subject, clean Git status, empty ignored/untracked/unstaged source lists | `session-host-owner-clean-contamination-20261031` |

Working-gate log SHA-256:
`d1dac4480bcd9aa3881e0a7393183f5738f9abbffd6f7b2f897d3293323cac8e`.
Working-gate receipt SHA-256:
`75986be18fb1e05f27c1746f76d0a3ad13ef6a29ed23c487aa42298155705f3d`.
Runtime probe SHA-256:
`69877a651afa3704c60ddb74a194be06a674278808d0d1fbf698e9385307afdf`.
Clean-build log SHA-256:
`e890db8b9353c054886655f8e0d3c42dfc367f51b64cb14baa754f2b2ddf0a94`.
Clean-build receipt SHA-256:
`7e88aacf1447f1caa8b7dfdf953c10f83e9930807fa584bacf2c8ab9e98443ee`.
Clean-runtime log SHA-256:
`2348018aadd497ef3dfd96b0655289b134d1242d19c37f9efcc9c89525d1b92a`.
Clean-runtime receipt SHA-256:
`b0dc3fedae2e655b881c9d98563b5ed3bf239868a72eefbca5738794e4b65b33`.
Performance/load log SHA-256:
`6df6f128b3c531d7585868fc496969efe8943d40da5113628befb985b92ab6da`.
Final contamination log SHA-256:
`f9abcf199bf60243bcf0ac3ef7f2eb3f8aeeaf33efd1fb300ca6802659a020fe`.

The sustained load run recorded request p95 8.31 ms, 181,829,632-byte peak daemon
RSS, 573,440-byte settled RSS growth and 35.07 ms shutdown. Failure, cancellation,
recovery, engine cleanup and host-file cleanup controls passed. These are local
fixture-backed measurements, not live-provider or other-platform evidence.

## Reproduction

Check out the runtime subject above in an isolated workspace. Use an isolated
home/cache/prefix and provider blockers; allow local TCP/Unix sockets and file
watching. Install the lockfile with scripts and audit disabled. Run build,
typecheck, lint and guard:reexports, then the release-set and supply-chain
verifiers with `--check` (do not regenerate), the roadmap verifier,
test:modular-release, test:modular-supply-chain, the archived built-runtime probe,
the full test suite, `verify-modular-npx.mjs --no-write`, diagnostic-runner tests
with AGON_IT=1, perf:modular-release and test:modular-load. Finish with the
source-contamination gate and a clean Git status. Exact commands and exit codes
are retained in each named receipt. npm provenance remains externally blocked.

The first clean-runtime attempt failed under restricted sandbox permissions:
local TCP/Unix socket binds returned EPERM and file-watch tests missed events.
A minimal loopback bind failed inside the sandbox and passed with permission.
The unchanged candidate passed the full suite with local socket/file-watch
access. The failed run remains archived, not relabeled as passing:
log SHA-256 `6c9018811e5486aab6d22c72da7d97975dfbba02e91c8a5687ad6b465e49ee97`,
receipt SHA-256 `6e7f66aac391e04c4f9d76187c7e850e70110cb94948408864caa8c0fe978120`.

## Review

Isolated Agon Codex reviewed the ownership move and the subsequently discovered
consumer cleanup. Findings were checked against source. Added built-package
identity and timer-disposal proof; corrected readiness ordering and fixture
cleanup. Reviews are source assessments, not whole-release approval.

| Artifact | SHA-256 |
| --- | --- |
| `session-host-owner-review-input.txt` | `f98a97e0f5640e017aa4360b6f45469310fce882bc4055d4100ea755cc6012b7` |
| `session-host-owner-codex-review.log` | `978647902b72eecaab0002bd6be228278f102befcfc9bfb629c24c345b7580e7` |
| `session-host-detach-review-input.txt` | `0ee854a379fae61d6b8c504daf71711df549e0a08f8fb7181d46b8bf5b66af10` |
| `session-host-detach-codex-review.log` | `c5135e624c2b304fcc9ba63574dae1660a1a4cecfafa059c51d624097fc4548e` |

## Generated records and limits

The base S4 ledger was stale. Its own generator over base Git objects produces
261 occurrences, 104 adapters and 43 consumers rather than tracked 262/107/41.
Current output minus the added SessionHost destination matches that regeneration.
No invented frozen ownership assignment is counted as complete.

Only Persistence's payload hash changes among 49 target packages. Other tarball
hashes changed without payload changes. Launcher and Core compatibility artifacts
are accounted separately. Generated evidence is not additional runtime machinery.

Two full attempts failed because launcher inventories named chunks from an earlier
build. All failed logs remain archived. Correct order is source/build/docs first,
then release/SBOM generation, then tests. The final preflight found no missing path.

Raw logs, receipts, review packets and adjudication stay in the durable archive
`${LOCAL_EVIDENCE_ROOT}`, outside Git worktrees. The operator handoff resolves that
root. Do not delete this archive without Raphael's approval.

This qualifies a bounded session-reader slice only. No global installation,
personal-state mutation, live provider test, cross-platform release approval or
full Modular Agon completion is claimed.
