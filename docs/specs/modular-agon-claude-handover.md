# Modular Agon: Claude collaboration handover

Status date: 2026-10-06. Repository: `KERNlang/agon`.
Integration update: 2026-10-08. Claude's work through `31a23825` is integrated
with the router fixes. See the dated product-audit entry for verification. The
original brain task below is historical, not a request to implement it again.
Codex also repaired acquisition's internal await and detachment gaps found in review.
Integration worktree: `/Users/ra/dev/agon-modular-implementation`.
Integration branch: `feat/modular-agon-full`.
Review PR: <https://github.com/KERNlang/agon/pull/311>.
Last committed base at handover preparation: `de98059f`.

## Start here

Help finish Modular Agon without replacing the operator's working installation.
This is an existing implementation and repair effort, not permission to restart
the architecture or produce another parallel implementation.

**The branch is suitable for an unfinished-work review. It is not release-ready.**
Green development tests do not establish complete extraction, native-platform
qualification, safe live-provider recovery, or release acceptance. Do not tell
Raphael or Nico that the product is complete from package counts or test counts.

Read this file, repository `AGENTS.md`, the current product audit, and the
acceptance roadmap before editing. Verify every historical claim against source
and current evidence. Later audit sections can narrow an earlier open finding;
the initial findings table alone is not a complete current implementation map.

## Operator constraints

- Never install, link, promote, replace, update, or test the active/global Agon.
- Never mutate personal configuration, credentials, histories, ratings, rooms,
  goals, caches, or buddy engines. Do not copy credentials into fixtures.
- Use isolated homes, caches, prefixes, ports, subprocesses, and fixture engines.
- Do not launch provider CLIs, authentication flows, or browser tabs for tests.
  Earlier runs produced unexplained login tabs. Isolation must be established
  before running any path that could dispatch a provider.
- Do not activate the Multi-AI Build Pipeline. No implicit paid model fan-out.
- Do not weaken tests, skip meaningful gates, or broaden exclusions to get green.
- Preserve unrelated operator changes. Stage explicit files, never `git add -A`
  in a shared worktree. No destructive resets or cleanup of someone else's work.
- Never commit to main. No authorship/co-author trailers.
- No push permission transfers to your Claude session. Ask Raphael before pushing.
  Return a local commit or diff to Codex; do not merge the integration branch.
- Respect the user's short-answer preference: result first, short sentences,
  one idea per sentence, a few bullets, no long conversational status report.
- Do not run LibreOffice, `soffice`, or interactive Quick Look on this Mac.

Repository instructions suggesting global linking are overridden by the explicit
no-active-installation constraint. External review requirements do not authorize
reading personal credentials or bypassing isolation. Record blocked review cells
honestly if a safe external-engine setup is unavailable.

## Product contract

The intended product has a minimal kernel, hidden support packages, and physical
user-toggleable mod packages. Existing workflows and defaults remain recognizable.
Built-ins start installed/enabled, but users can disable them. Disabled built-ins
remain visible with clear reasons. A child requires its parent, not the reverse.
Profiles are desired-state selections, primarily user-global rather than per repo.
Repository configuration cannot silently activate executable code or grant trust.

One immutable, resolved, owner-tagged registry generation must drive CLI, TUI,
MCP, Cesar, and documentation. Every compatibility adapter needs an owner,
removal condition, kill-list entry, and discriminating removal test. Preserve
historical readers for disabled or removed producers.

Lifecycle operations require staged qualification, atomic promotion, rollback,
safe mode, restart semantics, and durable evidence. Folder mods have explicit
content-bound trust and grants. Full-code trust is not a sandbox. Distribution
must work through npm/npx without arbitrary lifecycle scripts or global mutation.

Original acceptance targets are **49 packages, 852 ownership assignments, and
15 kill-list entries**. The corrected dependency target is **144 unique edges**.
These are specification targets, not evidence that migration is complete.

## Authoritative reading order

1. [Product audit and repair history](modular-agon-product-audit.md).
2. [Acceptance roadmap](modular-agon-acceptance-roadmap.md).
3. [Machine-readable roadmap](evidence/modular-agon-implementation-roadmap.json).
4. [False-green Slice 1A supersession](evidence/modular-agon-slice1a-audit-supersession.md).
5. [Ownership assignments](evidence/modular-agon-ownership.json).
6. [Package map](evidence/modular-agon-package-map.json).
7. [Migration kill-list](evidence/modular-agon-migration-kill-list.json).
8. [Lifecycle/artifact ledger](evidence/modular-agon-lifecycle-artifact-ledger.json).
9. Relevant remaining `modular-agon-*.md`, executable schemas, fixtures, and
   verification scripts. Resolve contradictions explicitly rather than choosing
   whichever document makes a gate green.

The intended slice order remains S1B acceptance truth → S2 durable host → S3
desired state/UI → S4 support extraction → S5 mod extraction → S6 generated
surface cutover → S7 lifecycle → S8 trust/folder mods → S9 distribution.
Do not infer slice acceptance from a directory existing or an old passing receipt.

## Current collaboration split

Codex owns the router recovery fixes in
`packages/cli/src/signals/dispatch/cesar-router.ts` and
`tests/unit/cesar-recovery-cleanup.test.ts` during this handover.
Do not edit those files concurrently in the integration worktree.

**Suggested first Claude task: close the brain-internal cleanup failure bypass.**

Primary source: `packages/cli/src/cesar/brain.ts`, around the context-budget gate,
`ensureCesarSession` call, and its catch-based adapter fallback. Also inspect
`packages/cli/src/cesar/session.ts` and `session-health.ts`.

Observed source fact: the brain has an entry cleanup-health check, but its
session-acquisition catch resolves a backend and enters adapter fallback.
An asynchronous turn can change cleanup state after entry. The router's outer
guard cannot prevent an adapter launch that already happened inside the brain.
This is a source-grounded risk to reproduce, not a claim of a completed test.

Required task result:

1. Reproduce failure during an awaited budget/session boundary with fixture engines.
2. Cover the original session becoming failed after detachment/replacement, and
   the current session becoming failed. An entry-only check is insufficient.
3. Prove no replacement adapter dispatch or delegation occurs after that failure.
4. Preserve healthy CLI/API fallback behavior with positive controls.
5. Return a structured failed turn with the existing restart warning and correct
   spinner/busy/abort cleanup. Do not leave the UI busy or trigger outer recovery.
6. Test resolved and rejected asynchronous outcomes where applicable.
7. Keep the fix narrow and coherent. Reuse health policy rather than inventing
   another independent session-health store.
8. Report what remains unproved, including provider termination and durable recovery.

Create a new focused test file to avoid concurrent edits to Codex's recovery tests.
Agree before modifying shared APIs or the router. Do not remove compatibility
owners as part of this bounded safety fix.

### Worktree procedure

First inspect `git status --short`, `git branch --show-current`,
`git worktree list`, and `git log -5 --oneline` in the integration repository.
Use its latest completed commit, not the historical base above, after Codex
finishes this batch. Do not copy its uncommitted work blindly.

If both destination and branch are unused, create your separate worktree:

```sh
git worktree add -b fix/modular-agon-claude-brain /Users/ra/dev/agon-modular-claude HEAD
```

Run that command from the integration repository. If either name already exists,
inspect it and choose a new name; never reset or overwrite it. Install dependencies
only inside the isolated checkout/prefix, with scripts disabled and an empty npm
configuration. Do not use `npm link` or the global `agon` executable.

## Recent fixes you must preserve

| Commit | Behavior | Evidence limitation |
| --- | --- | --- |
| `de98059f` | Stop one-shot result processing/escalation after cleanup failure | Fixture adapter; cannot retract in-flight provider effects |
| `51926064` | Guard initial brain completion and recovered-delegation approval | Does not guard every internal brain await |
| `c3b1832b` | Refuse recovery after close/detach failure; retain captured entry identity | Not transactional config/session rollback |
| `2e69e8ff` | Shared CLI session-health marker; manual entry refusal | In-memory WeakSet, not durable or a process-death proof |
| `1c91f86a` | Visible failed-cleanup handoff and cancelled automatic retry | Saved config can differ from unresolved old provider state |
| `c16b8783` | Remove detached queue timers; cancel tagged retries | Queue-effect tests do not prove every mounted UI lifecycle |
| `0cc9c21a` | Preserve automatic retry identity through input queue | A manual identical prompt remains a new turn |
| `44927ede` | Explicit, single-use plan fallback authority | Fixture plan execution, not live provider qualification |

This handover batch additionally tests one-shot suggestion approval: mark the
captured session failed while approval waits, then approve. The new guard must
refuse job launch. The healthy control must still schedule the approved job.
See the current diff and the dated audit section for its final verification.

`session-health.ts` deliberately uses a WeakSet of session objects. A captured
entry reference prevents detachment from erasing the failure. The warning says
restart is required and the previous provider may still be running. Do not
change that into a claim that the provider has stopped.

Other recent work covers owner-tagged Brainstorm TUI routing, installed PTY
cancellation, child-process cleanup, durable run-record finalization, staged-status
inspection, and watchdog stall classification. Find exact scope and negative
controls in the audit. These repairs do not close all Brainstorm extraction work.

## Remaining work inventory

| Area | What still needs evidence or implementation |
| --- | --- |
| Brain internal recovery | First Claude task above; cross-await cleanup refusal |
| Router alternate recovery | Acting-Cesar guards added 2026-10-06; recovered/one-shot team-forge preparation guards added 2026-10-08. Later in-turn continuation boundaries remain separate work |
| Provider/session lifecycle | Actual termination, manual cleanup failures, durable config/session recovery, parallel plan recovery |
| A05/A11 plan | Explicit plan session/execution boundary and removal evidence; preserve task/resume/approval semantics |
| A06/A11 Brainstorm | Audit remaining host/session adapter, raw behavior parity, checkpoint/session consistency, UI recovery and extraction |
| A13/A11 Apply | Physical backend extraction with approval/artifact parity; retire A13-APPLY-HOST only with proof |
| A10 mutation evidence | Real implementation mutants killed by discriminating tests, not relabeled negative controls |
| A11 ownership | Reconcile each remaining source owner and kill-list entry against actual runtime reachability |
| A15 daemon | Resolve or evidence-explain intermittent survival/no-pong observation |
| A21 watchdog | Deterministic stall fixture is repaired; full live handoff qualification remains distinct |
| Release evidence | Clean committed qualification, native macOS/Linux cells, compatibility, performance, supply chain, independent review |

Re-read the audit before claiming any row is unchanged. A07 has a local 4 GiB
lint result; do not convert that into verified Linux CI evidence without a run.
Registration/activation coverage for 36 mods is not execution coverage for all
36 workflows. Pack success is not complete physical extraction.

## Verification workflow

Use test-driven development: reproduce the missing behavior, observe the expected
assertion failure, implement, then prove the healthy path still works. Avoid false
reds from incomplete fixtures. For chat persistence use a real fixture session
under an isolated `AGON_HOME`; a `{messages: []}` object lacks durable session setup.

Use deferred promises to control the exact race, not sleeps. Mock provider calls
and do not execute job callbacks just to assert scheduling. Keep the router or
brain under test real. Check dispatch count, persisted messages, user warning,
delegation state, and cleanup—not only a returned boolean.

Before committing, run the repository gates in a sanitized environment:

```text
npm run build
npm run typecheck
npm run guard:reexports
npm test
npm run lint
node scripts/spec/verify-modular-release-set.mjs
node scripts/spec/verify-modular-supply-chain.mjs
node scripts/spec/verify-modular-supply-chain.mjs --check --self-test
node scripts/spec/verify-modular-npx.mjs --no-write
```

Build before full tests and packaging; concurrent build/test can race on `dist`.
Release-set generation precedes SBOM generation. Review generated metadata changes.
The installed check builds isolated prefixes; never redirect it to the active one.
Read scripts before execution. Missing offline dependencies are an environment
failure, not a product pass. Hydrate only public dependencies in a temporary cache
with scripts disabled, then rerun the offline gate. Do not expose npm credentials.

The repository helper `scripts/spec/pressure_modular.py` provides
`isolated_environment` and `run_step`. The environment allowlists inherited keys,
uses isolated HOME/AGON_HOME/XDG/TMPDIR/npm paths, empty npmrc files, and offline
scripts-disabled defaults. Use its environment for child processes; do not
repurpose the shell's HOME variable. This is isolation plumbing, not a security
sandbox against arbitrary hostile code.

For committed-source regression qualification, inspect the runner, then use:

```text
python3 scripts/spec/pressure_modular.py --repo /path/to/your/worktree --cache /path/to/isolated/populated/npm-cache --profile full --repeat 3
```

The cache must contain `_cacache`; the runner copies that data, not credentials.
It archives HEAD and excludes working changes. A pass therefore does not qualify
uncommitted edits. Capture its receipt, exact subject, gate list, platform and
limitations. Run separate clean-worktree/contamination and review-evidence gates
required by the roadmap; the command alone does not certify the entire product.

Codex's temporary development helpers currently live at `/tmp/agon-exit-check.py`
and `/tmp/agon-exit-no-login.cjs`, with logs under `/tmp/agon-exit-qualification`.
They can disappear and are not project contracts. The helper hardcodes Codex's
worktree: **do not use it to qualify Claude's worktree**. The preload blocks common
provider/browser executables but is only a diagnostic guard, not a sandbox.
Development logs can be overwritten. Preserve subject-bound evidence separately.

### Last recorded baseline

For `de98059f`, the audit records 6,293 passing tests, five existing skips across
541 files, build/typecheck/lint/re-export gates, release packs, supply-chain checks,
and 72 isolated installed-product checks. Full-suite log SHA-256:
`dddec24aaf5bb0015639f6ff47da064e75a614072256cfd75ce6b4fefcb659f4`.

These are historical development results, not fresh verification of your checkout
or an independently reproduced release receipt. State exact new counts and failures.
Never call a skip, timeout, unavailable native runner, or missing credential a pass.

## Required return to Codex

Provide a short summary plus a durable evidence note containing:

1. Worktree, branch, base commit, final commit or explicit uncommitted diff.
2. Root cause with exact source paths and the affected observable behavior.
3. Red test assertion, minimal fix, healthy controls, and residual risks.
4. Commands, exit codes, subject hashes, log paths/hashes, platform, and scope.
5. Files changed, generated artifacts, and any needed integration ordering.
6. Findings classified as verified, inferred, externally blocked, or product choice.
7. Confirmation of no global installation/personal-state mutation and no push.

Do not claim independent review of your own implementation. Ask Codex to review
the diff, reproduce the tests, and integrate explicitly. Update the product audit
with evidence after integration; coordinate that shared document to avoid edits
colliding. No release approval is implied by this bounded task's completion.

## Definition of finished

The original whole-product bar still applies: complete ownership migration and
kill-list removal; one authoritative registry; disabled mods unreachable through
all five surfaces; clean public boundaries; working install/update/rollback/safe
mode/trust/profile/folder-mod paths; user-observable workflow parity; performance
and accessibility evidence; clean reproducible receipts; independent review.

Native runners, signing, provenance, or publishing permissions that are unavailable
must remain explicit external cells with prepared commands and expected artifacts.
They must not hide locally fixable defects. Nico can review unfinished architecture
now, but approval must identify the remaining work accurately.
