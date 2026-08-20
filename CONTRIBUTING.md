# Contributing to Agon

Thanks for your interest. Agon is a competitive multi-AI orchestration CLI: a
plain TypeScript monorepo (ESM, Node ≥ 22, vitest).

## Issues — welcome

Bug reports and feature ideas are welcome. Please include:
- `agon --version`, your OS, and Node version (`node -v`, must be ≥ 22)
- the exact command + a minimal repro
- `agon doctor` output if it's engine/dispatch related

## Pull requests — open an issue first

Before sending a PR, **open an issue (or comment on one) so we can align on the
approach.** Drive-by PRs that change architecture without discussion will usually
be asked to start as a design conversation. This keeps the orchestration core
coherent.

### Where the source lives

Agon was originally authored in KERN and compiled into a mirror tree. That
authoring layer has been removed and so has the mirror: **the TypeScript under
`packages/*/src/` is the hand-maintained source and you edit it directly.**
There is no compile step and no codegen. A few modules keep a small public
surface beside them — a barrel (`packages/core/src/tools.ts` fronts
`packages/core/src/tools/`) or a facade adding one type or default — so add new
exports where the implementation lives and, if it sits behind one of those,
expose it there too.

```bash
git clone --recurse-submodules https://github.com/KERNlang/agon.git
cd agon && npm install
npm run build            # bundle CLI + emit types
npm run typecheck        # tsc -b
npm run test             # vitest
npm run lint             # eslint (typed, minimal ruleset)
npm run guard:reexports  # re-export surface guard (catches a real runtime bug class)
```

A PR is ready when `build`, `typecheck`, `test`, `lint`, and `guard:reexports`
are all green. If you touched a mode or a CLI command, also run
`npm run docs:modes` and commit the regenerated `docs/modes.md` — a unit test
byte-compares it.

`npm run knip` (alias `npm run lint:dead`) is an **advisory** dead-code probe —
unreferenced files, exports and dependencies. It is deliberately *not* part of
the blocking gate: knip reports false positives on dynamic imports and on
entry points it cannot see, and those should never block an unrelated PR. Run it
before a large refactor or a dead-code sweep, and treat every hit as a lead to
verify by hand rather than a verdict.

## License

By contributing you agree your contributions are licensed under the repository's
MIT license (see `LICENSE`).
