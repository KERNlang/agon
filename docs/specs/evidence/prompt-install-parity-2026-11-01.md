# Prompt installer parity

Base: `e630e175f73ea99eee628d5aa97f8856d427fa96`.
Branch: `fix/modular-prompt-install-parity`.

Routing Docs restores detected default targets, normalized/deduplicated explicit
targets, unknown-target warnings and Codex `agents/openai.yaml`. Permission checks,
JSON envelopes, receipts and overwrite protection remain. No dependencies added.

## Evidence

Durable evidence root: `/Users/ra/dev/modular-agon-remediation/`.
Each run below has matching `.log` and `.receipt.json` files.

| Run | Result | Log SHA-256 |
| --- | --- | --- |
| prompt-install-parity-red-20261101 | Four regressions fail before fix | `3403484b8660f13a64e07c04147c8de77fa2495b9f0cfdca6d6fb9b9bf783a4f` |
| prompt-install-review-red-20261101 | Warning-loss regression fails; six controls pass | `fd693b2b945e71debc13f0f0c0328a55906c138fa8b5c0dd8aab1dd92dbc6379` |
| prompt-install-parity-final-20261101 | Full gate passes in 1039.57s | `886dc03e14b5f383f7842fe50b8b61d758ba2949cfd916b43870f1f1ae95f077` |
| prompt-install-parity-live-20261101 | Seven built CLI invocations pass | `99680cafa9a94acde6ca850756ca86a1a21202dd48b5bd35adc88582c30460f7` |

Full gate: build, release-set/SBOM generation, docs generation, typecheck,
12,458 passing tests (7 skipped), lint, re-export guard, release and supply-chain
self-tests, and diff check. Zero provider launches in both final runs.

Live CLI checks: default preview of all detected CLIs; mixed-case/deduplicated
Codex selection; unknown-target warning; existing-file preservation; force
replacement; Claude-only detection; empty-home and unknown-only refusal.
All writes stayed in disposable homes. No global installation changed.

Independent isolated Agon Codex review packet SHA-256:
`5b465471d9818894f2daab538edacf2a4d00470a3efbdef58e7bc01279aedbf7`.
Review log SHA-256:
`8343fbaa6bcc7be65d20dde6f2b1bf53350bb6a61cc770afaab380124626791e`.
Its warning-loss finding was reproduced and fixed. Adjudication and complete
source packet remain in the durable evidence root. No second panel was run.

Verified source SHA-256:
- `packages/mod-routing-docs/src/implementation.ts`: `2c490afbe0dcd6d8d3eca85111f2c9afa3b5d1ea6a987bb75814cec99cb39fde`
- `packages/mod-routing-docs/src/install-parity.test.ts`: `fe873186d224622c236c693edd84a40d6d8da1dfd52e1fac0e609ac74c410924`

Only Routing Docs changed payload/file inventory among the 49 modular packages.
Generated tarball identities and CLI release metadata were refreshed.

## Limits

This is checkout runtime evidence, not a new clean-checkout installed release
qualification. npm provenance remains externally blocked. The legacy command
bodies remain for separate parity-aware retirement. Full modular acceptance is
not claimed. The deliberately interrupted pre-review gate and its failed
typecheck follow-up remain archived and are superseded by the full final gate.
