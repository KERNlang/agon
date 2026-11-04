# Core PTY consumer ownership

Status: bounded PTY consumer change qualified. Not full release acceptance.
Runtime subject: `6b9cc3621fcddcff3abf5ea7eb3474775a85eb72`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.

## Scope and limits

Core's persistent-session factory now imports `createPtySession` from the
existing public Persistence package. Its routing and envelope decorator stay
unchanged. The historical compatibility wrapper remains; this is not retirement.
No dependency, session contract, provider policy or state-path change.

The PTY suite exercises the real Persistence implementation with a fixture
engine. Its throwing legacy-module mock proves the factory no longer loads
that wrapper. Added tests verify answer-channel priority, exact turn-envelope
identity, live lifecycle getters/close, and non-Claude stream-json routing.
Removing the envelope decorator fails the new metadata assertion.

All 49 modular payloads, package metadata and dependency lists match the base.
The launcher is rebuilt: 137 files before and after. Release-set, SBOM and
channel identities were regenerated with the existing commands.

## Durable evidence

Raw `.log` and `.receipt.json` files are in the operator's durable
`modular-agon-remediation` archive, outside Git and shipping packages.
Preserve that archive until Raphael explicitly approves deletion.

| Run ID | Result | Log SHA-256 |
| --- | --- | --- |
| `core-pty-baseline-20261030` | PASS: build/types/lint/guard; 12,112 tests, 7 skips; clean Git | `46e0154efb05b58439c9be7a7e93e0c84883b770b541fbed2918044adc633a3f` |
| `core-pty-red-20261030` | Expected FAIL: four factory cases reject old import; 37 pass | `f49228aaf9c56e60d60b6d5c232469a722dadec6b5a57a11b1ba414ae8365c75` |
| `core-pty-focused-20261030` | PASS: 41 tests, types/lint/guard | `73aeea10d621cfbbeb23a5efc14c3845f6c43587bf3fe208eea79fa901950c31` |
| `core-pty-envelope-negative-20261030` | Expected FAIL: missing turn metadata | `f718c2bc1109f0d9d4609f3ff2b39c8576dca185a2e692ae80a810a4dcc0dea7` |
| `core-pty-restored-20261030` | PASS: 42 tests, types | `4c32114484fb7521d69df3e83c39bfcb1d3e9661740d06f1be3bc2c5078af1c2` |
| `core-pty-full-build-20261030` | PASS: build, metadata, 42 tests, types/lint/guard/roadmap | `bd0668f69df75c2532a9a33d4b3b0f701950bf2970df5b594bbc32190d896844` |
| `core-pty-full-runtime-20261030` | PASS: 12,114 tests, 7 skips; 129 installed checks; 31 compiler checks | `9768579c67abbfadd1fa3dc43c4f14cc72e22084bfddb1337c3d41d183aa44f8` |
| `core-pty-clean-build-20261030` | PASS: exact subject; offline locked install, build/types/lint/guard, clean Git | `c4fbafe688cb634c54bbb0e8d084818fe3b9d195dfe7aa127df3785aa25767c4` |
| `core-pty-clean-runtime-20261030` | PASS: exact subject; 12,114 tests, 7 skips; 129 installed checks; 31 compiler checks; clean Git | `cf5f46b309bfc1ad275b6ff9c29584bd1c473272c85268849d9f786347214337` |
| `core-pty-clean-perf-load-20261030` | PASS: performance budgets; 28,824 transport and 712 workflow jobs; clean Git | `42f6b51b615902ba31e6af83a342410ec5f7f6aeb3735215bf581a1514a8b0c0` |

All completed runs above recorded zero real provider launches. Hashes were
independently recomputed. Expected failures are not passing acceptance gates.
Four fail-first cases share one import boundary, not four separate defects.

## Independent review

Isolated Agon Codex found no introduced regression. Input:
`core-pty-consumer-review-input.txt`, SHA-256
`dc6a2ba9d17e44af5850cfb7be2fd4cad543832a81a45d53ca61df7938035b4a`.
Output: `core-pty-consumer-codex-review.log`, SHA-256
`22da012d663d881cf98310de53e9fcab4284478a728b157f79ad61d2791a7aa2`.
Adjudication: `core-pty-review-adjudication-20261030.md` in the archive.
Reviewed source bytes match the committed production/test files.
Temporary authentication copy was removed.

Global test state is isolated by `tests/setup.ts` and the disposable harness.
Older PTY fixtures still use the checkout cwd; project-config dependence is
an inherited reproducibility caveat, not a verified production regression.

## Qualification and remaining limits

Clean committed qualification ran on macOS arm64, Node 26.12.1. Both load
phases ran for at least 120 seconds; all completed outputs were verified.
Workflow concurrency reached four. Failure, cancellation, recovery, child
shutdown and host-file cleanup controls passed. Final ignored, untracked and
unstaged source-contamination arrays were empty; Git remained clean.

The evidence-only follow-up commit does not change the tested runtime.
Historical wrapper retirement and combined-main slice receipts remain open.
No active/global Agon
installation was modified. Native platform, live-provider and publishing
evidence remain separate release requirements.
