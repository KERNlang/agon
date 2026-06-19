<!-- GENERATED — do not edit. Source: packages/cli/src/kern/commands/agent-guide-text.kern (agentGuideMarkdown). Regenerate: npm run docs:modes -->

# Agon modes — what exists and when to use what

# How to call Agon

Agon orchestrates multiple AI engines. Call it from your shell with your normal Bash/exec tool — there is no MCP and nothing to load.
Run it inside the git repo you are working on.

## Modes
- `agon forge "<task>" -t "<test cmd>"` — engines race to implement the task; the test command picks the winner. Use when a runnable test/check exists and there are multiple valid approaches.
- `agon synthesis "<prompt>" [-s <swaps>] [-j <judge>]` — engines draft, then swap and improve on the other drafts; a judge picks the best evolved artifact. Use when you want one polished result that blends the best ideas and no clean pass/fail test exists.
- `agon brainstorm "<question>"` — engines bid confidence, the most confident answers. Cheap second opinion.
- `agon tribunal "<question>" [--mode adversarial|steelman|socratic|red-team|synthesis|postmortem]` — structured multi-engine debate. Use for decisions with real tradeoffs.
- `agon council "<decision>" [--roles "r1,r2,..."] [--chairman <id>] [--engines ...]` — a roundtable of ALL active engines, each in a distinct role (Contrarian = the top-rated critic, plus First-Principles, Red-Team, Outsider, Expansionist), chaired by the top-rated engine. The chair frames a decision brief, advisors respond and run an O(N) directed peer critique, then the chair returns ONE verdict with a confidence and a KILL-SWITCH (what evidence would reverse it). Use for a high-stakes / hard-to-reverse decision where you want the whole panel and named roles, not just a 2-side debate. Scales to the engine count; needs >= 2 engines.
- `agon campfire "<topic>"` — open multi-engine discussion, no winner. For exploration.
- `agon think "<problem>" [--strategy linear|reflexion] [--steps N] [--branches N]` — sequential thinking: decompose a problem into structured thoughts (reflexion forces a self-critique+revision per step; --branches explores alternatives), surface open questions, and emit a refined spec to hand to `agon goal`. Use to think before acting, or for engines with weak built-in reasoning.
- `agon nero "<decision>" [--reasoning "<why>"] [--focus "<concern>"] [--confidence N]` — adversarial self-challenge. The top-rated CRITIC (picked by tribunal-discipline rating, not the best builder) attacks your decision with concrete failure scenarios and returns a verdict (FLAWED | PROCEED WITH CAUTION | SOUND) plus its own confidence the original is correct. Use this INSTEAD of an internal evil-twin / devil's-advocate pass — it gives you a real second model, not your own reasoning mirrored.
- `agon research "<question>" [--count N] [--engine <id>]` — keyless, web-grounded, CITED research. Agon (not the model) discovers sources via first-party endpoints that need NO API key — npm registry, GitHub repo search, MDN, IETF/RFC datatracker, Stack Overflow, Wikipedia — WebFetches them, an engine drafts an answer grounded ONLY in that content with inline [n] citations, and Agon then re-fetches and VERIFIES every citation (rejecting dead/redirected/mismatched URLs). Use it to look up a library/repo/spec/Q&A/encyclopedic fact and get an answer with sources you can trust. A truly-general web query (no keyless lane) reports that rather than guessing.
- `agon review <uncommitted|branch:NAME|commit:SHA>` — non-interactive multi-engine code review.
- `agon goal "<intent>" --queue <dir|.jsonl> --gate "<test cmd>"` — autonomous controller: drives a task queue to completion unattended, looping build -> witness -> gate -> review (panel + judge) -> fix -> commit per task on a goal/ branch. Bound it with `--max-hours`/`--budget`; `--push` pushes each task. Long-running (designed for 8-24h).
- `agon conquer "<task>" --gate "<test cmd>"` — supervised-autonomous BUILD of an OPEN-ENDED task. Cesar drives a pluggable builder CLI (codex/claude/agy) in agent mode turn by turn; when the builder hits a fork it asks and Cesar convenes the cheapest sufficient consult (nero/tribunal/brainstorm/council) and feeds back a compact verdict; when it claims done, a layered done-oracle runs (the `--gate` command + diff acceptance-drift + a nero falsification round) and it STOPS at a HUMAN merge gate — it never auto-merges to main. The open-ended sibling to `goal`: use `conquer` when you CANNOT write a clean discriminating oracle up front (build a whole tool), `goal` when you can. `--push` needs a clean tree; bound it with `--max-turns`/`--max-hours`.

## Collaborate with other agents — rooms
Agon hosts shared chat ROOMS so multiple live CLIs (you, other Codex/Claude/agy sessions, agon engines) coordinate over one persistent transcript. Human-mediated: you post when prompted, and read what others said. Use a room to hand off work, ask another agent for help, or coordinate parallel work in the same repo.
- `agon room join <room> --as <callsign> --engine <codex|claude|agy>` — join a room (creates it if new)
- `agon room post <room> --as <callsign> -m "message"` — post a message; use `@callsign` to mention someone (a positional message also works)
- `agon room read <room> [--since <seq>] [--json]` — read the shared transcript
- `agon room read <room> --unread --as <callsign> [--json]` — ONLY what you have not seen yet, then advances your read cursor (`--peek` to look without advancing). RUN THIS AT THE START OF EVERY TURN so you never work a stale board.
- `agon room tail <room> [--json]` — follow the room live (Ctrl+C to leave)
- `agon room who <room> [--json]` — who is present, each member's unread/mention counts, and the resource lock table
- `agon room lock <room> -r <resource> --as <callsign> [--ttl <min>]` — claim a file/branch/task before working it so two agents never collide; `--steal` takes over an EXPIRED lock (audited, @mentions the stale holder)
- `agon room release <room> -r <resource> --as <callsign>` — ALWAYS release when done; posting while holding an expired lock warns you
- `agon room leave <room> --as <callsign>` — leave (clears your presence immediately)
- `agon room auto <room> --as <callsign> --engine <id> [--open-floor] [--max-turns N] [--max-minutes N] [--until-human]` — AUTONOMOUS: watch the room and auto-reply on your turn until a stop condition. Safe by default: mention-only, ≤3 turns / 10 min, one-poster-at-a-time turn lease, and a ping-pong halt if two auto-agents loop. Use `--dry-run` to test the loop without spending tokens.

## Setting up forge & goal — the test/gate IS the spec
These two modes only optimize to make your test (`-t` for forge) or gate/verify (for goal) pass. That command IS the specification — not the prose task. A check that a wrong implementation can still pass will ship a wrong implementation, and often dead-loops the run. Before launching:
- Discriminate: every check must FAIL a plausibly-wrong impl, not just pass the intended one. Use distinct/edge args (atan2(3,4) not atan2(0,1); `5.5 % 2` to catch int() truncation; cbrt(-27) to reject pow(x,1/3), since pow returns NaN on a negative base).
- RED at base: confirm the test fails on the current code for the RIGHT reason before the run, and turns green only when the task is genuinely done.
- Coverage over tolerance: add enough cases that wrong variants die on their own; never loosen a gate or tolerance to force a pass.
- Red-team your own oracle first: run `agon nero "<the test/gate I wrote>" --reasoning "is this gameable?"`, or hand one engine the test + signature and ask it to write a subtly-wrong impl that still passes. If it can, the oracle has a hole — add a killer case and repeat until it cannot.
- goal only: pre-flight with `--dryRun`; each queued task verify must be RED-at-base for the right reason while `--gate` is green at base; keep mutation scoped to the verify (match `--witnessCmd` to the same narrow command). Add `--oracle-gate=warn|strict` to AUTOMATE the red-team: before forging, the panel tries to make each verify PASS with a cheating impl; strict refuses to launch if any verify is gameable, so a non-discriminating oracle is caught up front instead of dead-looping the run.

## Common flags
- `--engines claude,codex,agy` — limit which engines compete
- `--timeout <sec>` — per-engine timeout

## Machine-readable output
The direct `agon <mode>` commands stream human output. For JSONL lifecycle + output chunks, use the bridge form `agon call <mode> "<input>" [flags] --jsonl`, e.g. `agon call forge "<task>" -t "<test>" --jsonl`.

## Read the result
- `agon last` — prints the most recent run directory
- `cat "$(agon last)/summary.json"` — scores for the last run
- `agon last --status` — status.json of the last run

## Pick a mode
- multiple valid approaches + a test  -> forge
- want one blended artifact, no test  -> synthesis
- a decision with tradeoffs           -> tribunal
- high-stakes decision, whole panel   -> council
- need ideas / unsure                 -> brainstorm
- explore, no decision needed         -> campfire
- think before acting / decompose     -> think
- pressure-test your own decision     -> nero
- judge existing code                 -> review
- drive a whole task queue to done    -> goal
- build a whole open-ended thing       -> conquer

Escalation ladder for decisions — pick the CHEAPEST rung that fits the stakes: `nero` (one adversary attacks your decision) -> `tribunal` (two-sided debate) -> `council` (whole panel in roles + a chair) -> `conquer` (a whole supervised build, not one decision).

Run `agon <mode> --help` for the full flag list.
