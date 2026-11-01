# Stable installed recovery launcher

Date: 2026-10-30. Runtime subject:
`832484dcaaa23c57038befbc167402b76cfba983`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
Status: clean committed runtime qualification passed; ready for review.
This evidence index is separate from the executable subject.

## Scope

The installed launcher parsed the selected pointer before entering safe mode.
A corrupt pointer therefore prevented the supported recovery command from
running, although the retained CLI could perform the same approved recovery.

Setup now publishes a standalone recovery bootstrap with a qualified prefix
identity. An artifact lease retains that prefix between invocations. A process
lease protects an admitted recovery reader until its child exits. Publication
uses the existing lifecycle fence and durable file/directory synchronization;
old artifact references are released only after publication is durable.

Safe mode verifies retained executable and dependency bytes before importing
them. The exact explicit transaction-recovery command uses the existing bundled
kernel recovery owner before reader admission, so a dead writer cannot block
its own repair. Live and malformed writers remain refused. Normal invocations
continue to follow the selected pointer. No automatic generation selection.

No dependency, lockfile or kernel public API change. All 49 modular package
payload hashes equal the base. The launcher adds one standalone file; packed
size changes from 1,439,448 to 1,500,674 bytes. Generated release metadata follows
these build artifacts. No raw logs ship.

## Verification

Development build, types, lint and re-export guard passed. Full suite:
12,129 tests passed, seven skipped. Installed verification passed 134 checks,
including corrupt-pointer recovery, exact approved generation, fresh launch,
dead-writer recovery and subsequent normal operation. Supplemental diagnostic
tests passed 31 checks, including a real compiler invocation.

Seventeen focused launcher cases cover retention, tampering, dependency changes,
missing/extra/symlinked files, live/malformed/dead writers, publication durability,
reader replacement/collection and bounded directory traversal.
Negative controls reproduced the installed failure, two review findings and
the dead-writer self-block before their corrections. Failed attempts are retained.

All eight existing performance gates passed. Direct CLI startup p95 was
122.260 ms for version and 119.098 ms for help. Those measurements bypass the
installed wrapper and do not establish its startup or safe-mode hashing cost.
Two 120-second daemon load phases passed: 30,496 transport jobs and 696 fixture
workflow jobs. Request p95 was 1.403 ms and 6.845 ms respectively. Failure,
cancellation, recovery, child cleanup and shutdown controls passed.

Exact committed clean checkout: frozen offline install, build, types, lint and
re-export guard passed. Clean runtime passed 12,129 tests, seven skipped,
134 installed checks and 31 supplemental compiler checks. Its source-bearing
ignored/untracked/unstaged lists were empty before and after runtime, with no new exclusions.
The long-lived development checkout has old ignored `.kern-gaps` files and is
not claimed as a clean release checkout. They were not removed or excluded.

## Durable evidence

Raw artifacts remain in `$MODULAR_AGON_EVIDENCE_ARCHIVE`; run IDs identify
adjacent `.receipt.json` and `.log` files. Receipts include exact commands,
exit status, duration and log hashes. Preserve the archive and failed runs.

| Run ID | Result | Log SHA-256 |
| --- | --- | --- |
| `stable-bootstrap-installed-red-repacked-20261030` | Intended installed failure | `e48e4c082dd6f7352db9993c6fb5486cbbead56286f7d2cff5815beb91a5a01c` |
| `stable-bootstrap-review-red-20261030` | Two review defects reproduced | `d60de692bf0c4ae14266e37b6cb8846be66a36aa9fc102c83bd4d4d1b218092b` |
| `stable-bootstrap-writer-red-20261030` | Dead-writer self-block reproduced | `3b2425ec9cfe9e93e87cc82c781527e1ff2738adbc2f76f03177409c8aa1d2e9` |
| `stable-bootstrap-final-build-20261030` | Final build and hygiene passed | `bd2117713bb43d00a36f88b8470c756ab78d92a3842ba2ec05d6107a2967cc29` |
| `stable-bootstrap-full-20261030` | Full suite, installed and compiler checks passed | `a925b6ea3192a61d08be8cce45f89b34a9c9c2af3cd893f811f764c45d6962a2` |
| `stable-bootstrap-performance-20261030` | Eight performance gates and load passed | `daa98e1a84bccd888114c21d039327fc7405d7ef862e56cc9bb2ed67ad8a7c08` |
| `stable-bootstrap-clean-build-20261030` | Exact commit builds cleanly | `d22d44fa26de7ccdea52a5ae761de371ed7b1590d8ccd74477a0b8509e4bef2d` |
| `stable-bootstrap-clean-runtime-20261030` | Exact commit passes full runtime qualification | `61652bab1b47381f891b43afc76fda7cfafb39ba035a837c7856ec9734db4223` |

All 20 completed build/runtime log hashes were recomputed successfully.
All recorded zero provider launches.

## Independent review and limits

One isolated Agon Codex review found four confirmed issues: unpinned readers,
missing parent-directory sync, unbounded directory enumeration and stale dist
test input. All were corrected with local regression evidence. A subsequent
local check found and fixed dead-writer self-block. No second panel was run.
Input SHA-256: `c1cbf5673d7053a3818d9e4cd825da27ef47ef8c102b51066d29b41b46df6fce`.
Review log SHA-256: `e6785ba027acc3d1586a8c05867736f5c3c5bfcb45dac9406307a167b08ea832`.
Detailed adjudication: `stable-recovery-bootstrap-review-adjudication.md` in
the archive. The reviewer did not certify test execution.

Native evidence is macOS arm64, Node 26.12.1. Other platforms/Node versions,
live providers and publishing remain outside this slice's evidence. The kernel
bundled in the bootstrap runs in a separate process from the retained CLI;
no kernel object crosses that process boundary. Full modular acceptance remains
open, including canonical current-subject slice receipts and review evidence.
Active/global Agon and personal state were not qualification targets.
