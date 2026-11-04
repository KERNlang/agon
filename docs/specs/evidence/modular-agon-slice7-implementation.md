# Modular Agon S7 implementation evidence

Status: implemented locally; clean-checkout and independent-review qualification pending.

S7 adds the non-global managed lifecycle behind the public kernel boundary. It
does not install or replace the operator's active Agon.

## Implemented contracts

- `createManagedLifecyclePlan` resolves the exact dependency closure before
  mutation, binds every artifact to the canonical lock, rejects scripts and
  duplicate inputs, and reports the complete frozen-offline missing set.
- `ManagedLifecycleService` stages packages outside projects, requires a
  host-owned verification result, promotes an immutable qualified prefix, and
  selects it through the existing single generation pointer.
- `NpmCandidateInstaller` always uses `--ignore-scripts`, never invokes a shell,
  bounds time/output, supports frozen-offline operation, and refuses to target
  the active installation prefix.
- `SubprocessCandidateVerifier` runs candidate smoke checks in a bounded
  sacrificial process and makes exit, timeout, signal, and output bounds part of
  the verification oracle.
- `recoverManagedLifecycle` distinguishes unselected pre-commit bytes from an
  already-selected post-commit generation. It removes only the former and
  repairs the journal for the latter.
- Rollback validates the retained installation record before atomically
  selecting its generation. A missing or corrupt retained prefix fails closed.
- Purge is a separate exact-path preview whose content hash must be approved.
  It cannot target the managed root or selected installation.
- Native/Python/WASM/download setup work is an explicit, source-hashed,
  time/output/path-bounded action with a receipt and declared-output rollback.
- The root automatic postinstall and optional ambient Python installation were
  removed. Source-only dependency patches run explicitly at build time and fail
  closed.
- The pre-modular global updater remains one documented temporary compatibility
  adapter. It is unreachable when `AGON_MANAGED_INSTALLATION_ID` is present and
  is scheduled for removal after S9 packed setup/update qualification.

## Local evidence

- 44 focused lifecycle tests across installer, updater, fault injection,
  concurrency, recovery, subprocess bounds, setup actions, purge, and the
  legacy-update guard.
- Eight lifecycle fault boundaries plus host-generation fault coverage.
- ENOSPC, EACCES, EIO, stale preview, corrupt rollback, malformed journal,
  incomplete offline cache, script, lock-drift, and verifier negative controls.
- Performance evidence: `modular-agon-slice7-performance.json`.
- Compatibility ledger: `modular-agon-slice7-compatibility-adapters.json`.
- Contract verifier: `scripts/spec/verify-modular-slice7-lifecycle.mjs`.
- Clean-checkout qualifier: `scripts/spec/qualify-modular-agon-slice7.mjs`.

## Honest boundary

S7 supplies and validates the transactional lifecycle used by the release
candidate. Public npm/npx setup, cross-platform packed-tarball qualification,
provenance publication, and final removal of the pre-modular updater belong to
S9. Third-party executable activation stays fail-closed until S8.
