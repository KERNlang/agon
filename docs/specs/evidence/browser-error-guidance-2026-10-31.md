# Browser recovery-guidance evidence

Runtime subject: `03f3226a4b806c02727a683c7657bff950116487`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
Scope: shared Browser Bridge error decoder and three send callers.

## Behavior

CLI drive, Chrome handler and Browser mod preserve the server's string error on
failed sends. Reads are bounded to16KiB and one second; displayed text is sanitized
and capped at2048characters. Unsupported bodies retain status-only failure.
No retry or new dependency was added. Success behavior is unchanged.

Tests exercise actual caller entrypoints and real loopback HTTP with a fixture
BrainClient. Each fixture records one completed effect before throwing the warning;
each caller invokes it once. The Browser mod records no success receipt. These
are not live-provider or real-extension tests.

## Verification receipts

Raw logs and JSON receipts remain in the durable operator archive, outside Git.
Resolve `${LOCAL_EVIDENCE_ROOT}` from the operator handoff. Filenames below are
relative to that archive; each receipt contains its exact command and log hash.
Do not delete the archive without Raphael's approval.

| Run ID | Result | Log SHA-256 |
| --- | --- | --- |
| browser-error-guidance-red-20261031 | Three callers failed before fix | be2391bfaca6428f5bceedcdb93c530f1c3a86d2fdd56c767fca1e73359d7d46 |
| browser-error-boundary-red-20261031 | Locked-body negative caught intermediate defect | 0f160623d48baad45196f0c17ecd305a70ad02cdb1b262b689427d18ce2f17ef |
| browser-error-guidance-full-build-20261031 | Build/types/lint/export guard passed | 421907dad39b95973b1d6339ffa59c2ca7970c36c5cc7e9cba8ab7efd399370e |
| browser-error-review-regressions-20261031 |25tests/types/lint passed | de12dd0165751bf0281043467c21278bc7a8de93cdb54799c33aa229e323e6d1 |
| browser-error-guidance-full-runtime-20261031 |12137tests/7skip,129installed,31diagnostics passed before test relocation | 1279e8a98221ba30f55cfbe788adb1d4e2b0ac0516baa269c354b9c9ef736e75 |
| browser-error-pack-cleanup-20261031 | Tests/quality passed; metadata stage failed from omitted offline-cache setting | 81dea8850f88c37929f2e793bce24faf293a5ee567d386e3b57b2178e6f4bb9d |
| browser-error-pack-evidence-20261031 | Corrected offline-cache command; release/SBOM generation and checks passed | 77f7928ea90706b0f7dad8840f0540bf4f752e28854a34146964b8bf5f31f3f8 |
| browser-error-guidance-clean-build-20261031 | Exact clean commit, offline install, build/types/lint/guard passed | 3bd1685f293d2ccee5964ac31043216a74e468b7d37a5a08aad6439e0633ca86 |
| browser-error-guidance-clean-runtime-20261031 | Exact clean commit;12137tests/7skip,129installed,31diagnostics passed | 225f5befde438df9debf82e9dc9d6b145352e03a2b5b0aaa5f68bbf8d55f2e7c |
| browser-error-guidance-clean-perf-load-20261031 | Eight performance gates and sustained/concurrent load passed | ce11148f03dafdb47bbe5681de69ceb2438bdd6e899efdb5176c5c09edc1bd1b |

Concurrent load completed712fixture jobs with712verified outputs, peak concurrency4
and zero pending fixtures. Failure, cancellation, recovery, shutdown and host-file
cleanup controls passed. Exact measured values and budgets remain in the log.

## Review and packaging

Isolated Agon Codex review packet hash:
`d96c802c6f1339aeebc3230fdfb48f07cf167bdf0e76fe11d5f606535855734b`.
Review log hash:
`1f2eff26f7d5e0014aa1620eb3d7c12cedd2ebc71c9f6fcda535d6a24916062c`.
Adjudication: `browser-error-guidance-review-adjudication-20261031.md` in the archive.
One confirmed test gap was fixed by recording completed effects in the fixture.
No introduced runtime defect was reported. Findings were checked against source.
The temporary review authentication copy was removed.

Package inspection caught an unwanted test declaration before commit. Moving the
test to `tests/unit/browser-response-error.test.ts` removed it from the package.
The corrected inventory adds only `dist/response-error.d.ts` to Browser Bridge.
Only Browser Bridge and Browser mod payloads change among the49modular packages;
the launcher also changes. Archive hashes may change with npm packaging even when
payload hashes do not. No source-bearing checkout contamination was found.

## Limits

Local evidence: macOS arm64, Node26.12.1/npm11.20.0. Test/qualification runs recorded
zero provider launches. No global installation, promotion or automatic merge.
Other native platform/Node combinations and live providers remain separate release
cells. This PR does not establish full Modular Agon acceptance, nor does it depend
on unmerged Browser admission/retention PRs375/376.
