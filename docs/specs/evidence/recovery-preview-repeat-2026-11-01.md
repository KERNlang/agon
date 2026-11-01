# Repeated recovery preview fix

Base: `e630e175f73ea99eee628d5aa97f8856d427fa96`.
Branch: `fix/modular-recovery-preview-repeat`.

## Defect and correction

Repeated recovery previews share the same plan hash. The previous exclusive
hash-only filename caused `EEXIST`, including during installed safe-mode
qualification after rollback and re-entry.

`packages/cli/src/commands/mod.ts` appends the existing `randomUUID()` to the
filename. Plan hashes, document bytes, `wx`/0600 creation, containment and exact
approval checks are unchanged. Existing plan paths remain readable.

Two regression cases cover sequential and concurrent previews. Each preserves
the original document and selected pointer, then proves every returned approval
can recover the same qualified installation from a corrupt pointer. Both fail
before the production change and pass afterward. The contract does not require
UUID-specific filenames; it requires safe successful repeated previews.

## Evidence index

Durable local archive: `/Users/ra/dev/modular-agon-remediation`.
Each run below has a `.log` and `.receipt.json` at that location. Hashes identify
the log bytes. Raw logs remain outside shipping packages.

| Run | Result | Log SHA-256 |
| --- | --- | --- |
| `recovery-preview-repeat-red-20261101` | Both new tests fail with EEXIST on unchanged production | `3eba3c4764001f0ea23ffac3acea9d7a3c529da1bbcb6d67fe856013299d7942` |
| `recovery-preview-repeat-green-20261101` | 166 focused tests, types and re-export guard pass | `bdb3fe1deac1522d95cc1ea239146d492ea26b807e322ab235df2b98035797ee` |
| `recovery-preview-repeat-full-20261101` | 38 setup failures from stale launcher inventory; preserved negative evidence | `7cb33b9a49abb9e028a45f55acde680e83d9b3c119dbe64c8591c0a61c441c77` |
| `recovery-preview-repeat-metadata-20261101` | Regenerated inventory; 118 setup/recovery tests, release/SBOM checks, lint and guard pass | `4f0902691ee1ab24830a0be32d5933b80d2ec8f8b7e4cc346d868fd58322e920` |
| `recovery-preview-repeat-full-qualified-20261101` | Build, types, exact release/SBOM checks, 12,453 tests, lint, guard and diff check pass; seven tests skipped | `550a45062237a860dad4ffe58052efea8381f2526e5e14e95ba799f68ede314e` |
| `recovery-preview-installed-diagnostic-20261101` | All 169 installed checks pass, including rollback, safe-mode recovery and cache deletion | `e2d42514a27e6e1f3cc41fbbe0fc74a86144d85eb1d92c28f10c0f629b06c6e7` |

All runs recorded zero provider launches. No global installation or personal
state was modified. The first full run's stale chunk filenames were corrected
by the existing metadata generators, not by weakening setup validation. All49
modular package payload hashes and file inventories remain unchanged from base;
the CLI payload and generated release identities changed.

## Independent review and limits

Isolated Agon Codex review found no introduced actionable finding. Packet
SHA-256: `cfcef1c4cfd1493bf4165d7e2cb32c20bd0ab43a748285bcad78848c1b5d94a2`.
Review log SHA-256: `2d5abff5e77eaed2039ed899fa6293fb883f9c149a7f0a66ff91260d14abb25c`.
Source adjudication: `recovery-preview-repeat-review-adjudication.md` in the
archive. Review was static; test evidence is separate.

Installed evidence is a diagnostic combination: PR393's verifier correction
at `9c5d1a6338a70237b90076fc1700c85f9238e7d6`, plus this exact production fix
and regenerated metadata. This independent branch does not include PR393 or
assume its merge. That run is not a clean committed release acceptance receipt.
Fresh integrated clean-checkout qualification remains required after merging.
Native platform coverage, npm provenance and full modular acceptance remain
separate requirements. Nothing was installed or promoted globally.
