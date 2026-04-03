# Task A — Bug Hardening (15 Runtime Bugs)

Fix each bug, run tests after each fix, commit granularly.

## Critical

1. **Silent catch blocks** — Dozens of bare `catch {}` blocks swallow errors across the codebase. Every catch must log the error.
2. **Output directory race condition** — `writeFileSync(outputPath, result.stdout)` with no directory existence check. Add `mkdirSync(dir, { recursive: true })` before writes.
3. **No generator cleanup on stream errors** — If streaming handler throws mid-stream, child process keeps running. No abort signal sent. Add cleanup and abort.
4. **Hardcoded `/tmp` in César handler** — Breaks on non-unix, no unique naming, shared between concurrent runs. Use `os.tmpdir()` + unique names.
5. **Wildcard path construction fragile** — Path join with no existence check. If wrong, registry starts empty silently. Add existence check and warn.

## Medium

6. **Missing null checks** — Chat handler, workspace state, and plan storage lack null checks.
7. **Process kill errors swallowed** — Kill failures are silently caught. Log them.
8. **`readJsonSafe` silent fallback** — Returns null on parse error, falls back to defaults with no warning. Log a warning on parse failure.
9. **Scheduling blocks on slow engines** — One slow engine timeout blocks the whole flow. Add per-engine timeout isolation.
10. **Patch undo not atomic** — If `writeFileSync` for inverse patch fails after `git apply` success, undo is impossible. Write to temp file first, then rename.

## Low

11. **Config corruption silent** — Corrupted JSON falls back to defaults with no user warning.
12. **Empty response appended** — Chat messages appended even when response is empty or errored.
13. **No atomic writes for state files** — State files can corrupt on crash.
14. **Engine discovery failure silent** — If engine discovery fails, user sees nothing.
15. **Stream errors not surfaced** — Stream errors not properly surfaced in git error output.
