# Cesar -> Claude Code parity goal review

Reviewed: 2026-07-13
Repository HEAD: `a5e55cdfa088c2bb2ddf964f27bf598d2fbad69c`

## Verdict

Keep the product objective, but do not run
`cesar-claude-code-parity-prompt.md` as an implementation prompt in its current
form. It is a useful historical design record, not a current backlog.

The prompt was audited against `origin/main @ f9e5bf6a` on 2026-06-11. Current
main already contains most of phases A-D, while the prompt still describes those
branches as unmerged. Following it literally would duplicate shipped work and
send implementers to stale file locations.

## What changed

- The prompt says to work in `~/KERN/Agon-AI`; the current repository is
  `~/KERN/agon`.
- The named memory studies are not present in this repository.
- `surfaces/app.kern` is now 1,914 lines rather than 2,792, and the proposed
  surface modules exist. The skeleton is still incomplete: `app-rendering.kern`
  is 1,450 lines and several raw blocks remain over 100 lines.
- The prescribed six branches, parallel agents, pinned six-engine reviews, and
  memory-update process describe one historical delivery plan. They should not
  be treated as product acceptance criteria.
- The original full gate is still sensible, but a named live-engine exception
  should not be permanently accepted without re-verifying that it still exists.

## Current-state matrix

| Phase | Current status | Evidence / remaining gap |
| --- | --- | --- |
| S: surface skeleton | Partial | Keyboard, interrupt, submit, output, lifecycle, layout, views, and rendering modules exist. The thin-wiring and raw-block-size targets are not met. |
| 0: loop and interrupt hardening | Mostly open | Turn-start telemetry and continuation-cap warnings exist. A per-tool execution timeout was not found. MCP watcher cleanup still occurs on multiple paths instead of one owner. Busy Ctrl+C still returns `togglePauseMenu`; double Ctrl+C still reaches direct `process.exit(0)` calls. Esc-Esc conversation rewind was not found. |
| A: turn shape | Mostly shipped | Compact tool events, durations, live todos, mid-turn steering, preambles, and recaps are present. Validate the final interaction in a real PTY session rather than rebuilding it. |
| B: editing ergonomics | Mostly shipped | Diff previews, per-edit snapshots, the `@` file picker, `! <cmd>`, and image attachment paths exist. Claude PTY/stream-json vision still reports that images are not sent, so vision parity is incomplete for those paths. |
| C: behavior contract | Shipped | Gate discovery and done-claim nudging, `/nogate`, SaveMemory, strict confidence escalation, and the concise-output prompt contract are present. |
| D: trust and config | Shipped | Persistent permission rules, pre/post tool hooks, `/permissions`, and configurable engine/context/branch status rendering are present. |

This is a source audit, not a completed interactive parity certification. Items
marked shipped still need the end-to-end session benchmark before the overall
product goal can be called complete.

## Revised goals

### Goal 1: finish the reliability spine

This is the highest-value remaining work because it prevents hangs, abrupt exits,
and lost turn state.

1. Add a configurable per-tool timeout that yields a visible tool error and lets
   the turn continue.
2. Put every per-turn timer, watcher, approval waiter, and child operation under
   a single abort-aware cleanup owner.
3. Replace the dead pause-menu route with the documented interrupt contract.
4. Centralize graceful exit: abort work, settle approvals, close sessions and
   children within a bound, restore the terminal, then exit with the right code.
5. Preserve interrupted partial output and implement/test Esc-Esc rewind only
   after the transcript and file-checkpoint semantics are specified together.
6. Add chaos tests for hung tools, failed recovery sends, mid-approval abort,
   PTY death, and double-Ctrl+C during child work.

Acceptance:

- No key handler calls `process.exit` directly.
- A deliberately hung tool cannot wedge a turn indefinitely.
- Interrupt acknowledgment is immediate and the next prompt remains usable.
- All per-turn resources settle on success, error, timeout, and abort.
- The full compile/build/test gate and the new chaos suite pass.

### Goal 2: finish targeted surface decomposition

Do this as behavior-preserving work after the reliability ownership boundaries
are explicit. Optimize for understandable state ownership, testable pure
decisions, and small hook dependency surfaces. Do not use `<600 lines` as the
primary oracle: line count alone can move complexity into another monolith.

Start with the remaining large raw blocks in `app.kern`, `app-keyboard.kern`,
`app-submit.kern`, and `app-rendering.kern`. Require each extraction to reduce a
measured dependency or ownership problem and keep the full gate green.

### Goal 3: certify the daily-driver workflow

Record one real bug-fix session that exercises preamble, tool progress, live
todos, steering, diff approval, gate-before-done, interruption, resume/attach,
and honest closure. Treat failures found in that session as a small follow-up
backlog. This benchmark, not the presence of individual source symbols, decides
whether parity is achieved.

## Scope note

The Tribunal protocol, Brainstorm failure/health reporting, Cesar telemetry and
routing cleanup, and Conquer isolation changes developed in the adjacent mode
smoothness work are independent reliability improvements. They should not be
counted as completion of the parity phases above.
