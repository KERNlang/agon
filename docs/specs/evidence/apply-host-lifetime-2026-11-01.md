# Apply approval host lifetime

Base: `e630e175f73ea99eee628d5aa97f8856d427fa96`.
Scope: bind an Apply interaction to the modular host that opened it.

The registered TUI regression uses a real temporary Git repository. Without
the fix, disposing and restarting the enabled host during approval still lets
the old answer apply its patch. The no-restart control succeeds. The fix uses
the existing captured-authority guard; it adds no dependency or public API.

## Verification

Durable archive: `/Users/ra/dev/modular-agon-remediation/`.
Each run has a `.receipt.json` and `.log` named by its ID. Raw evidence stays
outside shipping packages. Do not delete it without Raphael's approval.

| Run ID | Result | Log SHA-256 |
| --- | --- | --- |
| apply-host-lifetime-red-20261101 | Expected failure: restart writes `after` instead of retaining `before`; 9 other tests pass | 8e7a8fce821fa374d14bb815ba69a3cc08030df24504249ad1749c47632ee11e |
| apply-host-lifetime-green-20261101 | 162 tests, typecheck, re-export guard, diff check pass | 0235174d7216b9bf6d895d3035f3615d51cae87d4b155c895ea2b8351513e451 |
| apply-host-lifetime-full-20261101 | Build, typecheck, 12453 tests, lint, re-export guard, release and supply-chain checks pass; 7 tests skipped | 5f5580ebc00776913993ccca18de46d9215d57114c3cd63ec44e357317306d8f |

All three runs recorded zero provider launches. Full run took 875.922 seconds.
All 49 modular package payload hashes and file inventories remain unchanged;
the CLI payload and generated release archive metadata change.

Bound source SHA-256:

- `packages/cli/src/patch-application-host.ts`:
  `2d1af7c56a7e163f787f682d83b6106121aab3cbe3992d98700e73ce57552bbb`
- `tests/unit/modular-apply-authority.test.ts`:
  `9a1b0b9208a6dfe5ac48161949b569168d7607c5411eab2932b81bae0004c567`

Isolated Agon Codex review found no blocking issue. Source-verified resolution:
`apply-host-lifetime-review-adjudication.md` in the archive.
Packet SHA-256: `34d510b8e1fee9287da7c616217908e6e7315d4ebab1938c197c931aeb33ec50`.
Review log SHA-256: `3543717c38524cac1b8285e0d7dccaaf2c9599fca8b0b624538246920bdf4b0a`.

## Limits

Restart does not itself dismiss the question; its old answer is rejected before
Git writes. Existing signal cancellation and scope cleanup are unchanged.
This is branch verification, not a clean committed release receipt, native
platform matrix, installed CLI qualification, or full modular acceptance.
Active/global Agon and personal state were not changed.
