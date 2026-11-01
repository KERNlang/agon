# Companion startup cancellation

Source commit: `e322a74d06a3383835811c52bf86fee312128d00`.
Base: `e630e175f73ea99eee628d5aa97f8856d427fa96`.
Branch: `fix/modular-companion-cancel-current`.

## Behavior

An abort during the ACP startup wait could proceed to a new RPC after the
abort handler had already run. The closed-stdin error then reported exit2
instead of cancellation exit130. One admission check in the shared `send`
function rejects an already-aborted signal before request IDs, timers,
registrations or writes. Existing pending-request cancellation stays intact.

Real Node fixture processes cover cancellation during initialize and prompt,
including a child that resists SIGTERM. An ordered permission-response barrier
proves partial output reached the parent before abort. Tests assert bounded
completion, preserved partial output and child death. The startup regression
proves exit classification; absence of a subsequent RPC write is source-traced,
not asserted by that test. Core compatibility exports remain identical to the
public Engine Runtime owner.

## Durable evidence

Archive: `/Users/ra/dev/modular-agon-remediation`. Each run ID has a `.log` and
`.receipt.json`. Hashes below identify exact log bytes. No archive was deleted.

| Run | Result | Log SHA-256 |
| --- | --- | --- |
| `companion-cancel-current-built-red-20261101` | Startup cancellation fails with exit2 instead of130;24other tests pass | `24f7e6ddd1c7b66e7ba0e10fbecb2b1418130bb8b0ab2456d6740d7b522b8674` |
| `companion-cancel-current-green-20261101` | 28focused tests,types,lint,guard,diff pass | `f4c5ae32a960dbf80aea834cb67e6149b4936998332f8435c54c9aa648df5db0` |
| `companion-cancel-current-full-20261101` | Full repository gates pass;12454tests,7skipped | `8d5eefcdfa2a97f7bf22e450c44a243ec60929469b7b49c4114f6576b4344096` |
| `companion-cancel-current-clean-build-20261101` | Exact source commit builds from a clean checkout | `c7bb508be0279a7f8f5d502f8cd8a4be35c1a2260a97ce4110b6bfc567edfa4e` |
| `companion-cancel-current-clean-runtime-20261101` | 12454tests pass,7skipped; overall red at installed Research15-versus5 verifier assertion | `14c98b0464d8ca34de8d6bc6baa0b401efdc88deb8a209898312fc005843bd24` |
| `companion-cancel-installed-diagnostic-20261101` | 28focused tests,types,release/SBOM and all169installed checks pass;210.553s,zero providers | `6195969818b5ebba3f07d3c850e49fad50262196580a243c012e57ddd3a4bf5b` |

Initial `companion-cancel-current-red-20261101` failed on unbuilt workspace
exports, not the behavioral defect. It remains in the archive and is not used
as fail-first proof. All qualification receipts record zero provider launches.

## Review and limits

Isolated Agon Codex found no introduced blocking regression. PacketSHA256:
`3c267476fc2300d3f31104aa9af0c09398f1235275f010e0bd2feef287a6a771`.
Review outputSHA256:
`f85eade6a148c84d1319e676f6428343a24902b8ed7f7986d8de50f211ee40d7`.
Source adjudication: `companion-cancel-current-review-adjudication.md` in archive.

Combined installed diagnostic passed all169checks, including rollback,
safe-mode recovery, cache deletion and idempotence. It includes
PR393's verifier correction and PR394's recovery fix without assuming their
merge. This source branch remains independent of both PRs. Such a diagnostic
does not replace final integrated clean-subject release acceptance.

Pre-aborted process admission, JSON-RPC availability-probe cancellation,
stream-json writes and notification/approval responses are outside this fix.
No live providers, global installation, personal-state changes or release
promotion were performed. Platform/provenance and full modular acceptance
remain separate requirements.
