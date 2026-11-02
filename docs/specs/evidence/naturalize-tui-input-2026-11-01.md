# Naturalize registered TUI input

Base: `e630e175f73ea99eee628d5aa97f8856d427fa96`.
Branch: `fix/modular-naturalize-tui-input`.

The registered parser passed filenames and flags as literal rewrite text.
The regression runs the registered contribution with an actual fixture file;
before the fix it dispatched the author instead of the selected rewriter.
The parser now follows the existing filename/flag contract, including `-o`.
Empty input explicitly supplies empty text so the TUI cannot wait for stdin.
No dependency, manifest, CLI schema or direct text API changes.

## Verification

Raw logs and JSON receipts remain outside the shipping tree at
`/Users/ra/dev/modular-agon-remediation/`. Run IDs below name both artifacts.

| Run ID | Result | Log SHA-256 |
| --- | --- | --- |
| naturalize-tui-red-20261101 | 37 pass, one expected failure before fix | 7fbd72ddabbb5ec99b2c5aeb3f50ffec3e577dc55ec37d48f83afd8c6236d571 |
| naturalize-tui-reviewed-20261101 | 81 focused tests, typecheck and diff check pass | 21d5c5d2cfe0162f7fd64ae947b75563e31819a7ef788e697b71e7851f99e56e |
| naturalize-tui-full-20261101 | Exit 0, 935.233s, 12,456 tests pass, 7 skipped | 9668a59b7792ece944b8925a6846e7cb287dacf60c38a05a3f916ff783dae34a |
| naturalize-tui-live-20261101 | Exit 0, three compiled registry invocations; cleanup verified | eb967a705c5e081a1a0e4ee2b0b15aaf6aac5b14aed3c001f8649e48f6c62ef7 |

Full gate: build, generated mode docs, release-set and SBOM generation,
typecheck, full tests, lint, re-export guard, modular release checks,
supply-chain self-test and diff check. All runs used isolated state and
recorded zero provider launches.

Focused tests check file contents in dispatch prompts, selected rewriter,
author refusal, lexical threshold, three attempts, both output flags,
unchanged input, output contents and schema compatibility. Empty input and
invalid threshold refuse without provider calls. The compiled registry check
also checks the output permission and registration cleanup. Dispatch is fake;
this is not an interactive terminal or live-provider qualification.

Isolated Codex review found no blocking defect. Packet SHA-256:
`a58093e1219ce1f17221e6c5eb3ffaa2199e00bd34f42e60215569713759a82b`.
Review log SHA-256:
`855bb775e9ca48c3f50aeb90f6ca0670709ebefcf140865c40e5741d30530b6a`.
Both test suggestions were applied: nondefault three-attempt retry and exact
empty-text assertion. Focused and full checks follow those changes.

## Scope and limits

Only Naturalize's payload changes among the 49 modular packages. Other
package-record changes are archive metadata. Release-set, SBOM and launcher
channel are regenerated together for the changed runtime payload.

Legacy and physical Naturalize workflows still differ; their consolidation is
separate work. Existing duplicate-flag and quoted-output-path limitations are
unchanged. This receipt does not claim full Modular Agon acceptance.
