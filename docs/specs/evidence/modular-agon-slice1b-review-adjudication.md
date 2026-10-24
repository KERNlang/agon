# Modular Agon Slice 1B review adjudication

## Subject and method

Slice 1B was reviewed only after the exact staged checkout passed the clean
qualification gate. Agon Think and Brainstorm used isolated state. The final
adversarial pass used a chained, local-only Agon Tribunal so the two local
models did not contend for Metal memory. Two additional local model asks were
retained as independent review artifacts. Every model claim below was checked
against the staged repository source before disposition.

## Resolved finding

### Over-broad evidence exclusions could create a false-green subject hash

The first qualification implementation excluded any tracked path ending in a
review/receipt suffix. A source-bearing file with such a name could therefore
change without changing the qualified subject. This was locally reproduced,
then fixed by replacing suffix/prefix exclusions with an exact allowlist of the
two circular receipt paths. The negative-control suite now proves a
`src/bypass-review-evidence.json` object changes the staged subject hash.

Status: **resolved**.

### Suffix-wide contamination exemptions could hide untracked source

The continuation audit found the contamination filter still treated any path
ending in `-verification-receipt.json` or `-performance.json` as non-source.
This was replaced by exact receipt-path exemptions and a shared
`isSourceBearingPath` contract. Negative controls now prove similarly named
files under `src/` remain source-bearing.

Status: **resolved**.

## Tribunal findings

The Tribunal's strongest concerns were native/platform drift, Node-version
drift, filesystem case sensitivity, and mutation randomness.

- Native and multi-platform binary qualification is explicitly owned by S7/S9;
  S1B makes no cross-platform runtime-release claim. Status: **refuted as an
  S1B blocker; retained in the S7/S9 acceptance matrix**.
- Node 22/24/26 qualification is explicitly an S9 release gate. S1B proves an
  exact clean checkout under the recorded current runtime. Status: **refuted as
  an S1B blocker; retained for S9**.
- Case-sensitive filesystem qualification is an S8/S9 platform/distribution
  gate. The current package/edge identifiers are compared byte-for-byte and
  deterministically in S1B. Status: **refuted as an S1B blocker; retained for
  S8/S9**.
- The S1B negative controls are deterministic fixtures; they do not randomly
  sample mutants. Status: **refuted**.
- Frozen-oracle timestamps are data inside content-hashed immutable artifacts,
  not regenerated acceptance inputs. Status: **refuted**.

## Independent-review findings

The Qwen review named five files that do not exist in the staged subject
(`mod-kernel/src/oracle/submit.ts`, `mod-api/src/guards/consensus.ts`,
`cli/src/runner.ts`, `mod-kernel/src/pipeline/subject.ts`, and
`mod-api/src/monitor/exit-code.ts`). Repository search confirmed all five claims
were invented. Status: **refuted**.

The GPT-OSS review mostly restated gates that are executable in the clean
qualifier. Its request for a separate package-consumer compile was already met
by `verify-modular-slice1a-pack.mjs`; its graph and oracle checksum concerns are
already executable checks. Status: **refuted as duplicates**.

## Additional pressure-test observation

Running package verification concurrently with a clean rebuild exposed a
temporary window where `tsup` had removed declarations before `tsc` regenerated
them. The prescribed sequential build-then-pack release gate passes. Atomic
staging and promotion of immutable package prefixes is a required S7 behavior,
so this is recorded as S7 evidence rather than waived or mislabeled as an S1B
pass.

## Verdict

No locally actionable S1B finding remains. The over-broad hash exclusion was
fixed and has a discriminating negative control. Later-slice risks remain bound
to their existing executable acceptance cells and are not claimed green here.
