# AGON-GOAL-DESIGN.md — `agon goal` autonomous controller

**Status:** draft for review. **Scope:** MVP = a *queue-driver*, not a general fuzzy-goal engine.

## What it is

A persistent controller that drives a finite, machine-verifiable task queue to completion,
unattended, for hours. First target goal: **close all KERN gaps in agon**, because the gap
manifest (`.kern-gaps/`) is enumerable and "closed" is checkable (`kern:compile` + `typecheck`
+ `test` pass and the gap entry resolves).

It is *not* (yet) a thing that turns "make agon great" into work. The decomposer for fuzzy
goals is deferred — the MVP consumes an explicit queue.

## CLI surface

```
agon goal \
  --queue .kern-gaps/ \                 # source of tasks (manifest dir or a tasks.jsonl)
  --gate "npm run build && npm run typecheck && npm test" \   # green oracle
  --branch goal/close-gaps \            # never main; one commit per closed task
  --max-attempts 3 \                    # per task before park
  --budget 50usd \                      # global cost ceiling
  --max-hours 8 \                       # wall-clock ceiling
  --engines claude,codex,gemini \       # who implements/reviews
  --supervised                          # pause for confirm before first push (default on)
```

`agon goal --resume` picks up the journal where it left off.

## Detached delegation: external CLI → agon → async callback

Primary use case: **Claude Code or Codex hands a long goal to agon, gets control back
immediately, and is notified when Cesar finishes (8-24h later).** A calling agent's turn
cannot stay open that long (context/timeout), so this is fire-and-forget, not a blocking call.

```
caller (claude/codex)  ──▶  agon goal "<task>" --detach        # via /agon shim or `agon call goal`
   returns instantly:  { goalId, status: running, statusCmd: "agon goal status <id>" }
   caller turn ends
        … detached headless process; Cesar drives the gated loop, journaled …
   terminal state  ──▶  write result.json + summary.md  AND  fire callback
```

**Callback is best-effort, multi-channel — never block on caller liveness** (after 8h the
originating session is usually dead; the durable artifact is the source of truth):
- **Always:** `~/.agon/goals/<id>/result.json` + compact `summary.md`. Readable from *any*
  session via `agon goal status <id>` / `agon goal result <id>`.
- **If caller alive:** ping it — `hello-claude` `/msg` to the originating session, or the caller
  polls via `/loop`.
- **Human:** desktop/push notification.

Journal records the caller for routing: `caller: { kind: claude|codex|…, sessionId, channel, startedAt }`.

Extra requirements this imposes:
- **Compact final report:** Cesar summarizes the whole run into a short digest (gaps closed,
  parked, commits, PR link, cost, wall-clock) — not a transcript dump.
- **Recursion guard:** reuse `AGON_CALL_DEPTH` so a detached goal can't spawn goals infinitely.
- **Liveness degradation:** if `caller.channel` is dead at callback time, fall back to artifact +
  human notification; the caller (or a fresh session) reconciles on next `agon goal status`.

## ⚠ Riskiest assumption (brainstorm + 7-engine campfire converged here)

**The success oracle is gameable, and naive hardening protects the wrong surface.** The oracle is
not just the gate command — it is `{ gate cmd + runner config + the acceptance test set + the gap
manifest }`. Hashing only `package.json`/`tsconfig`/gate-string leaves the two surfaces an agent
actually attacks wide open:
- **Tests are part of the oracle.** The agent can `test.skip` / early-return existing assertions,
  or author a *tautological new test* (`expect(true).toBe(true)`) — new test files aren't in any
  hash set — then write the narrowest code that satisfies its own test. Green gate, gutted suite.
- **The gap manifest is part of the oracle.** `.kern-gaps/` defines "done"; if it's mutable the
  agent can "win" by redefining/removing gaps instead of fixing language behavior.
- **Determinism voting doesn't help.** The failure you fear overnight is *deterministic-but-wrong*
  — it passes a double-run quorum identically. Flakiness is a quarantine problem, not a vote.

Everything below treats the gate, the tests, and the manifest as adversarial — and re-measures
acceptance against a **frozen, out-of-tree oracle**, not the working tree.

## Durable state (the journal)

On disk at `~/.agon/goals/<goal-id>/journal.json` — survives crash / restart / context limit.
The loop is a tiny resumable workflow engine, not a `while` loop.

```
{
  goalId, createdAt, branch, gate, budgetUsd, maxHours, maxAttempts,
  spentUsd, startedAt,
  protectedSurface: { paths: [...], allowlist: [...], baselineHashes: {path: sha} },
  noProgressStreak, parkedStreak,            // global breakers
  tasks: [
    { id, source, status: queued|inflight|done|parked|failed|nondeterministic,
      attempts, fingerprints: [ ... ], lastError, commitSha, costUsd, notes }
  ],
  events: [ { ts, taskId, kind, detail } ]   // append-only audit log
}
```

**Oscillation guard (P0 = simple):** park on `same gateFailureSignature twice` OR `no decrease in
remainingGapCount`. The richer behavioral fingerprint
(`{ baseSha, normalizedPatchId, touchedFileSetHash, gateFailureSignature, blockingFindingSignature,
objectiveDelta }`, stop on A→B→A cycles) is **P1** — the campfire judged it over-engineered for a
supervised P0; add it only if logs show thrash the simple signals miss.

## The loop (per task) — transactional, in an isolated worktree

```
while queue not empty and within budget+time and breakers OK:
  t = pop next queued task (respect dependsOn)
  mark inflight; checkpoint journal
  wt = fresh git worktree off the goal branch         # never touch main working tree
  1. IMPLEMENT  — agent/forge produces a diff for t inside wt (ProposePlan DAG + forge fitness)
  2. WITNESS    — for each NEW test in the diff: run vs base SHA -> must FAIL; assert test-set
                  count/filter did not shrink. fail -> park (tautological/coverage-gutting)
  3. GATE       — run ONCE from the frozen out-of-tree oracle (not wt config). red -> rollback
  4. REVIEW     — agon review uncommitted (multi-engine findings JSON)
  5. FIX        — tiered (see rail 7): one fix pass on blocking findings, then re-WITNESS+GATE
  6. COMMIT     — fast-forward wt into goal branch; one commit per task (bisectable)
                  fail at any step -> discard the whole worktree (atomic rollback), attempts++
  checkpoint journal
on stop: open PR (not auto-merge); print summary + parked list
```
*(P1 extras, cut from P0: gate-quorum double-run, behavioral-fingerprint thrash detection,
integrity sentinel every N tasks. The frozen oracle + witnessed tests do the heavy lifting.)*

## Hard rails (the 80% that makes it safe to leave alone)

1. **Frozen out-of-tree oracle (replaces the allowlist entirely), cumulatively grown.** At goal-start,
   snapshot the gate command, runner config, and the acceptance test set into `~/.agon/goals/<id>/oracle/`,
   hash it, and **run the gate from that frozen copy** — never from the working tree's config. The
   agent edits configs/tests in its worktree freely; acceptance is re-measured against frozen authority.
   No per-task allowlist, no escape hatch. **Cumulative freeze (red-team R5):** after a task passes,
   promote its witnessed tests into the frozen set — the oracle grows monotonically so later tasks
   are re-checked against earlier gaps' tests (prevents cross-task regression from going unwitnessed).
2. **Witnessed + mutation-witnessed tests + monotonicity.** Every *new* acceptance test must be
   witnessed (fail on base SHA, pass on new) — but that only proves *diff-sensitivity*, NOT
   *spec-correctness* (red-team R1/R2/R7: the agent writes a witnessed-but-weak test that encodes
   wrong behavior as correct, then lives on the "important-not-blocking" tier). **So add mutation-
   witness:** after the new tests pass on head, the frozen oracle applies canonical mutants to the
   *changed lines only* (`[]→[x]`, `return e→return 0`, `+→-`, `if(c)→if(!c)`…), re-runs the new
   tests; **any surviving mutant → park** (reproducible *blocking* finding in rail 7). This makes
   "encode the answer in the test" self-defeating — a weak test passes on a mutant, so the mutant
   survives. Fully automatic, no per-gap human labor. Plus: test count / filter set may never shrink.
3. **Frozen, append-only objective.** The gap manifest (`.kern-gaps/`) is copied into the frozen
   oracle and is read-only to the loop. "Done" is measured against the frozen manifest so the
   agent cannot win by deleting/redefining gaps.
4. **Transactional rollback + hermetic gate execution.** Each task runs in a throwaway git worktree;
   a failure discards it wholesale (no `git checkout -- .` on a shared tree). **Hermetic execution
   (red-team R3 — a correctness requirement, not just resource hygiene):** the frozen oracle freezes
   the *tests*, but code still runs from the agent's worktree, so the agent can branch on
   `process.env.ORACLE_PATH` / detect it is under the oracle and behave differently. Run the gate with
   scrubbed env, randomized paths, and read-only dep mounts (container/nsjail) so the code cannot tell
   it is being judged. (Also contains host leaks: detached procs, /tmp fill, OOM, API-rate.)
5. **Park, don't grind.** `attempts >= max-attempts`, **same gate-failure signature twice**, or
   no gap-count decrease -> `parked`, continue. **Global breakers:** stop the whole run after K
   consecutive parks or M zero-net-progress tasks (`parkedStreak`/`noProgressStreak`). *(The richer
   5-field behavioral fingerprint is demoted to P1 — these simple signals cover P0.)*
6. **Budgets.** Global `--budget` (usd) and `--max-hours` are hard kills; checkpoint then exit 0
   with a resumable journal.
7. **Tiered review blocking** (pure-block deadlocks on parse failures; pure-annotate ships
   "green but wrong"). **Block** the commit on: reproducible `blocking` findings, frozen-oracle
   violation, or reviewer parse-quorum failure. **Annotate-only** for `important`/`nit` non-reproducible.
   One fix pass, then park — never loop the review. *(Open: review still trusts its own LLM judges;
   P1 adds independent cross-provider reviewers + prompt-injection hardening on task/test output.)*
8. **Push safety.** Dedicated `goal/<name>` branch, never main; one commit per task; PR at end.
9. **Supervised first run.** `--supervised` pauses before the first push so a human eyeballs the
   first few commits, then can `--resume --unsupervised` for overnight.

## What it reuses (already shipped)

- `ProposePlan` — DAG of steps with `dependsOn`/`verifyCmd` (the per-step skeleton).
- `forge` + `finalizeOnScore` — implement-with-fitness, early stop.
- `review` — emits `AGON_REVIEW_FINDINGS_v1` JSON the controller ingests programmatically.
- `agent` (solo + team-in-worktrees + synthesis) — the "do one step" primitive.
- `agon last` + `AgonBash` git — read results, commit, push.

## KERN layout (proposed)

- `packages/forge/src/kern/goal/journal.kern` — state schema + load/checkpoint/resume (`service`).
- `packages/forge/src/kern/goal/controller.kern` — the loop (`service`, `signal`+`cleanup` for abort).
- `packages/forge/src/kern/goal/gate.kern` — run gate, parse pass/fail, auto-revert (`fn`).
- `packages/cli/src/kern/commands/goal.kern` — citty command, journal/queue wiring.

## Open questions (for review)

- ~~Is `lastDiffHash` enough for oscillation?~~ **Resolved: simple signals for P0, fingerprint P1.**
- ~~Should REVIEW block or annotate?~~ **Resolved: tiered blocking (rail 7).**
- ~~`allowlist` ergonomics for legit test/config edits?~~ **Resolved (campfire): no allowlist —
  frozen out-of-tree oracle + adversarially-witnessed tests + test-set monotonicity (rails 1–3).**
1. **Review-layer trust** (zai/minimax/kimi): review is NOT a single LLM — all engines review, Cesar
   adjudicates, and a designated top judge decides (codex now; configurable, or Cesar/user). That
   ensemble+referee blunts "trust one judge." Residual risk: a prompt injection in shared task/test
   output poisons *every* reviewer at once, so ensemble doesn't save you — P1 needs sanitized review
   context + structural (non-LLM) assertion checks, not just more voters.
2. **Host-level isolation** (gemini): worktrees sandbox git, not the host. Ephemeral container per
   cycle for /tmp, processes, OOM, API-rate. P1.
3. Termination oracle for non-gap (fuzzy) goals later — how to make "done" machine-checkable.
4. Team-in-worktrees per task is powerful but expensive — when is solo enough?
5. How to bound context per task so a 24h run never hits a single huge transcript?

## Engine verdicts

- **Brainstorm** (claude/codex/gemini, codex lead @ 0.91): gate is the single point of failure;
  treat it as adversarial. Run: `~/.agon/runs/brainstorm-1779288858244-aw5amk`.
- **Campfire 7/7** (all engines): the *first* hardening protected the wrong surface — tests and the
  gap manifest are part of the oracle and were unprotected; the gate-quorum defends flakiness while
  the real threat is deterministic-but-wrong. Fix: frozen oracle + witnessed tests + monotonic test
  set; cut quorum/fingerprint from P0. Run: `~/.agon/runs/campfire-1779289743853-vwppfm`.
- **Tribunal red-team** (claude defend; codex/gemini/opencode attack): **"Not safe to proceed as-is."**
  Witnessed tests prove diff-sensitivity, not spec-correctness — agent authors a weak-but-witnessed
  test (R1/R2/R7). **Safe to proceed iff:** (1) mutation-witness (rail 2), (2) hermetic gate execution
  (rail 4, R3), (3) cumulative oracle freeze (rail 1, R5). R4 shared-context poisoning accepted as
  residual because mutation-witness blocks mechanically, independent of review quality.
  Run: `~/.agon/runs/tribunal-1779290237150-8leg9h`.

## Phasing

- **P0 (build first) — now gated by the red-team's "safe iff":** queue-driver over frozen `.kern-gaps/`;
  worktree + WITNESS + **mutation-witness** + GATE-once-from-frozen-oracle (**hermetic**) + ensemble
  review + simple park breaker + **cumulative oracle freeze**; supervised, 1-hour cap. Watch it.
  *(Mutation-witness, hermetic exec, and cumulative freeze are NOT deferrable — they are the three
  conditions under which unattended operation is sound.)*
- **P1:** budgets/breakers hardened; AST-normalized + sanitized review context (R4); cross-provider
  judge config; behavioral fingerprint; overnight unsupervised; detached delegation + callback.
- **P2:** general fuzzy-goal decomposer (the research-y part).
