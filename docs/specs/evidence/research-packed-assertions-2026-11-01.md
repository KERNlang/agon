# Installed Research assertion repair

Base: `e630e175f73ea99eee628d5aa97f8856d427fa96`.
Scope: per-case draft assertions in `scripts/spec/verify-modular-npx.mjs`.
No production behavior or dependency changes.

## Defect and correction

The merged verifier covers fifteen addresses but still expects five total
draft calls. An unchanged-main run reproduces `15 !== 5` after the network
and citation checks pass. Resetting the observed calls before each address
and asserting one exact `{ engine: 'fixture', textOnly: true }` call removes
the stale aggregate while checking each invocation more strictly.

All fifteen address cases and existing network, citation, prompt, context,
and installed-package provenance assertions remain intact.

## Evidence index

Logs and receipts remain outside Git under the operator's durable evidence
root. Each run ID names its `.log` and `.receipt.json`. Do not delete them
without Raphael's approval.

| Run | Result | Log SHA-256 |
| --- | --- | --- |
| research-packed-main-red-20261101 | Unchanged main reproduces fifteen-versus-five failure | 9f398e1df6ee189bf8a641ae4ce5f01b1e331ed6a30f60fc4e475ba86ecb3e56 |
| research-packed-green-20261101 | Research checks pass; later setup archive verification fails | 173cf0128f8a1cc3f6d976446f12dae850bda7410f56dab6b6097dc3dc85a013 |
| research-packed-repository-gates-20261101 | Build, types, 12,451 tests, lint, re-export guard pass; seven tests skipped | 345459467fe32dd403801cd96ec9d5dfff1694eaa8374e3997661f6ea9406e32 |

All three runs recorded zero provider launches. Exact-source assertion controls
accept the correct singleton and reject missing/duplicate calls, missing/false
textOnly, and wrong engines. Zero and two calls across adjacent cases are also
rejected individually. These are oracle controls, not a production mutation score.
External record: `research-packed-assertions-controls-20261101.md`, SHA-256
`38f06a0dfda499e66548f7a843444e3864d080e5850413f379a96b6d7bc36500`.

Isolated Agon Codex review found no issues. Source inspection and controls
confirm its assertion analysis. Review packet SHA-256:
`09627e1870687b13c3f848a15a1bd6e2545294d092f7c547d4c5ae4b9940a9d3`.
Review log SHA-256:
`00d107a576bd7a44a9d57442a67c93f78c961d318970fbc848813317f0321737`.

## Remaining limit

The complete installed suite is not green: setup rejects the freshly packed
kernel archive against the committed channel hash. A separate diagnostic
proves equal payload hashes but different archive integrity. This patch does
not change release metadata or relax integrity checks. Full release acceptance,
other platform qualification, and live-provider evidence remain separate.
