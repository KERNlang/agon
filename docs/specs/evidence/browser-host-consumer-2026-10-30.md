# Browser Host consumer ownership

Status: this slice passed clean-checkout qualification. Not release acceptance.
Runtime subject: `803da575ef1bcf5ee8342b168a0860985d1c7463`.
Base: `26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7`.

## Scope and limits

The CLI Browser Host command imports its existing Browser Bridge owner directly.
Only value/type import sources change. Pairing, native framing, installation
state, origins and launcher behavior remain unchanged. No new dependency.
The historical forwarding module and independent parity test remain.

The Browser Host suite imports the real public owner and makes the old module
unavailable. Before the command change, collection fails at its legacy import;
the separate four compatibility-parity cases still pass. After the change,
all 53 focused cases pass. This guard covers the exercised runtime boundary,
not erased type imports, every lazy path or real process concurrency.

All 49 modular payloads, dependency lists and versions match the base.
Launcher payload changes; its file count remains 137. Release-set, SBOM and
release-channel metadata were regenerated with the existing commands.

## Durable evidence

Raw logs and receipts live in the operator's durable `modular-agon-remediation`
archive outside Git and shipping packages. Preserve it until Raphael explicitly
approves deletion. Every listed completed run recorded zero real provider launches.
Log hashes were independently recomputed. Expected failure is not a passing gate.

| Run ID | Result | Log SHA-256 |
| --- | --- | --- |
| `browser-host-baseline-20261030` | PASS: build/types/lint/guard, 12,112 tests, 7 skips, clean Git | `26d0bac2ae5226502dbdf9f0e94174a1ee264b492fd5a3d4e60aff3bf5e71d8a` |
| `browser-host-red-20261030` | Expected FAIL at legacy command import; 4 parity cases pass | `09e55c3db3150e79f6f77ead8bf9fed1a70b2a7d18b22c92faf38ffc013f8088` |
| `browser-host-focused-20261030` | PASS: 53 tests, types/lint/guard | `66f9161080a217ee9c3ca4afc4af1c1923096d366b8fd39c27c4774e6e12acfe` |
| `browser-host-full-build-20261030` | PASS: build, metadata, types, 53 tests, lint/guard/roadmap | `bf2bb9882baaeb6014b7db45e97ae12cfdeee94bcca9d4585f13cda9861b800d` |
| `browser-host-full-runtime-20261030` | PASS: 12,112 tests, 7 skips; 129 installed checks; 31 compiler checks | `f7edfb72b8e5cdfbedbfa0d2dc3e99b516a4c4530eaecb7ebe0fd31ef203fc41` |
| `browser-host-clean-build-20261030` | PASS: exact commit; offline locked install, build/types/lint/guard, clean Git | `c95d674f2e56d561edfefc0e6fa3b4de27e44f69da2ab04ba8482f961f85e118` |
| `browser-host-clean-runtime-20261030` | PASS: exact commit; 12,112 tests, 7 skips; 129 installed checks; 31 compiler checks; clean Git | `7b5382a4f6ed1a5099c5c222a2119b8642ba0704dd75a614e1f05fab801f7a6d` |
| `browser-host-clean-perf-load-20261030` | PASS: eight performance suites, sustained transport/workflow load, clean Git | `a740861ff342479b6397434a56401903c9ba64ea89d22bd98188255601cd1017` |

Load qualification ran for 279.051 seconds. The workflow phase verified 704
outputs with four concurrent fixture engines. Failure, cancellation, recovery,
engine cleanup and host shutdown controls all passed. These are fixture-engine
checks, not live-provider qualification. Platform: macOS arm64, Node 26.12.1.

## Independent review

Isolated Agon Codex found no introduced regression. Reviewed production/test
bytes match the runtime commit. Findings and limits were verified against source.
Temporary authentication copy was removed.

Input: `browser-host-consumer-review-input.txt`, SHA-256
`13243072fad2be23aed7a66685745500ff38955af6e3468893dc851eac18d55b`.
Output: `browser-host-consumer-codex-review.log`, SHA-256
`3247019b8849eb83696f42ed613badccc5a4ab3c557dba718cd7497e8f2669d9`.
Adjudication: `browser-host-review-adjudication-20261030.md` in the archive.

## Qualification limits

Final HEAD remained the exact runtime subject. Git status was clean, and ignored,
untracked and unstaged source-contamination arrays were empty after all gates.
Pre-install and post-build source-contamination arrays were also empty.
No real browser was opened or native host installed in personal state.
Historical wrapper retirement and combined-main slice receipts remain open.
Native platform, live-provider and publishing evidence remain separate release
requirements. Active/global Agon was not modified.
