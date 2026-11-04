# Provenance malformed-root guard

Base: `e630e175f73ea99eee628d5aa97f8856d427fa96`.
Branch: `fix/modular-provenance-invalid-root`.

The physical Provenance command now uses the legacy null-safe field check.
A saved JSON `null` returns the existing validation error before report creation,
permission checks or receipts. Valid historical manifests and report formats are
unchanged. No dependency, global-installation or personal-state changes.

## Evidence

Durable root: `/Users/ra/dev/modular-agon-remediation/`. Each run has a `.log`
and `.receipt.json`. Raw evidence is outside shipping packages.

| Run | Result | Log SHA-256 |
| --- | --- | --- |
| provenance-invalid-root-red-20261101 | Null regression fails; 15 tests pass | `665ac925a29981ef48d118627563e810703623f8b60e2b3600c109a53ffa7b9d` |
| provenance-invalid-root-green-20261101 | 53 focused tests, types and diff pass | `d2f4981416cd137fef4d7147dff65708811114fac0986a311587bef644cef3c9` |
| provenance-invalid-root-full-20261101 | Full gate passes in 883.787s | `9d67f3f7bf832348457e6e9ca6fb9030c2e4d1e5c286c82c320aa93f480f117e` |
| provenance-invalid-root-live-20261101 | Two built CLI invocations pass | `096d15e3eb27b605c692989596204c48f5b9bf512260ba100adc40125b70ee18` |

Full gate: build, docs generation, release-set/SBOM generation, typecheck,
12,457 passing tests (7 skipped), lint, re-export guard, release and supply-chain
self-tests, diff check. Zero provider launches.

Live checks use a disposable HOME/AGON_HOME. A null saved manifest returns exit1
without a TypeError, report file or source mutation. A valid manifest then writes
a JSON report with the expected winner. Only Provenance changed payload/file
inventory among the 49 modular packages; generated release identities refreshed.

Independent isolated Agon Codex review found no introduced defect. Its proposed
output-file absence assertion was added and included in the full passing gate.
Packet SHA-256: `5f14bb3ea9ec28b0bde4d6d5bb9b76684dc863e16730904e5dd36b0a03ba2c01`.
Review log SHA-256: `817715ea34f8fc5390dbbef5bfc172b1f06e3980021d4b099d9989e406ced092`.
Full packet and adjudication remain in the durable root.

Source SHA-256:
- `packages/mod-provenance/src/implementation.ts`: `02919defc57a2c921c18287439b5036562b537be4d0f88c3272556f3f52758c4`
- `packages/mod-provenance/src/implementation.test.ts`: `7d4da3da183eea26d3eef20b7e6eb4fc590cf987da33c24e6e4547e6e9319dab`

## Limits

This is checkout runtime verification, not full modular release acceptance or a
fresh installed clean-checkout qualification. npm provenance remains external.
Legacy command retirement and repeated-option parity remain separate concerns.
