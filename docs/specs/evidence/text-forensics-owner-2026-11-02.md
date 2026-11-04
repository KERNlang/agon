# Text-forensics ownership evidence

Candidate branch: refactor/modular-text-forensics-owner.
Base: e630e175f73ea99eee628d5aa97f8856d427fa96.
Worktree: /Users/ra/dev/agon-apply-host-lifetime.
Status: corrected local qualification passed. Human merge and full release acceptance remain separate.

## Change

Sanitize owns one text scanner/cleaner in src/text-forensics.ts. Core retains
all ten value exports and three type exports through the public package subpath.
Physical Sanitize and physical Naturalize use the same policy. Core's legacy
policy is unchanged except one identical unreachable classification condition.
Its bytes, after removing that duplicate line, match the new owner exactly:
SHA256 8939f2b82384ed45a1b310291a22bb825cf08dd44fe67307397f9d7bf001afb2.

The physical scanner previously omitted mixed-script and variation-selector
reports. Existing legacy expectations now run against both implementations.
Physical cleaning now also strips U+180E and U+2000-class spaces, as Core does;
it previously collapsed the spaces to one space and kept U+180E, so words
separated only by such a space now join.
Core → existing mod-sanitize is the only dependency addition. No external
version changed. Metadata scanning remains unchanged in this PR.

## Executable evidence

All run IDs below name adjacent immutable `.log` and `.receipt.json` files.
All test runs recorded zero provider launches.

| Run | Result | Log SHA256 |
| --- | --- | --- |
| text-forensics-owner-red-20261101 | Expected failure: 2 physical detection cases, 36 pass | 3b5fdb16f627dbc303c12dabe7f01e4fc263c6d4b104fa542bf18a8c3b2bd935 |
| text-forensics-owner-focus-20261101 | Package build, repository types and focused tests pass | a547decfc2150169590352b0c2c68930d9b31d95b16a728a3c229a989d30d11b |
| text-forensics-owner-command-20261101 | 78 tests pass, including command Unicode preservation | 174679a6061928cbf22d1a46c2a9391e87466799d8bdf50c7707649d5231fe3d |
| text-forensics-owner-negative-20261101 | Expected failure after restoring old Core owner; facade restored afterward | a55ca6b488f02c8fc8fb4f0ba6c1395c5d094dbd5da47d1737419064a38c52a9 |
| text-forensics-owner-full-20261101 | Full gate pass before review correction: 12470 pass, 7 skip, 978.864s | 00a9b06d45f7e66fa1b06bd84f413b16bbeb42af1ba56b88f31f4a3b0035bae7 |
| text-forensics-report-red-20261101 | Expected failure: preserved findings falsely called addressed | bdea5b2a9c5c2ab03f30aa64582cd09ce91cef165e10073f7bdce40d0c1756da |
| text-forensics-report-green-20261101 | Corrected package build, types and 80 focused tests pass | ec509b80a67d8eadcb3339c8c184b37eafb4098349e0ecdd59c442efc4e7bb6e |

Corrected full gate: text-forensics-owner-qualified-20261101, exit0 in983.908s,
12471 tests passed, 7 skipped, zero provider launches. Build, typecheck, lint,
reexport guard, generated drift, release pack and supply-chain self-tests pass.
Log SHA256 aebcb5c35fc9e18bdb03e52090bb2285f532bbe500d050bf57352886704426e7.

Final compiled command probe after gates: text-forensics-final-built-20261102,
exit0, four registered CLI/TUI command invocations. Verified explicit-file output
counts, preserved Unicode, detect exit1, stripped output, public subpath function
identity and reverse-order disposal. Fake permission/receipt services; no providers.
Log SHA256 6322e519ec4957c3ab62bcf32ff1b0fe554ecb9c121e89dbfe5d5b57b9371182.
This is compiled contribution execution, not an interactive TUI or global install.

Generated release-set comparison against base after corrected build: only
kernel and mod-sanitize payloadHash values differ among 49 modular packages.
Sanitize adds dist/text-forensics.js and .d.ts, +5936 unpacked bytes. Kernel
contains changed Sanitize manifest identity hashes, no unpacked-size growth.
Launcher payload changes and shrinks by149 unpacked bytes. This is a package
content comparison, not a runtime performance measurement.

## Independent review

One isolated Codex review through Agon. Packet SHA256
e3b3c8fa96e6c3b53820af04859f06dc38491a1bb3c73730b8116027f0d955fb.
Review log SHA256
3c1dfcf6a4a8c4aee13dcaa189af1aa501bc3e5b36a95ef027326ecd1b8629cc.

P2 confirmed: `--out` said two findings were addressed although both were
reported-only and preserved. Actual compiled run reproduced the message and
verified unchanged file bytes in sanitize-review-output-giv7gb/out.txt.
Fixed with separate addressed/preserved counts. Regression covers zero, mixed,
and entirely actionable findings; original message remains for no preserved
findings. Review's inherited Unicode policy limitations are not new defects.

## Limits and ownership honesty

Frozen ownership assigns CleanResult to kernel-contract-default. That historical
snapshot is not rewritten here. Current definition lives in mod-sanitize,
Core compatibility is a reexport. The current roadmap verifier checks legacy
source existence and does not prove declaration ownership. This receipt does
not claim a fully reconciled historical ownership ledger.

Reported-clean means no actionable findings, not absence of every suspicious
character. Keyed statistical watermarks cannot be assessed by this scanner.
Existing NFC/whitespace policy can change tabs even when scan reports no finding.
Existing mixed-script detection and NFKC prose are not general script-security
or deobfuscation guarantees. No new Unicode policy introduced.

OSV after lock change: 30 advisories in 13 unchanged external packages,
2 critical, 11 high, 15 medium, 2 low. Not a security pass. Separate dependency
remediation remains necessary; no dependency upgrades bundled here.

No global installation, personal-state mutation, live-provider run or merge.
Full original Modular Agon acceptance remains open.
