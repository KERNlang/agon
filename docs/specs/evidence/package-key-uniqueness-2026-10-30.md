# Package metadata key uniqueness

Status: this bounded slice passed clean-checkout qualification.
Runtime subject: `a413f8490b89d3624c8ea704123663957d2d63fe`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.

## Change and limits

Core declared `@kernlang/agon-mod-research` twice with the same version.
Removing one declaration preserves the parsed metadata exactly. The lockfile
and effective dependency graph do not change. This fixes source ambiguity,
not a demonstrated runtime failure.

The existing package-graph test now checks raw JSON with the installed
TypeScript AST. It covers root and immediate package manifests, including all
56 current workspaces. Tests distinguish nested/escaped duplicates from the
same key in separate objects. No runtime parser, public API or dependency was
added. Future nested workspace layouts require extending the test inventory.

All 49 modular package payload and metadata hashes match the base. Generated
release-set changes are archive sizes/identities; the channel and SBOM retain
matching identities. The launcher payload changes because it packs the channel.

## Evidence

Durable archive: `/Users/ra/dev/modular-agon-remediation`, outside Git worktrees.
Each run has matching `.log` and `.receipt.json` files; receipts contain exact
commands and exit codes. Do not delete the archive without Raphael's approval.
Hashes below bind raw log bytes and were independently recomputed.

| Run ID | Result | SHA-256 |
| --- | --- | --- |
| package-keys-red-20261030 | Expected failure: exact Core duplicate; 34 passed | 5a2bea22f3595c1f57cf5f18cba6eaf55aac1f19b1647139a868ac19857ad52c |
| package-keys-focused-20261030 | 35 passed; parsed metadata equal; lockfile unchanged | 4f1de1b6fe9f5ea07f5c41bf00b71373cd558a958efc7aa1fdbad5f384857885 |
| package-keys-full-build-20261030 | Build, types, lint, reexports, release-set, SBOM and roadmap passed | 87568cfdb4db44b29ca5013ecfc0423414917ca04e5fd6941c5c124b2f9cece7 |
| package-keys-full-runtime-20261030 | 12,118 passed, 7 skipped; 129 installed checks | f39831a8e63fd7f1f99291346f66af4ebe5e525913d52f76f29d70af0350179d |
| package-keys-clean-build-20261030 | Offline locked install, build/types/lint/reexports, clean Git | 174db1dc8a9c0c32e6a3a91faa29a670422ca406f1999d1158affde26ecd9cf0 |
| package-keys-clean-runtime-20261030 | 12,118 passed, 7 skipped; 129 installed checks; 31 compiler checks; clean Git | 14e1778c5fd7abc79cdfb2f149ad246f8e943dcf474124c3557d70e3f5a0b3cc |
| package-keys-clean-perf-load-20261030 | Performance budgets and both sustained-load phases passed | 13df85e8f313f2750ac10a2803479847b2d851a77aa44806e5bc4c1b625b5ebe |

Workflow load verified 712 outputs over 121.3 seconds, four concurrent fixture
engines, zero pending fixtures and successful failure/cancellation/recovery/
shutdown controls. Request p95 was 8.33 ms. Final Git status was clean; the
source-contamination check found no ignored, untracked or unstaged source.

## Independent review

Isolated Agon Codex review completed with no blocking finding. It did not run
tests or certify a release. Input `package-key-uniqueness-review-input.txt`:
`4bdc75a3d749276bcc7e8d0a387c365ab52397cd73cd8c85dca20b2ca8a180aa`.
Output `package-key-uniqueness-codex-review.log`:
`310840d9ad75e511abfe5eec6cf6e671b6b095255da441c8f2a65201e8bce1e0`.
Both hashes verified. The observation about immediate-package scope was checked
against the root workspace list; all current workspaces are covered. Exact
object-path diagnostics were a nonblocking suggestion, not a correctness gap.

No production changes followed review. No live providers launched during the
qualification runs. Tests use disposable state and installation prefixes;
active/global Agon and personal state remain unchanged. Evidence is native
macOS arm64 only. Live-provider, other-platform and publishing evidence remain
separate. This slice does not establish full Modular Agon acceptance.
