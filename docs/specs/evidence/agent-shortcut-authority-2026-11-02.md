# Agent shortcut authority evidence

Base: e630e175f73ea99eee628d5aa97f8856d427fa96.
Branch: fix/modular-agent-shortcut-authority.

Natural Agent shortcuts bypassed disabled-mod admission. Three actual
parser/dispatcher tests against a disabled durable host failed before the fix.
All five legacy Agent calls now share canonical Agent admission, captured host
identity, generation lease, cancellation and executionRefusal. Existing solo,
shadow and team algorithms remain unchanged. No dependencies added.

## Review and negative controls

One isolated Agon Codex review identified two issues, both verified locally:

- A running Cesar continuation retained the original job signal, not the
  generation-bound child. A composed dispatcher/router/job-scope test failed
  before the repair and passed afterward. The fix reuses runInJobAbortScope.
- Assertions inside a mocked handler could be hidden by authority error
  handling. Tests now assert recorded observations after settlement and prove
  the stale result was actually returned.

Thirty focused cases cover disabled phrases/intents, queued host replacement,
enabled routing/options, parent and pointer cancellation for solo/shadow/team,
held cleanup with lease retention/release, and healthy success/failure/rejection
continuations. Existing handler/session suites cover internal effect enforcement.
No actual provider calls were used to establish these results.

## Qualification

Full gate passed in 883.146 seconds: 12,481 tests passed, 7 skipped; 734 files
passed, one skipped. Build, typecheck, lint, reexport guard, docs regeneration,
first-party/catalog drift checks, release and supply-chain self-tests passed.
The full run recorded zero provider launches.

Final compiled-source diagnostic passed in 0.715 seconds. It compiles the actual
parser, dispatcher and authority with built workspace dependencies and the
existing lock fixture helper. With real handlers and no handler mocks it proves
three disabled phrases refuse, enabled no-engine input reaches the legacy
handler, stale queued work rejects, and invocation leases drain. It is not a
packed-install test or a full published-CLI end-to-end qualification.

The first diagnostic failed because its fixture changed desired state without
disposing the old host. initializeProcessSurfaceAuthority deliberately does
not restart an existing host. Explicit fixture disposal fixed the test; no
production change was made. The failed receipt remains archived.

All 49 modular package payload hashes match base. Launcher contents change.
Archive hashes differ on local Node26/npm11; this does not replace canonical
Node22/npm10 or native-platform release qualification.

## Durable evidence

Archive: /Users/ra/dev/modular-agon-remediation/. IDs below have .log and
.receipt.json files. Keep the archive until Raphael explicitly approves deletion.
Detailed adjudication: agent-shortcut-authority-adjudication-20261102.md.

| Run | Log SHA-256 |
| --- | --- |
| agent-shortcut-red-20261102 (expected failure) | 35042ecb01720408681df0120d966b46ee758b7876d76e18acdba5196b7f8e13 |
| agent-shortcut-regressions-20261102 | 348de5adee6ed4f2b6d77fe5fcd17bba41204a165b858f4fca317b4940e236fd |
| agent-shortcut-continuation-red-20261102 (expected failure) | b354f2dba5ab6f7a1d8a57b4db57c82b26bea2ba8b1e88e8fb9573a0e077fd43 |
| agent-shortcut-continuation-fix-20261102 | ed1b60bbb8a2826fecd3484cc897e43ee67ccebcf3ff95467e77929d030fa752 |
| agent-shortcut-cleanup-verified-20261102 | d300118614410b55c0a1c7c2ab61b5954f117be6ec889887673d5a9887d764f0 |
| agent-shortcut-full-gates-20261102 | 7b12c89b0bf2d11dd473aefb453264d16bb15b64b5e7261ba55e6f71625f67e5 |
| agent-shortcut-compiled-runtime-fixed-20261102 | 16099114cfbb194141cacad37967d5bc934ab1b850c4447cbc30fe3fcba3f934 |
| agent-shortcut-authority-codex-review | 4f9fdba21ac07d5c719ad254f51121f5cf9a73c24b256e59a562a0373c4e11eb |

Review input hash: e56eb1d4be348e36d48d987948948a49742b71eb4e025d745f3520645014eeea.
This review preceded the locally verified fixes; it is not a final-subject release
review receipt. Full modular ownership and integrated release acceptance remain open.

## Reproduce

Use isolated homes/caches and provider blockers:

```sh
npm run build && npm run typecheck
npm run test:ts -- tests/unit/agent-shortcut-authority.test.ts tests/unit/agent-team-handler-authority.test.ts tests/unit/agent-session-authority.test.ts tests/unit/agent-handler.test.ts tests/unit/dispatch-routing.test.ts tests/unit/dispatch-emit-post.test.ts tests/unit/intent.test.ts tests/unit/modular-plan-step-admission.test.ts
npm test && npm run lint && npm run guard:reexports
npm run test:modular-release && npm run test:modular-supply-chain
```
