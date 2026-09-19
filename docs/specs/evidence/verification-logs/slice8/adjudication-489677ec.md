# Slice 8 exact-subject final-delta adjudication

Subject: sha256:489677eccc40ee44ce45e64ceb4cbe97cbb00849e9aed871bd7f0dbe4273f92f

The clean-checkout drift oracle exposed two coupled generator defects after adding the kernel-owned `agon mod` lifecycle surface: missing ownership classification, followed by stale numeric registry IDs in physically extracted first-party packages.

Verified resolution:

- all `mod <subcommand>` identifiers normalize to the narrowly added `mod` kernel surface;
- kernel ownership keeps inspection, recovery, trust, and activation controls available in safe mode;
- inventory, ownership, compatibility projections, and surface catalogs are at a deterministic fixed point;
- all 36 physical first-party packages and their migration ledger were regenerated from that catalog;
- surface owner hashes were regenerated after physical manifests stabilized;
- both generated-artifact and first-party-package drift checks pass together;
- the complete modular workspace builds;
- all 76 S8 trust/bootstrap/runtime tests pass, including duplicate-contribution rejection;
- the dependency graph remains 49 packages and 144 unique edges.

No runtime authority or security boundary was weakened. Disposition: no blocker.

Three focused external/local model attempts produced no review answer and are excluded: GLM network/rate-limit failure, Qwopus Metal allocation failure, and OpenCode telemetry checkpoint failure.
