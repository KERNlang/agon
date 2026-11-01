# Brainstorm bid ownership

Tested source commit: `21e017be87098071e0cc6d524aec10405206a5ea`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
This qualifies this change, not the full modular release.

## Change and compatibility

Core now reexports the existing BrainstormBid declaration from mod-brainstorm.
CLI imports its Brainstorm types from that same public owner. No dependency,
runtime behavior or type shape changed. Historical Core imports still compile
and resolve to the owner's declaration. The frozen workflow fixture is unchanged.
Both changed production files emit identical normalized JavaScript against base.

Production diff: two insertions, ten deletions in two files. The new three-test
regression covers exact frozen shape, source ownership, CLI imports, public
compiler compatibility, invalid inputs and declaration identity.

Generated release/SBOM/channel metadata was refreshed after build/docs. All 49
package payload hashes, file inventories, manifests and dependencies match base;
archive hashes/sizes differ. The launcher also embeds the refreshed channel.

## Verification

- Baseline full gate passed before edits.
- All three ownership tests failed before edits; 48 focused tests passed afterward.
- Removing the Core source reexport failed despite stale dist declarations.
- Changing the owner's optional score to string failed the frozen-shape test.
- Both deliberate mutations were restored before review and qualification.
- Isolated Agon Codex review found no concrete findings. All eight reviewed files
  were compared byte-for-byte with committed Git objects after the commit.
- Working-tree and exact clean-checkout suites: 12,115 passed, seven skipped each.
- Clean locked offline install, build, types, lint and reexport guard passed.
- Clean release-set, supply-chain self-tests and structural roadmap checks passed.
- Installed candidate: 129 checks across 15 packages, repeat setup and cache
  deletion survival. Diagnostics: 31 checks, including deliberate real-tsc error.
- Performance/load budgets passed on native macOS arm64, Node 26.12.1:
  712 jobs and outputs, zero pending fixtures, request p95 8.366 ms,
  peak daemon RSS 182,042,624 bytes, settled RSS growth 720,896 bytes.
  Failure, cancellation, recovery, shutdown and host-file cleanup controls passed.
- Clean-checkout source-bearing ignored/untracked contamination: none.
- Qualification receipts recorded zero provider launches. Review used only Codex.

One full-gate invocation failed after successful build/docs because its command
omitted the prepared offline-cache path. It could not obtain cached Zod. No source
repair was needed. The corrected postbuild gate and independent clean-checkout
qualification passed. The failed receipt remains archived, not relabeled green.

## Durable evidence

Archive: operator-maintained `modular-agon-remediation` directory outside Git
worktrees. Resolve that archive locally; it is not part of shipping packages.
Each run name below has `.receipt.json` with exact command, exit status, duration,
log path and SHA-256. Raw logs use `.log`. Do not delete without Raphael's approval.

| Run name | Result | Log SHA-256 |
| --- | --- | --- |
| brainstorm-bid-owner-baseline-20261031 | pass | `02a17389aa8b5d3a59875358d38ed043afa236449c26614c9ba5177dbbcd3c3d` |
| brainstorm-bid-owner-red-20261031 | expected fail | `3883c49e9febe5601d6c22872ce94a864fcdb6a3c2c25e1e647583fe2061623a` |
| brainstorm-bid-owner-green-20261031 | pass | `2bed2fd918c9cb08cb2ff37b478f83e7f8ac939d8e8b43723f22540382ee1c3b` |
| brainstorm-bid-owner-stale-dist-negative-20261031 | expected fail | `5c64d13f5b0d597507e14bda15734cd1ac00c7a6f485e2f0364fab8c1635c3db` |
| brainstorm-bid-owner-shape-negative-20261031 | expected fail | `912c822f1a91977225b8288d527e1f4a61fd9e24455dce894bb98f42e45bf352` |
| brainstorm-bid-owner-full-gate-20261031 | cache command failure | `71223cb588194358c70ead22aba7c7c6237bf242e97f7b9e4ce6369376b7a678` |
| brainstorm-bid-owner-postbuild-gate-20261031 | pass | `cc555fbdc9cc83236135b74ec241054a0c3d1fab3e40793b1cebbaba31899e42` |
| brainstorm-bid-owner-clean-build-20261031 | pass | `edeccb5f0fccc3252b04fd1aa11f3519efd5d35e40f818f95195b54b0cad401f` |
| brainstorm-bid-owner-clean-runtime-20261031 | pass | `38fc7c4a74787df31518e565315f683b1e941d383beaf9d6749f04923fe32586` |
| brainstorm-bid-owner-clean-perf-load-20261031 | pass | `fa47c8b0413d50f735a4974cf45c85a0437f7477983f645f2a2979df0e201416` |
| brainstorm-bid-owner-clean-contamination-20261031 | pass | `ed74f735d586506299dc73eb760a3a11bad09177b5f7d590f5f5b2ed869e1f7a` |

Review input: `brainstorm-bid-owner-review-input.txt`, SHA-256
`84797b1e263d521a6d455f3b61ec1b2473e765462536dd2bdf92ff6f75e4387a`.
Review output: `brainstorm-bid-owner-codex-review.log`, SHA-256
`c4d9b123e25a2a18188ca21bae3d35edf0c8d5ffdbb730012e68de8b17ac92fd`.
Adjudication: `brainstorm-bid-owner-review-adjudication-20261031.md`.

## Limits

Other ownership work, pending PR integration and nine current-subject slice
receipts remain separate. No claim of distinct-engine final review, native Linux
or macOS x64 evidence, live-provider qualification, provenance signing or npm
publication. Active/global Agon and personal state were not changed. Human merge
and promotion remain separate decisions.
