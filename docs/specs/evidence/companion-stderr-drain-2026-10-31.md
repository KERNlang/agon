# Companion stderr drain evidence

Runtime subject: `548b13237723f75a0245244990b344a385a24e0b`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
Scope: shared companion subprocess stderr drain and one real-process regression.

## Behavior

An unread stderr pipe could block a companion before it emitted its protocol
response. The shared transport now drains and discards that stream without
buffering diagnostics or changing successful stdout/stderr fields.

The Node fixture writes2MiB to stderr and emits its stream-json response only
after the write callback completes. Original code returns timeout124; the fix
returns exit0 with exact output. Removing only the drain restores timeout124.
Restoring it passes all55 focused transport/review tests.

## Receipts

Raw logs and JSON receipts remain in the durable operator archive, outside Git.
Resolve `${LOCAL_EVIDENCE_ROOT}` from the operator handoff. Filenames below are
relative to that archive. Each receipt contains the exact command and log hash.
Do not delete this archive without Raphael's approval.

| Run ID | Result | Log SHA-256 |
| --- | --- | --- |
| companion-stderr-drain-red-20261031 | Expected timeout failure,2.782s | a700ea907b15377a83f3f20dfacb7585935f2da377263552aa6c93875f49682c |
| companion-stderr-drain-green-20261031 |55tests/types/lint/export guard,66.846s | e0c341477e7718d2b702afb1b990fb1d0bdce9e66009ed23b7e054514175158e |
| companion-stderr-drain-negative-20261031 | Removed drain reproduces failure,2.693s | b4c38bc14cfe30c43d4dff64e4d7ddd2909263e541a7832b5e0ba675ad7a351d |
| companion-stderr-drain-restored-20261031 |55tests and diff check,2.872s | 016833c70c5dbf3ebf33f20df6d82764fff11e270e251860b78161c64a7262b5 |
| companion-stderr-drain-full-20261031 | Build/types/lint/guard,12113tests/7skip,release/supply-chain checks,869.262s | 6cada5af34aeb3c774ac3e6576fb765a98c5524de604034a136de13f1129ef9a |
| companion-stderr-drain-clean-build-20261031 | Exact clean commit,offline install,build/types/lint/guard,226.472s | 257aafef84f93bee68a24b9d0d8f89040fc7af5d2613f6c2ba77959ca68a120e |
| companion-stderr-drain-clean-runtime-20261031 | Exact clean commit,12113tests/7skip,129installed checks,31diagnostics,777.593s | 7595bade4e55d3ef55c96663f274ebe0599c294b417ad742b0ad741c3caa092e |
| companion-stderr-drain-clean-load-20261031 | Performance and sustained/concurrent load,278.76s | 825d94d6c34f73264199a0a966c9f86d7098cf6f27faf657549764ef87f2c4fa |
| companion-stderr-drain-contamination-20261031 | No source-bearing ignored/untracked contamination,0.272s | 0465f1b7d6c24d768003f26ea0542c098838948c96afaf811685e1d911f5fb7c |

Clean runtime also checks release-set/SBOM drift, the roadmap, release self-tests
and clean Git state. Nine runtime receipts record zero provider launches.

Load completed712fixture jobs with712verified outputs, peak concurrency4 and
zero pending fixtures. Request p95 was8.47ms; peak daemon RSS181698560bytes.
Failure, cancellation, recovery, shutdown and host-file cleanup controls passed.
The performance log retains all measurements and budgets; no live vendor behavior
is inferred from fixture load.

## Independent review

Isolated Agon Codex reported no introduced defect. Input SHA-256:
`860cff62f5883e4fc075d084f713caaf093de3aacbdb3bcf4cd4ab8d85da1f9d`.
Output SHA-256:
`ce7ee913d9a00a85ca81450f762e65387ed060b32f7fbc29ca1aeb05e944afcd`.
Source-verified adjudication: `companion-stderr-drain-review-adjudication.md`
in the archive. Temporary reviewer authentication copy was removed.

## Integration and limits

This starts from main, not unmerged ownership PR386. If386 lands first, carry the
same correction to the moved Engine Runtime owner and requalify the integration.
Do not retain two authoritative transport implementations.

Direct saturation coverage uses stream-json. ACP and JSONRPC share this spawn,
but protocol-specific saturation and live vendor qualification are not claimed.
Probe output draining, pre-aborted cleanup and RPC timeout classification are
separate inherited concerns, not fixed here. Installed checks establish their
listed package behaviors; they are not direct saturation tests of every binary.

Local platform: macOS arm64, Node26.12.1. Other native platforms/Node combinations,
live providers and complete modular release acceptance remain separate gates.
No global installation, promotion or automatic merge occurred.
