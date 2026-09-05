# Installed-product audit and repair ledger

Audit subject: `667317911ce04bae2dbe70946fe7cff937e17ca7` (2026-09-05).
Disposition: **not release-ready**. The earlier 33-gate pressure run did not
exercise these installed-user contracts. Its passing executions are not a
whole-product compatibility verdict. No active installation may be promoted
on the strength of that receipt.

## Findings and clean repair plan

| ID | Finding | Repair boundary and required regression | Status |
| --- | --- | --- | --- |
| A01 | Disabling Think commits a lock rejected on the next boot; re-enable cannot restore filtered records | Build selection from a retained, identity-bound installed inventory, not the previous active subset. Validate lock integrity and resolved closure before committing. Exercise disable → fresh boot → enable → fresh boot, dependencies, stale approval, missing inventory and rollback. | Repaired; 36-mod fresh-bootstrap matrix and installed lifecycle verified |
| A02 | Successful lifecycle mutation subsequently fails the lazy parent generation check | Check authority before dispatch, not after a child has deliberately changed generation. Keep stale-client rejection for new invocations. Exercise the real nested CLI. | Repaired; nested CLI and stale-client regressions verified |
| A03 | Packaged MCP searches nonexistent engine asset paths | Use the shared engine-runtime asset resolver, just as CLI does; test a relocated packaged MCP without repository fallback or credentials. | Repaired; shared resolver test and guarded packaged MCP probe verified |
| A04 | TUI Think emits `input`/numeric flags while its handler expects `problem`/string flags | Normalize each surface into the same validated domain request; test parser → schema → handler, including flags and malformed input. | Repaired; legacy intent shape retained, parser/schema/handler test verified |
| A05 | TUI plan-task is dispatched to existing-plan lookup | Restore task planning/resume semantics through an explicit modular contract, not an unowned legacy bypass. Test new task, inspect, resume, approval and persistence. | Open |
| A06 | Brainstorm silently drops synthesis, calibration, dedup and retry behavior | Extract the actual workflow behind injected capabilities. Compare raw results and engine-call sequences with the frozen legacy oracle; do not substitute a simplified algorithm or maintain two authoritative implementations. | Open |
| A07 | Linux CI lint exhausts V8 memory | Measure typed lint scope and partition work without omitting files/rules. Prove complete coverage and run within CI resources. | Repaired locally; 4 GiB lint passes; Linux CI rerun pending |
| A08 | External folder-mod engine capability delegates to a throwing compatibility stub | Provide a real host engine capability to both CLI and MCP while preserving trust/grant checks. Test granted dispatch, refusal/revocation and error propagation with fixture engines. | Repaired; real worker dispatch and live grant revocation verified |
| A09 | First-party semantic receipts return hashes without persisted records; logging is a no-op | Use durable owner-attributed, redacted receipt/log storage; test retrieval, uniqueness, redaction and write failure. Separate these receipts from run artifacts. | Repaired; shared durable/redacted evidence writer verified |
| A10 | Claimed mutation coverage is not an actual implementation-mutation score | Inject targeted behavioral mutants and require discriminating tests to kill them. Label negative controls separately. | False score claim corrected; actual implementation mutation testing still open |
| A11 | Legacy algorithms remain beside replacement mod implementations | Reconcile every runtime owner and route with the extraction ledger; retain only explicitly owned compatibility adapters with removal tests. | Open |

## Reproduction and positive evidence

The read-only audit packed all 49 target packages and the CLI, then installed
offline in a temporary prefix. Initial CLI startup, engine listing, mod listing
and full-compat setup worked. After approved Think disable, fresh commands
failed with `selected canonical lock does not match the resolved package
closure`. Kernel safe mode successfully restored generation 1 and normal
startup. Packaged MCP separately returned `Engine "codex" not found`, while
packaged CLI recognized Codex. Fixture calls reproduced A04–A06 without calling
providers. A08–A11 were source-traced and must not be represented as completed
end-to-end reproductions.

Original local diagnostics: `/tmp/agon-product-audit-01jLeK/REVIEW.md` and its
adjacent scripts/logs. These ephemeral paths are investigation aids, not
portable release receipts. Permanent regression tests and recorded verification
must replace them before any finding is closed.

CI failure: <https://github.com/KERNlang/agon/actions/runs/33962141678/job/101295755942>
(lint, heap exhaustion, exit 134).

## Re-audit scope

Recheck installed CLI/MCP/TUI dispatch, activation/dependency/profile/restart
sequences, package assets and boundaries, raw workflow parity, persisted state,
trust/grants, recovery, negative controls, performance and CI. Test behavior at
the real composition boundary rather than only isolated legacy helpers.
Every repair requires a failing-before/passing-after regression. Do not weaken
acceptance gates or update clean-subject receipts to describe dirty code.

Native platform qualification, publishing and live-provider coverage remain
separate. Dependency vulnerability auditing requires authorization to disclose
dependency metadata to the registry; the blocked network audit was not bypassed.
No claim of exhaustive security or perfection follows from local green tests.

## Repair contracts

- `first-party-activation.ts` owns selection changes against a qualified
  inventory. `installed-index.json.lockedPackages` retains exact lock identities
  across disable/re-enable. Older generations seed it from their verified
  active lock; missing packages require setup, never an invented identity or
  implicit download. Selection preserves `installation.json` byte-for-byte.
- Activation recomputes the effective package closure from the desired state,
  then validates graph hash, ordering and closure before the commit point.
  An internally self-consistent but incomplete lock is a negative control.
- CLI authority checks run in citty's setup phase, before nested commands.
  A command may complete its own approved generation change; a subsequent
  invocation by a stale host still fails.
- TUI-specific schemas/adapters preserve existing intent fields and convert
  them into the domain handler's request. CLI schemas are not loosened.
- Folder-mod engine calls use an explicit host capability, through existing
  trust/grant wrappers, not a compatibility-tool stub. Bundled and external
  callers share the host engine implementation; external callers retain their
  authority checks and live revocation.
- `mod-observability.ts` owns immutable UUID receipts, owner/content attribution,
  redaction, size limits and log receipts. First-party receipts live under
  `first-party-mod-data/<mod-id>/receipts`; external receipt paths stay compatible.
  No receipt is returned before its write completes.
- Lint discovers the exact file scope using ESLint, then validates every file
  with unchanged rules in isolated workspace processes. Discovery is not a
  passing lint result. No directory/rule exclusion or warning allowance was added.

## Deeper review findings

**A12 — Chrome and Synthesis TUI contracts (repaired).** A census of 89 parsed
samples exposed forbidden `input` on Chrome and missing `prompt`/numeric `swaps`
on Synthesis. Explicit TUI schemas and adapters now preserve legacy intent
shape while delivering the correct domain request. Tests exercise the actual
registered parser, schema and handler with fixture capabilities.

**A13 — Apply-patch is routed as start-Forge (open, blocker).**
`packages/mod-forge/src/implementation.ts`, `intentVariants:0002`, parses
`patchPath`/`force` but registers the Forge task schema and competition handler.
Even an explicit `/apply <patch-path>` is rejected for missing `task`. Fix by
extracting the existing patch-application workflow, including preflight,
current-plan artifact selection, diff preview and human approval. Merely adding
`task` or dropping required validation would execute the wrong operation.

The census also rejects empty `/forge` and `/team-forge` inputs lacking a test
command. Those are incomplete inputs, not by themselves proof of a regression.

**A14 — MCP command failure envelopes (repaired; workflow parity remains separate).** The guarded packaged Brainstorm probe
reaches a deliberately blocked provider dispatch, but emits an ordinary MCP
result containing failed seats instead of an error result. Command-to-tool
adapters currently discard some nonzero exit codes. Establish one consistent
failure projection and test all-failed, partially degraded, cancelled and
successful panels across the generated MCP surface. Do not confuse this
remaining failure-contract bug with the repaired engine asset discovery.

Follow-up after repair commit `7095456a`: the public Mod API now supplies
`commandResultToToolResult` and `CommandExecutionError`. Successful payloads
retain their existing shape; nonzero exits throw a typed error preserving the
exit code, typed failure metadata and diagnostic result. Brainstorm, Campfire,
Tribunal, Nero, Synthesis, Forge, Review and RAG use this common conversion.
Plan, Jobs, Agent and pipeline-orchestration adapters also use this conversion;
pipeline coverage here stops at invalid-input validation and runs no stages.
The generated MCP transport maps that error to `result.isError: true`, not a
successful payload or an internal JSON-RPC error. Internal result diagnostics
are not automatically copied into the wire response.

Regression coverage includes every migrated adapter, an all-failed Brainstorm
panel, a degraded successful panel, actual server wire serialization, successful
falsy payloads, and failure/cancellation exit metadata. The npx qualification now
launches the installed MCP server with provider subprocesses/fetch blocked and
asserts successful RoomList, failed Brainstorm, missing JobStatus, cyclic
ProposePlan, and unknown-tool protocol behavior. This checks the actual packed
API/error-class boundary, not only source imports.

**A17 — Array schema constraints rejected (repaired).** The packed ProposePlan
probe exposed that the shared validator rejected the owner's `minItems` keyword
before invoking the handler. It now enforces nonnegative safe-integer
`minItems`/`maxItems`, inclusive limits and per-item validation. Seven negative
and boundary tests pass. Unknown keywords remain rejected; the Plan constraint
was not removed or weakened.

**A18 — MCP cancellation signal disconnected (repaired at the generated
transport boundary).** Dynamic calls now own per-request controllers, forward
their signals to the generated invocation context, accept matching cancellation
notifications and suppress cancelled replies. Numeric/string IDs stay distinct;
unknown cancellation is ignored; duplicate in-flight IDs cannot overwrite the
controller; transport close aborts active controllers. Tests cover cancellation
before dispatch and cancellation of one concurrent request without cancelling
the other. This follows the server's advertised
[2024-11-05 MCP cancellation contract](https://modelcontextprotocol.io/specification/2024-11-05/basic/utilities/cancellation).
This is cooperative cancellation, not a claim that every engine immediately
terminates or that kernel write-tool cancellation has been implemented.

Updated verification: full suite **5,958 passed, five existing skips**, 492 files;
installed npx **69 checks**; build, kernel rebuild, typecheck, lint, re-export,
pack-content and local SBOM checks pass. Full-run log SHA-256:
`fa134847548762e02df861902f2cfbd8599f7e760d450380d2a95b2e4aaf6cbb`.
Installed-run log SHA-256:
`4dc4f3278ab9cb7329ca0b88eca6d32ce2f4677c5c23f3bac74c298883ca5095`.
These development checks do not supersede release acceptance receipts or close
the Plan/Apply/Brainstorm behavioral parity, extraction or mutation findings.

**A15 — Intermittent daemon survival test (unresolved observation).** One
unsandboxed full run returned no pong; the isolated three-test daemon suite and
subsequent full runs passed. No root cause was established and no timeout was
raised. Retain this observation for load/repetition tests; it is not evidence
that the flake was fixed. Earlier EPERM socket/watch failures were environmental
and were rerun with local permissions, without skips.

## Remaining clean implementation order

**A16 — Serve readiness/shutdown race (repaired; regression suite passing).**
The latest combined run had 5,923 passing tests, five skips and one failure:
`serve-command.test.ts` received a null process exit code after SIGINT rather
than zero. Source inspection found that `runServe` published its connection
before registering signal handlers. A deterministic regression emits SIGINT
at publication and fails before the fix. Shutdown handlers now precede the
ready line; concurrent abort/signal requests share one disposal, synchronous
stop errors enter the existing error path, and the abort listener is removed.
The four browser delegation tests, package compilation and targeted lint pass.
This establishes the readiness defect, not proof that it explains every
previous daemon flake. The rebuilt full suite subsequently passed: 5,925 tests,
five existing skips, 488 files. Build, typecheck, lint and re-export checks pass.
The diagnostic launch guard initially misclassified harmless argument strings;
it was corrected to inspect executables, without changing application tests.
Guarded full-run log SHA-256:
`65f6a2fc54cdd578739d2b5ead488bec225ee732944b0d1c11838adff793f7d4`.

During this run the operator reported unexpected OpenAI login tabs. Their
origin was not established. Subsequent narrow tests block child processes
(except the exact local esbuild service) and fetch, using fixture browser
services; no browser or provider authentication is needed by those tests.

1. **Plan session boundary (A05/A11):** extract plan state transitions and
   execution ownership into the plan package. Give the UI an explicit event,
   approval and session bridge; do not pass the whole CLI callback/context
   object into mods. Preserve new-task planning, in-session selection, explicit
   resume, approval, cancellation, retry and self-review gates. A typed,
   owner-tagged temporary adapter may bridge the old session implementation,
   but must have a removal test and must not be mistaken for completed extraction.
2. **Brainstorm workflow owner (A06/A11):** move the actual preflight → seat/retry
   → calibration/ranking → dedup → ratings → synthesis workflow behind injected
   host capabilities. Replace legacy exports with a narrow compatibility adapter
   to that one implementation. Preserve raw result fields, event order, degraded
   panels, cancellation and synthesis fallback. Use deterministic fixture engines
   to compare old/new raw outputs and dispatch sequences before retiring the owner.
3. **Apply and MCP effects (A13/A14):** separate patch application from competition
   and standardize error projection without hiding failures or bypassing approval.
4. **Acceptance truth (A10/A11):** inject actual implementation mutants, reconcile
   remaining legacy owners, then run raw workflow parity through installed surfaces.
   Existing legacy-only tests cannot close these findings.

## Verification recorded during this repair batch

- All 36 first-party mods: durable disable/re-enable, fresh surface bootstrap,
  identity retention and disabled-owner rejection across CLI/TUI/MCP/Cesar/docs.
  This is registration/activation coverage, not execution of all 36 workflows.
- Installed npx test: **68 checks**, including cache deletion, Think lifecycle,
  fresh process startup, disabled rejection and preserved idempotent setup.
- Full suite before the new 36-case matrix: **5,888 passed, 5 existing skips**,
  487 test files. Matrix separately passes all 36 cases.
- Typecheck and re-export guard pass. Typed lint passes under a 4 GiB heap;
  the latest recorded scope before the matrix file was 1,300 files/55 partitions.
- Rebuilt package BOM/channel and matching local SBOM; these are artifact
  metadata, not an assertion of completed release qualification or publication.
- Packaged MCP resolves Codex and reaches dispatch with process/network effects
  deliberately blocked by a probe preload. No live provider or credentials used.
- Regression tests were observed failing before their corresponding repairs.
  Existing Think intent assertions were retained; an initial incompatible parser
  change was corrected by an adapter, not by relaxing those assertions.

Local logs for this batch: `/tmp/agon-product-repair-6JKB0sFB/`. They are development
diagnostics, not clean committed release receipts. This is an incremental repair
batch, not a release acceptance receipt. No active/global installation or personal-state changes were
intentionally performed; absence of indirect authentication side effects has
not been independently established. The PR is
still **not release-ready** because the open behavior and acceptance findings
above remain locally actionable.
