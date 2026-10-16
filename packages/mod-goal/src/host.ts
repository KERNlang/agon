import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { InvocationContext, ModServices } from '@kernlang/agon-mod-api';
import { readWorktreeSource } from '@kernlang/agon-support-worktree';

export interface GoalWorktree {
  readonly repoRoot: string;
  readonly branch: string;
  readonly path: string;
  readonly baseSha: string;
}

export interface GoalWorktreeEffects {
  createSessionWorktree(options: { repoRoot: string; branch: string; base: string; link: boolean; fresh: boolean }): { path: string };
  findSessionWorktree(repoRoot: string, branch: string): { path: string; branch: string; repoRoot: string } | null;
  worktreePathFor(repoRoot: string, branch: string): string;
  rehydrateSessionWorktree(repoRoot: string, branch: string): boolean;
}

export interface GoalHostServices {
  open(context: InvocationContext): {
    assertCurrent(): void;
    acquire(id: string): Promise<{ assertOwned(): Promise<void>; release(): Promise<void> }>;
    openWorktree(branch: string, resumeBase?: string, expectedRepoRoot?: string): GoalWorktree;
  };
}

export type GoalModServices = ModServices & { readonly goal?: GoalHostServices };

const git = (cwd: string, args: string[]) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

/** Bind durable worktree access to the invocation's captured authority. */
export function createGoalHostServices(options: {
  worktrees: GoalWorktreeEffects;
  captureAuthority(): () => void;
  acquireWriter(id: string): Promise<{ assertOwned(): Promise<void>; release(): Promise<void> }>;
}): GoalHostServices {
  return {
    open(context) {
      const authority = options.captureAuthority();
      const assertCurrent = () => { context.signal.throwIfAborted(); authority(); };
      assertCurrent();
      return {
        assertCurrent,
        async acquire(id) {
          assertCurrent();
          const lease = await options.acquireWriter(id);
          try { assertCurrent(); return lease; }
          catch (error) { await lease.release(); throw error; }
        },
        openWorktree(branch, resumeBase, expectedRepoRoot) {
          assertCurrent();
          if (!/^goal\/[a-z0-9._/-]+$/i.test(branch)) throw new Error('Goal requires a goal/* branch.');
          git(context.cwd, ['check-ref-format', '--branch', branch]);
          const source = readWorktreeSource(context.cwd);
          if (expectedRepoRoot && realpathSync(expectedRepoRoot) !== realpathSync(source.repoRoot)) {
            throw new Error('Goal belongs to a different repository; resume from its recorded repository.');
          }
          const baseSha = resumeBase ?? source.baseSha;
          if (!/^[a-f0-9]{40,64}$/i.test(baseSha)) throw new Error('Goal resume base must be a commit hash.');
          git(source.repoRoot, ['cat-file', '-e', `${baseSha}^{commit}`]);
          const effects = options.worktrees;
          const expectedPath = effects.worktreePathFor(source.repoRoot, branch);
          const recorded = effects.findSessionWorktree(source.repoRoot, branch);
          if (recorded && !resumeBase) throw new Error(`Goal branch already exists: ${branch}; pass resume=true.`);
          if (recorded) {
            if (resolve(recorded.path) !== resolve(expectedPath) || recorded.branch !== branch ||
                realpathSync(recorded.repoRoot) !== realpathSync(source.repoRoot)) {
              throw new Error('Goal worktree identity does not match its recorded repository and branch.');
            }
            const commonDir = (cwd: string) => realpathSync(git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
            if (commonDir(recorded.path) !== commonDir(source.repoRoot) ||
                git(recorded.path, ['symbolic-ref', '--short', 'HEAD']) !== branch) {
              throw new Error('Goal worktree Git identity changed; refusing resume.');
            }
            // Verify ancestry before overlays or execution can modify retained work.
            git(recorded.path, ['merge-base', '--is-ancestor', baseSha, 'HEAD']);
            assertCurrent();
            if (!effects.rehydrateSessionWorktree(source.repoRoot, branch)) throw new Error('Goal worktree disappeared during resume.');
            return { repoRoot: source.repoRoot, branch, path: recorded.path, baseSha };
          }
          if (resumeBase) {
            // Old Goal runs retained a branch but removed their temporary worktree.
            git(source.repoRoot, ['show-ref', '--verify', `refs/heads/${branch}`]);
            git(source.repoRoot, ['merge-base', '--is-ancestor', baseSha, `refs/heads/${branch}`]);
          }
          assertCurrent();
          const worktree = effects.createSessionWorktree({ repoRoot: source.repoRoot, branch,
            base: baseSha, link: true, fresh: !resumeBase });
          return { repoRoot: source.repoRoot, branch, path: worktree.path, baseSha };
        },
      };
    },
  };
}
