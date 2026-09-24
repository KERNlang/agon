# Repeatable modular regression and pressure tests

Run from this checkout with Python 3.11+, Node 22+, npm, Git and tar:

```sh
python3 scripts/spec/test_pressure_runner.py
python3 scripts/spec/pressure_modular.py --cache /path/to/populated/npm-cache
```

The default `full` profile runs three independently shuffled test orders (seeds
1701–1703). Use `--repeat 10 --seed 4200` for a longer order-sensitivity run.
`--profile pressure` omits the full repository, distribution and performance
gates; its pass is **not** a full-profile pass. `--timeout 1800` sets the maximum
seconds for each gate. Tests retain their own smaller assertion timeouts.
Run where localhost sockets and filesystem notifications are permitted; a
restrictive agent sandbox can deny these operations and produce a red result.
The runner uses a short `/tmp/agon-pressure-*` root deliberately: nesting the
daemon fixtures under macOS's long default TMPDIR exceeded Unix socket path
limits in the first isolated run. This is covered by a runner regression test.

## What gets tested

- Exact committed HEAD, extracted into a new temporary checkout; ignored build
  output and uncommitted changes are not inputs. A receipt explicitly records
  whether working changes were excluded. To test new implementation code, commit
  it on its isolated branch first. Nothing is committed by the runner.
- Offline clean install and workspace build.
- Actual SIGKILL of a candidate host writer at nine transaction boundaries,
  followed by recovery in a fresh process and a successful new write. Each
  recovered pointer is checked against both the expected generation and graph
  hash. An opposite-generation negative control must fail at every boundary.
- Generated-surface drift, disabled-mod checks and foundation mutation checks.
- All `tests/unit/modular-*.test.ts` files, freshly executed in shuffled orders.
- The test files named in the historical 160-test workflow capture, freshly
  executed in shuffled orders. These include fixtures/mocks and pure logic;
  they are not 160 live-provider calls. The existing
  `test:representative-workflows` command separately validates archived evidence
  integrity. **An archived passing report is not a fresh workflow run.**
  The shared test setup also disables live forge health checks and the Kern
  context integration; passing fixtures do not qualify those live paths.
- Full profile additionally runs typecheck, lint, re-export guard, the complete
  TypeScript test suite, release contents, supply-chain checks, folder-mod CLI
  checks, isolated npm setup, state migrations, physical cutover and eight
  performance gates.

## Isolation and evidence

The runner does not call global `agon`. It supplies fresh HOME, AGON_HOME, XDG
paths, npm configs/cache/prefix and temporary directory. Environment variables
use an allowlist, excluding provider credentials and personal Agon overrides.
The supplied npm cache's content-addressed data is **copied**, never used in
place. Cache logs and npm configuration are not copied. Allow disk space for
the cache, clean dependencies, generated packs and retained test fixtures.

This is configuration isolation, **not an OS sandbox**. Trusted repository
tests can still execute code and access host resources; do not run an untrusted
branch with this tool. It does not prove live authentication, model quality or
every native platform combination. Those require separately authorized runs.
No live model orchestration or Multi-AI Build Pipeline is started.

Each run prints a new temporary evidence directory. It contains:

- `receipt.json`: commit/tree identity, archive and harness hashes, exact plan,
  completed gates, exit codes, durations, log hashes, status and exclusions;
- one full combined output log per gate;
- isolated checkout, runtime and fixtures for diagnosis.

Receipts are written atomically after each gate. Failure stops the run; later
gates remain unexecuted, not green. Timeout kills the subprocess group. Ctrl+C
retains an interrupted receipt; SIGTERM/host death may leave status `running`,
which is also not a pass. Empty and partial runs cannot pass. Full log files are
retained rather than reduced to a tail. Treat logs as private: fixture output
can contain data even though personal credential variables are excluded.

No automatic cleanup, promotion, installation to the active prefix, push or
release certification occurs. Copy the evidence directory somewhere durable
if needed; the OS may eventually remove temporary files.

A pass means the listed gates passed for that committed subject and platform.
It does not mean “perfect,” nor does it replace subject-bound independent
review and the release platform/publication matrix.

## Recorded run — 2026-09-05

Verified on macOS arm64 with Node 26.3.0, against committed subject
`f149d8b94d8d5df2377f2e06b3c4cef73491963a` (tree
`1378d3c9cfce742ced4031ba1d45945289711c85`). The new uncommitted harness is
identified separately by its content hash; this run does not claim those new
files were part of the committed product subject.

- Full profile: **33/33 gates passed**, 392.47 seconds of measured gate time
  (cache-copy/setup time is additional).
- Real process death: nine SIGKILL boundaries, nine opposite-generation
  negative controls, recovery and subsequent writes passed.
- Shuffled regression: 371 modular assertions and 160 fresh workflow fixture
  assertions passed for each of seeds 1701, 1702 and 1703.
- Full repository suite: 481 test files passed, 5,877 assertions passed,
  **five skipped**. Skips occurred in diagnostic-runner, tui-probe-tool and
  agy-probe-e2e; no claim of live-provider completeness is made.
- Folder-mod CLI: 31 checks. npm setup: 59 checks, 15-package
  minimal+think+review closure, idempotent setup and surviving ephemeral cache
  deletion. This does not establish all possible install-profile combinations.
- All eight performance scripts, typecheck, lint, re-export guard, release
  contents, supply chain, migrations and cutover checks passed.
- Runner self-tests: seven passed separately; helper script ESLint passed.

Local raw evidence: `/tmp/agon-pressure-e3c6b23d/receipt.json` and its sibling
logs. Every stored log hash was independently recomputed after the run.

```text
receipt sha256: 4fc708db6c2b39d509edb7ceb264f5ef69bc0b43488af211217763275b3f00b1
runner sha256: 0e1b1ca186b37a1b7281272c58237bbf4de6de49ca6755688b771122bbd41a28
process-death helper sha256: b96cbc3d04df6abc438e42530731df53638437504a6bf041d463b2002bc1feff
```

Earlier red runs are retained separately, not overwritten: a duplicate npm
config path, a wrong helper import, sandbox-denied sockets/watchers, and
overlong daemon fixture socket paths were encountered while developing the
harness. One shutdown-signal assertion also failed in the long-path full run;
it passed in the short-path focused check and final full run. Its exact cause
was not established, so do not interpret this as proof that shutdown is
flake-free. No product source was changed to make these tests pass.

Active/global Agon was not installed, updated or replaced. No push or commit
was performed. This is local regression evidence, not new release acceptance
or independent architectural/security review.
