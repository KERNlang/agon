# Installed generation rollback

Date: 2026-10-30. Runtime subject:
`fca78d1fee82fe9175dfd6c973e1c2de25ed6492`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.
This index is separate from the executable subject.

## Scope

The existing npx verifier now recovers from a minimal Think/Review installation
to a retained Provenance installation, then returns to the minimal installation.
Every command uses the installed stable launcher in a fresh process.

Assertions cover preview without selection, exact approval refusal, retained
generation/prefix/desired-state identity, historical Forge record bytes and
report fields, and independently calculated source hashes. Report generation
time must fall within the invocation interval. Forge stays absent while
Provenance reads its historical output. After re-entry, Think's actual handler
is reachable, Provenance is unavailable, and setup reuses the qualified prefix.

No production code or dependency changed. Release metadata was regenerated
because archive identities differed from the checked-in channel. All 50
non-launcher payload hashes, versions and dependencies remained identical.
Launcher identity changed with its embedded release-channel metadata.

## Qualification

Development checkout: build, typecheck, lint, re-export guard, release and
supply-chain self-tests passed. Full suite: 12,112 passed, seven skipped.
Two successful installed runs each passed 143 checks with zero provider launches.

Negative control: after successful recovery acknowledgement, the fixture's
production lifecycle selected the previous generation again. The verifier
failed at the exact retained-installation assertion. This was not a compile
error or unrelated earlier failure. The mutation was removed before full gates.

Exact clean checkout: offline locked install with scripts and audit disabled,
build, typecheck, lint and re-export guard passed. Git stayed clean. Existing
source-contamination checks found no ignored, untracked or unstaged source
before building, after building and after runtime qualification, without extra
exclusions. Clean runtime passed the same 12,112 tests and 143 installed checks,
plus all 31 diagnostic-runner tests with the real compiler case enabled.
All eight runtime receipt hashes were verified against their raw logs.

## Evidence

Raw logs and receipts remain outside Git in `$MODULAR_AGON_EVIDENCE_ARCHIVE`.
Each run ID resolves to `.receipt.json` and `.log`; receipts record commands,
exit codes, durations and log hashes. Preserve failed runs and the archive.

| Run ID | Result | Log SHA-256 |
| --- | --- | --- |
| `installed-generation-rollback-build-20261030` | Build and hygiene pass | `ef68067fca616f9ee11820e79312f2e0d128091c21033ae3dffde0bc2f540233` |
| `installed-generation-rollback-runtime-20261030` | Fails before rollback: archive identity mismatch | `6ede6cf9bcb29774b9687f78c30c151a8fb00c072d4167e23ce5cd5b2f125d12` |
| `installed-generation-rollback-metadata-20261030` | Metadata regenerated | `64b4c3049634194a8cf37edc111a5cbb42d3d8923329076db10c83f7d03d6f97` |
| `installed-generation-rollback-runtime-refreshed-20261030` | 143 installed checks pass | `22533107a98cd36d6ebc9d34dcdc729500606b8fcca6ff8470a794968eed3b12` |
| `installed-generation-rollback-wrong-selection-20261030` | Expected target-selection failure | `96767953ab85ecf124ebb289b76b0be74b6aa68024e9572adbe96c82acbbe8fa` |
| `installed-generation-rollback-full-20261030` | Full suite, release checks and installed replay pass | `6c57ec6d873b996521a8ea44743721797e165f124c9aa623779a989e479c8908` |
| `installed-generation-rollback-clean-build-20261030` | Exact committed checkout builds cleanly | `f1a7cf8f8d90aae9cce813bab390ec0630adfd53e8bcb4e1950789237125be8d` |
| `installed-generation-rollback-clean-runtime-20261030` | Clean full suite, installed replay and real compiler check pass | `e4bc56e22df069c99e372897a53c0c4a8149022edc1f3d66d99beecb79f9ccd1` |

## Independent review and limits

Isolated Agon Codex review identified two confirmed false-green risks: root help
could masquerade as Think availability, and two unavailable source hashes could
compare equal. Both were corrected and exercised in later installed runs.
Review input SHA-256:
`9af79d53fcd3af86d44d22750d6929f16efec51f449d9c60767ece8b99eb9a89`.
Review log SHA-256:
`e11662ff4f196beaf34721168ee2d84115750f51d40912d5f962316a1ac1d0ab`.
The reviewer did not run tests. Corrected assertions were verified locally.

Evidence covers same-release profile recovery and one historical Forge record.
It does not establish N-1/N-2 binary compatibility, all persisted formats,
corrupt-prefix recovery, or installed-launcher safe-mode recovery. Those remain
separate requirements. Native evidence is macOS arm64 with Node 26.12.1;
other platforms and publishing evidence remain external. Full modular acceptance
is not claimed. Global Agon and personal state were not modified.

Default-suite skips are four live-provider probes, the unavailable Go-toolchain
case, the opt-in TUI case requiring unavailable `pyte`, and the real compiler
case exercised separately above. No dependency was installed to remove a skip.
