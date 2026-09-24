# S5 exact-subject review adjudication

Subject: `sha256:8b6d62dbe2a485fe14d8b5cc1a8e47161e92bb5d3a65cbaed458087c56d6b315`

The first successful review was bound to the superseded `1c5f…8bba` subject.
Its model findings were source-checked. The claimed README files, mod bridges,
rollback packages, synthesis optimizer, integration failures, and other cited
symbols did not exist; the seven diff-review findings pointed at unchanged
legacy catalog declarations and asserted no concrete defect. They are retained
under `superseded-1c5f/`, but are not acceptance evidence.

Local source adjudication found one real gap that neither reviewer identified:
the registry intentionally uses stable inventory occurrence IDs, but the S5
compatibility runtime originally received those synthetic IDs instead of the
legacy public command/tool/result ID. The package generator now binds every
executable closure to `publicId`. The package verifier invokes all executable
contributions and fails unless the compatibility runtime observes the exact
public ID. This fix changed the subject hash and forced a new Tribunal and
independent review.

The final exact-subject Tribunal returned `NO_FINDINGS` from both engines, but
its explanatory file references were hallucinated and therefore contribute no
positive evidence. The final independent GPT-OSS review returned no findings.
The Qwen review reported `src/auth.ts:42`; no such staged or repository path
exists, so the finding is refuted. No locally actionable model finding remains.

Acceptance rests on executable evidence: 36 independently built and dry-packed
packages; exact asset/pack checks; 341 ownership assignments; public-ID adapter
invocation checks; every-mod disable/cascade reachability; 86 persisted
assignments; the 160-workflow/raw-envelope oracle; RAG conformance; retained S4
rollback; full repository tests; typecheck; lint; generated drift; and measured
all-package imports. Raw model outputs are preserved so these adjudications are
auditable rather than silently discarded.
