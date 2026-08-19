# mutate-tautology fixture

A tiny, dependency-free "repo" for exercising the mutation runner
(`packages/core/src/kern/tools/mutant-runner.kern`).

Two test variants over the same source prove the oracle works in both
directions:

| command                     | what it asserts                | expected mutation result |
|-----------------------------|--------------------------------|--------------------------|
| `node check-real.mjs`       | real values (`add(1,2) === 3`) | every mutant KILLED      |
| `node check-tautology.mjs`  | `true === true`                | every mutant SURVIVES    |
| `node check-loop.mjs`       | `countdown(3) === 3`           | the one `-`→`+` mutant HANGS → timeout → killed |

Nothing here is picked up by the repo's vitest run: the checks are `.mjs`
scripts, never `*.test.ts` (see `vitest.config.ts` include globs). The `.ts`
sources are executed directly by Node's built-in type stripping (Node >= 22.18),
so the fixture needs no build step and no dependencies.
