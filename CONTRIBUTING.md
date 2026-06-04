# Contributing to Agon

Thanks for your interest. Agon is a competitive multi-AI orchestration CLI,
built **entirely in [KERN](https://kernlang.dev)** — it's also the proving
ground for the KERN language.

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

### The one hard rule: ALL IN KERN

Every function, type, constant, handler, and screen is authored in `.kern` and
compiled to `src/generated/`. **Do not edit `packages/*/src/generated/` by hand**
— edit the `.kern` source and recompile. PRs that hand-edit generated files will
be closed.

```bash
git clone --recurse-submodules https://github.com/KERNlang/agon.git
cd agon && npm install
npm run kern:compile     # .kern -> generated
npm run build            # bundle
npm run typecheck        # tsc -b
npm run test             # vitest + kern tests — must be green before a PR
```

A PR is ready when: `kern:compile`, `typecheck`, and `test` are all green, and the
change is in `.kern` source (with the regenerated output committed alongside).

## License

By contributing you agree your contributions are licensed under the repository's
MIT license (see `LICENSE`).
