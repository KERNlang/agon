# Roadmap Tribunal adjudication

**Agon run:** `/tmp/modular-agon-spec.nLtfrv/runs/tribunal-1787503415053-leeqf2`
**Engines:** `zai-coding-plan-glm-5.2`, `minimax-api`
**Rounds:** 1

The Tribunal conditionally accepted the roadmap and proposed local conditions.
Every proposal below was checked against the repository specifications before it
was accepted, refined, or refuted.

## Accepted

- **Raw oracle boundary.** The frozen legacy corpus must capture raw persisted
  result/event envelopes. Normalization, redaction, formatting, and TUI chrome
  are separate transformations with separate tests; otherwise a cleaner bug can
  become golden truth. S1B now carries this exit criterion and command.
- **Foundation mutation gate.** Existing resolver/registry/manifest property
  tests are strong but do not prove their assertions kill plausible defects. S4
  now requires targeted mutation testing of those contracts and dependency-edge
  invariants before external seams become stable.
- **Rollback re-entry.** The roadmap's per-slice rollback evidence means: exit
  passes, rollback executes, the previous generation runs, re-entry executes,
  and exit passes again. A rollback command returning zero alone is not evidence.

## Already specified; no new architecture needed

- The transaction state machine, writer lock, immutable generation, pointer
  commit point, pre/post-commit recovery, stale-host draining, and safe mode are
  already normative in `modular-agon-runtime-contract.md` under “Activation
  transaction.” S7 adds ENOSPC/EACCES/torn-write/concurrent-rollback evidence,
  but does not reopen the state machine.
- Trust origin, exact content/source/provenance binding, permission intersection,
  full-code trust warning, capability limits, folder containment, conflicts, and
  fail-closed behavior are already normative in
  `modular-agon-security-and-distribution.md`. S8 implements and attacks those
  contracts; it does not invent them.
- Concurrent writers, stale locks, killed owners, slow readers, path/Unicode
  cases, corrupt rollback generations, and safe-mode recovery already appear in
  the frozen adversarial matrix. The roadmap makes them slice exit gates.

## Refuted or narrowed

- “The corrected defects still compromise the foundation” is false as an
  acceptance-model claim: they make the current Slice 1A candidate red and are
  S1B entry work. No later slice may begin until the clean committed receipt is
  green.
- Upstream engine drift is not the only external blocker. Native macOS/Linux
  runner evidence plus signing/publishing credentials and registry rehearsal are
  also genuinely external. Engine drift is controlled by pinning the oracle's
  engine/model/config identity and separating deterministic structural parity
  from stochastic text similarity.
- Node support is locally resolved by the current `engines.node: >=22` contract:
  Node 22, 24, and 26 are release gates while supported. It is not deferred as a
  product decision.
- V1 distributes npm/npx packages, not a separate notarized macOS application or
  a systemd service. Those integrations are out of scope. Any shipped native
  helper still requires platform/architecture/integrity evidence.

## Result

No locally actionable Tribunal finding remains unassigned. Accepted findings are
encoded in the machine roadmap; already-specified findings retain their
normative clauses and receive executable gates in S7/S8/S9.
