# Generated CLI repeat policy

Base: `e630e175f73ea99eee628d5aa97f8856d427fa96`.
Scope: restore Provenance last-value flags and Ratings combined keep lists.
Optional owner metadata selects normalization; unlisted flags stay strict.
Both generated dispatch and text parsing share the projection. JSON schemas
remain unchanged. No dependency additions or global installation changes.

## Verification

Durable receipts and logs: `/Users/ra/dev/modular-agon-remediation/`.
Each receipt records the exact command, exit status and provider launches.

| Run | Result | Log SHA-256 |
| --- | --- | --- |
| cli-repeat-policy-red-20261101 | 2 fail / 38 pass before implementation | a906fc23fbd5871f1c82eee3e6373b26de0d474050058ba8d405da76f5e0b652 |
| cli-repeat-prototype-red-20261101 | 2 fail / 30 pass before review correction | cd6a2f0c2fa5e852c7bf87021e1221d278bbc08349dd0e8dc57567e89fd918da |
| cli-repeat-ratings-dispatch-20261101 | 92 tests, types and diff pass | f84da791cc60a829a0982ec6128f109eafd166740f1e406d5208cb7d0281b7e3 |
| cli-repeat-policy-qualified-20261101 | Full gate passes, 885.848 s | d4309f4da02c0ce2f7e530f11033f6c567ad56fe98c98025a2a00a3476402c63 |
| cli-repeat-policy-live-20261101 | API pack/compile and 4 built CLI calls pass | 7182e9bde7a3b258c79287432676a6dd0be6ba7af5804868c1abf1794845769f |

Full gate: build, generated mode docs, release/SBOM regeneration, typecheck,
12,467 tests passed and 7 skipped, lint, re-export guard, release-set and
supply-chain self-tests, and diff check. All verification runs blocked providers;
receipts record zero launches. Tests ran on this working tree, not a fresh
installed release candidate. The containing commit identifies the final source.

Live checks execute the built CLI in temporary state: repeated Provenance IDs,
formats and output paths; repeated short aliases; Ratings preview protecting
both keep values without writing the file; unlisted repeated options rejected
before installer effects. API and kernel pack checks reject private sources,
compare frozen schemas, and compile the external API example.

Only Mod API, Ratings and Provenance payload hashes change among the 49 modular
packages. Dependent content identities and launcher inventory are regenerated.

## Independent review

Codex-only isolated Agon review, exit 0. Packet SHA-256:
`f4e9298fe0e5143268e1f198ae7b0f650c5cf8d986370e687005a071f888ff45`.
Review log SHA-256:
`0d6ed6188a41ca80e63f0dca83e5effe9ac5734a8fc68753fa07d566a9335dcd`.

Confirmed finding: inherited `constructor` / `toString` properties acted as
unlisted policies. Fixed with own-property lookup and explicit policy matching.
Fail-first controls exercise both dispatch and text parsing, with absent and
unrelated policy maps. Invalid target, positional and policy values reject
before effects. Added actual Ratings preview and unchanged-file assertions.
Mixed alias precedence preserves Citty behavior; it is not argv-last ordering.
Malformed arrays still fail scalar validation.

An earlier full run was deliberately cancelled after the finding (exit -15),
not accepted. Earlier failed test assumptions about mixed alias precedence and
the Provenance ledger's `runId` field remain in archived logs. Neither changed
runtime semantics to satisfy the test. No unresolved concrete review defect.

## Limits

This qualifies one compatibility fix, not full modular acceptance. Human merge,
integrated clean-checkout qualification, native platform/provider evidence and
release approval remain separate. PR399's null-manifest fix is not included.
