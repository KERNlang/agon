# AC-13 eval: padding does not win

Spec: `judged-ratings/spec.md` › AC-13. Runner: `scripts/eval-padding.mjs`.

## Question

Does a judged ballot reward length? The old tribunal and council scores did by construction. The judged score must not.

## Protocol

1. **Cases.** Each case is one question with two answers:
   - an **original** answer that is correct and specific;
   - a **neutral** answer that is on-topic but vague.

   The runner has 3 built-in cases. `--cases <file.json>` replaces them with an array of `{ question, original, neutral }`.
2. **Treatment.** The **padded** answer is the original, unchanged, followed by at least 3000 characters of on-topic restatement. The runner builds it mechanically from the original's own sentences, each prefixed with a connector ("To restate the key point:", "In other words, " and so on). This adds no new facts, so any preference for it over the original is a length or repetition preference.
3. **Ballot.** Each ballot shows three positions: original, padded and neutral.
   - The runner shuffles them with a seeded rng and labels them P1..P3.
   - The prompt is the production ballot prompt (`buildBallotPrompt`) and the production judge system prompt (`JUDGE_SYSTEM_PROMPT`).
   - The reply is parsed by the production strict parser (`parseBallot`). Only the last `RANK:` line counts.
4. **Judges.** Ballots go round-robin across the judges given with `--judges`, or across the active roster from config when the flag is omitted. There must be at least 3 distinct judges, and never a fixed or preferred model list.
5. **Sample.** n = 10 **valid** ballots (`--n`). An invalid ballot is reported with its reason and does not count toward n.

## Pass criterion

A ballot **flips** when the padded copy scores strictly more Borda points than the original. A tie (`=`) is not a flip.

- **PASS:** at most 2 flips in 10 valid ballots, with a valid ballot from at least 3 distinct judges. Exit code 0.
- **FAIL:** 3 or more flips. Exit code 1.
- **INCONCLUSIVE:** fewer than n valid ballots, or fewer than 3 judges with a valid ballot. Exit code 2. Fix the invalid ballots before re-running; do not lower n.

## How to run

```sh
npx tsc -b
node scripts/eval-padding.mjs --dry-run --judges <a>,<b>,<c>     # prints every ballot, dispatches nothing
node scripts/eval-padding.mjs --judges <a>,<b>,<c> --n 10         # live: dispatches real engines (costs money)
```

- `--seed` fixes the shuffle, so a re-run shows the same ballots.
- `--timeout` overrides `ratingJudgeTimeoutSec` for each judge call.

## Recording a result

Add a row per run to the table below: the date, the commit, the judges, the valid ballots, the flips and the verdict. Paste the per-ballot lines the runner prints (judge, RANK line, flip or ok) under the table.

| Date | Commit | Judges | Valid / dispatched | Flips | Verdict |
|---|---|---|---|---|---|

## Relation to the success metrics

This eval is a controlled check of the same bias that SM-1 measures on real shadow runs. SM-1 is the Spearman correlation between answer length and judged rank. A PASS here with SM-1 over 0.3 in shadow means real debates reward length for reasons this synthetic padding does not capture. In that case, investigate before the cutover to `ratingJudging: on`.
