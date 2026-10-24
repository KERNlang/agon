# S5 final exact-subject review adjudication

Subject: `sha256:1d1aedeec8870d55a1bb3a59dc3e6009b070594e3aa0b5aff2520ac8ea444982`

The preceding exact review at `8b6d…b315` resolved the one source-confirmed
issue found during adjudication: executable compatibility closures now dispatch
their legacy `publicId`, and the verifier invokes every executable contribution
to prove it. The final subject differs only in its clean-checkout command list:
S5 no longer tries to replay S4's S3-history rollback search inside a disposable
two-commit S4→S5 history. S5's own retained-qualified-S4 rollback gate remains.

The final Tribunal's claimed `packages/mod-s5/src/rollback.ts` and
`rollback.spec.ts` do not exist. Its S3-payload theory therefore has no staged
source or executable reproducer and is refuted. The independent GPT-OSS review
returned no findings. Qwen reported a blocking extension-permissions issue and
seven related findings under `src/...`; every cited path is absent from the
repository root and staged subject. Those findings are refuted rather than
waived. Similar real files under `packages/cli/src/...` were unchanged by S5 and
remain covered by the 5,578-test legacy suite.

No locally actionable review finding remains. Acceptance is determined by the
exact staged source and executable gates, not the reviewers' confidence labels.
The superseded and failed runs remain preserved for auditability.
