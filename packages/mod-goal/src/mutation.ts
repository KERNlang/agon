import { writeFileSync } from 'node:fs';
import type { spawnWithTimeout } from '@kernlang/agon-support-engine-runtime';

export interface GoalMutationEffects<Mutant> {
  spawnWithTimeout: typeof spawnWithTimeout;
  resolveWithin(root: string, candidate: string): string;
  applyMutantToSource(source: string, mutant: Mutant): string;
}

/** Use the existing mutant generator and host process effects. */
export function createGoalMutationRunner<Mutant>(effects: GoalMutationEffects<Mutant>) {
  return async function mutationSurvivors(opts: {worktree:string, relFilePath:string, source:string, mutants:Mutant[], testCmd:string, timeout:number}): Promise<Mutant[]> {
    const { worktree, relFilePath, source, mutants, testCmd, timeout } = opts;
    const absPath = effects.resolveWithin(worktree, relFilePath);
    const survivors: Mutant[] = [];
    try {
      for (const mutant of mutants) {
        writeFileSync(absPath, effects.applyMutantToSource(source, mutant));
        const res = await effects.spawnWithTimeout({
          command: '/bin/sh',
          args: ['-c', testCmd],
          cwd: worktree,
          timeout: Math.max(1, timeout) * 1000,
        });
        // exit 0 => tests still passed on mutated (wrong) code => mutant survived.
        if (res.exitCode === 0 && !res.timedOut) survivors.push(mutant);
      }
    } finally {
      writeFileSync(absPath, source);
    }
    return survivors;
  };
}
