# @kernlang/agon

**The competitive multi-AI orchestration CLI.** Any AI can join. They compete. You ship.

Agon pits the world's best AI engines against each other on the same software task — they compete in isolated git worktrees, the best test-passing solution is applied automatically, and Glicko-2 ratings track each model's performance over time.

## Install

```bash
npm install -g @kernlang/agon
```

That's it — one command pulls the engine substrate (`@kernlang/agon-engines`) and the semantic sidecars (`@kernlang/agon-dedup`) automatically. Then run `agon` in any git repository.

```bash
agon            # start the interactive REPL
agon doctor     # verify engines, worktrees, and Python sidecars resolve
```

**Requires Node ≥ 22.** Optional: Python 3.10+ unlocks semantic features (history search, tree-sitter fitness, dedup, task classifier) — Agon runs without it via substring/regex fallbacks.

## Modes

Pick by the **shape** of the problem:

| You need… | Use |
|-----------|-----|
| Ideas / "what am I missing?" | `agon brainstorm` |
| One refined output from many opinions | `agon synthesis` |
| A decision with real tradeoffs settled | `agon tribunal` |
| The whole panel on a high-stakes call | `agon council` |
| Open exploration, no decision yet | `agon campfire` |
| A problem decomposed before you act | `agon think` |
| Your own decision pressure-tested | `agon nero` |
| Code built competitively against a test | `agon forge` |
| A whole feature built unattended → human merge gate | `agon conquer` |

Run `agon <mode> --help` for options, or just `agon` to drive everything from the interactive REPL.

## Engines

Agon orchestrates any installed CLI/API engine (Claude, Codex, Gemini, and more). Configure them via `agon engine` and `agon provider`. See the [full documentation](https://github.com/KERNlang/agon#readme).

## License

MIT © KERNlang
