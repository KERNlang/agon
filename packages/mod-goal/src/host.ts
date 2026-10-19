import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { InvocationContext, ModServices } from '@kernlang/agon-mod-api';
import { readWorktreeSource, readWorktreePatch, applyPatchToTree } from '@kernlang/agon-support-worktree';
import type { PullRequestDraft } from '@kernlang/agon-support-worktree';
import { createGoalOracle } from './oracle.js';
import type { GoalOracleEffects, FrozenOracle } from './oracle.js';
import { createGoalJournalStore } from './journal.js';
import type { GoalJournalEffects } from './journal.js';
import type { JournalState } from './journal-types.js';

export interface GoalWorktree {
  readonly repoRoot: string;
  readonly branch: string;
  readonly path: string;
  readonly baseSha: string;
}

/** Persist before accepting a verified candidate; replay after interruption. */
export interface GoalTaskAcceptance {
  readonly baseSha: string;
  readonly basePatch: string;
  readonly patch: string;
  readonly resultPatchHash: string;
  readonly commit?: string;
}

export interface GoalWorktreeEffects {
  createSessionWorktree(options: { repoRoot: string; branch: string; base: string; link: boolean; fresh: boolean }): { path: string };
  findSessionWorktree(repoRoot: string, branch: string): { path: string; branch: string; repoRoot: string } | null;
  worktreePathFor(repoRoot: string, branch: string): string;
  rehydrateSessionWorktree(repoRoot: string, branch: string): boolean;
}

export interface GoalReviewDefaults {
  readonly configuredEngines: readonly string[];
  readonly localEngines: readonly string[];
  readonly judge?: string;
}

export interface GoalImplementationHints {
  readonly flow: string;
  readonly forgeScope: string;
  readonly escalationHint: string;
}

export interface GoalHostServices {
  open(context: InvocationContext): {
    assertCurrent(): void;
    /** Cancellation may record its outcome; a revoked generation may not. */
    assertStateCurrent?(): void;
    readHistoricalState?(id: string): JournalState | null;
    reviewDefaults?(): GoalReviewDefaults;
    implementationHints?(source: string, engines: readonly string[]): GoalImplementationHints;
    acquire(id: string): Promise<{ assertOwned(): Promise<void>; release(): Promise<void> }>;
    openWorktree(branch: string, resumeBase?: string, expectedRepoRoot?: string): GoalWorktree;
    prepareTaskWorktree?(branch: string, baseline: { repoRoot: string; sha: string; patch: string }): GoalWorktree;
    acceptTaskWorktree?(accepted: GoalWorktree, candidate: GoalWorktree, acceptance: GoalTaskAcceptance): void;
    verification?(assertOwned: () => Promise<void>): Pick<ReturnType<typeof createGoalOracle>, 'witnessTest' | 'witnessVerifyCommand'> & {
      snapshotOracle?(options: Parameters<ReturnType<typeof createGoalOracle>['snapshotOracle']>[0]): Promise<FrozenOracle>;
    };
    draftPullRequest?(input: PullRequestDraft, dispatch: (prompt: string) => Promise<string>): Promise<{ ok: boolean; title: string; body: string }>;
    formatPullRequestBody?(body: string): string;
  };
}

export type GoalModServices = ModServices & { readonly goal?: GoalHostServices };

const git = (cwd: string, args: string[]) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

/** Bind durable worktree access to the invocation's captured authority. */
export function createGoalHostServices(options: {
  worktrees: GoalWorktreeEffects;
  oracleEffects?: GoalOracleEffects;
  journalEffects?: GoalJournalEffects;
  captureAuthority(): () => void;
  acquireWriter(id: string): Promise<{ assertOwned(): Promise<void>; release(): Promise<void> }>;
  reviewDefaults?(context: InvocationContext): GoalReviewDefaults;
  implementationHints?(source: string, engines: readonly string[], context: InvocationContext): GoalImplementationHints;
  draftPullRequest?(input: PullRequestDraft, dispatch: (prompt: string) => Promise<string>): Promise<{ ok: boolean; title: string; body: string }>;
  formatPullRequestBody?(body: string, context: InvocationContext): string;
}): GoalHostServices {
  return {
    open(context) {
      const authority = options.captureAuthority();
      const assertCurrent = () => { context.signal.throwIfAborted(); authority(); };
      assertCurrent();
      const host = {
        assertCurrent,
        assertStateCurrent: authority,
        ...(options.journalEffects ? { readHistoricalState: (id: string) => {
          assertCurrent();
          const state = createGoalJournalStore(options.journalEffects!).loadJournal(id);
          assertCurrent();
          if (state && state.spec?.goalId !== id) throw new Error('Historical Goal journal identity does not match the requested id.');
          return state;
        } } : {}),
        ...(options.implementationHints ? { implementationHints: (source: string, engines: readonly string[]) => {
          assertCurrent();
          const hints = options.implementationHints!(source, engines, context);
          assertCurrent();
          return hints;
        } } : {}),
        ...(options.reviewDefaults ? { reviewDefaults: () => {
          assertCurrent();
          const defaults = options.reviewDefaults!(context);
          assertCurrent();
          return defaults;
        } } : {}),
        ...(options.oracleEffects ? { verification: (assertOwned: () => Promise<void>) => {
          const effects = options.oracleEffects!;
          const oracle = createGoalOracle({
            ...effects,
            worktreeCreate: (...args) => { assertCurrent(); return effects.worktreeCreate(...args); },
            spawnWithTimeout: async command => {
              await assertOwned(); assertCurrent();
              const signal = command.signal ? AbortSignal.any([context.signal, command.signal]) : context.signal;
              const result = await effects.spawnWithTimeout({ ...command, signal });
              await assertOwned(); assertCurrent();
              return result;
            },
          });
          return {
            witnessTest: oracle.witnessTest,
            witnessVerifyCommand: oracle.witnessVerifyCommand,
            snapshotOracle: async (input: Parameters<typeof oracle.snapshotOracle>[0]) => {
              await assertOwned(); assertCurrent();
              const snapshot = oracle.snapshotOracle(input);
              await assertOwned(); assertCurrent();
              return snapshot;
            },
          };
        } } : {}),
        ...(options.draftPullRequest ? { draftPullRequest: async (input: PullRequestDraft, dispatch: (prompt: string) => Promise<string>) => {
          assertCurrent();
          const result = await options.draftPullRequest!(input, async prompt => {
            assertCurrent();
            const response = await dispatch(prompt);
            assertCurrent();
            return response;
          });
          assertCurrent();
          return result;
        } } : {}),
        ...(options.formatPullRequestBody ? { formatPullRequestBody: (body: string) => {
          assertCurrent(); return options.formatPullRequestBody!(body, context);
        } } : {}),
        async acquire(id: string) {
          assertCurrent();
          const lease = await options.acquireWriter(id);
          try { assertCurrent(); return lease; }
          catch (error) { await lease.release(); throw error; }
        },
        prepareTaskWorktree(branch: string, baseline: { repoRoot: string; sha: string; patch: string }): GoalWorktree {
          return host.openWorktree(branch, undefined, baseline.repoRoot, baseline);
        },
        acceptTaskWorktree(accepted: GoalWorktree, candidate: GoalWorktree, acceptance: GoalTaskAcceptance): void {
          assertCurrent();
          const target = host.openWorktree(accepted.branch, accepted.baseSha, accepted.repoRoot, undefined, true);
          const source = host.openWorktree(candidate.branch, candidate.baseSha, candidate.repoRoot, undefined, true);
          if (target.path !== accepted.path || source.path !== candidate.path || target.path === source.path) {
            throw new Error('Goal task acceptance worktree identity changed.');
          }
          const hash = (patch: string) => createHash('sha256').update(patch).digest('hex');
          if (hash(readWorktreePatch(source.path, acceptance.baseSha)) !== acceptance.resultPatchHash ||
              readWorktreePatch(source.path, acceptance.baseSha, acceptance.basePatch) !== acceptance.patch ||
              (acceptance.commit && (git(source.path, ['rev-parse', 'HEAD']) !== acceptance.commit ||
                readWorktreePatch(source.path, acceptance.commit) !== ''))) {
            throw new Error('Goal task candidate changed after verification. Retained work was not accepted.');
          }
          const head = git(target.path, ['rev-parse', 'HEAD']);
          const patch = readWorktreePatch(target.path, acceptance.baseSha);
          const finalHead = acceptance.commit ?? acceptance.baseSha;
          if (head === finalHead && hash(patch) === acceptance.resultPatchHash) return;
          const clearedBaseline = !!acceptance.commit && acceptance.basePatch !== '' && patch === '';
          if (head !== acceptance.baseSha || (patch !== acceptance.basePatch && !clearedBaseline)) {
            throw new Error('Accepted Goal work changed while the task was running. Retained work was not overwritten.');
          }
          assertCurrent();
          if (acceptance.commit) {
            // The durable acceptance and candidate commit retain the dirty baseline.
            if (patch) {
              const cleared = applyPatchToTree(target.path, acceptance.basePatch, { reverse: true });
              if (!cleared.ok) throw new Error(`Cannot prepare Goal fast-forward: ${cleared.error}`);
              if (readWorktreePatch(target.path, acceptance.baseSha) !== '') throw new Error('Goal baseline changed during fast-forward preparation.');
            }
            try {
              git(target.path, ['merge', '--ff-only', '--no-edit', '--no-overwrite-ignore', '--', acceptance.commit]);
            } catch (error) {
              if (acceptance.basePatch && git(target.path, ['rev-parse', 'HEAD']) === acceptance.baseSha &&
                  readWorktreePatch(target.path, acceptance.baseSha) === '') {
                const restored = applyPatchToTree(target.path, acceptance.basePatch);
                if (!restored.ok) throw new AggregateError([error, new Error(restored.error)],
                  'Goal fast-forward and baseline restoration failed. Candidate and acceptance journal are retained.');
              }
              throw error;
            }
          } else if (acceptance.patch) {
            const applied = applyPatchToTree(target.path, acceptance.patch);
            if (!applied.ok) throw new Error(`Cannot accept verified Goal task: ${applied.error}`);
          }
          if (git(target.path, ['rev-parse', 'HEAD']) !== finalHead ||
              hash(readWorktreePatch(target.path, acceptance.baseSha)) !== acceptance.resultPatchHash) {
            throw new Error('Goal task acceptance did not reproduce the verified result. Inspect both retained worktrees.');
          }
        },
        openWorktree(branch: string, resumeBase?: string, expectedRepoRoot?: string, initial?: { sha: string; patch: string }, inspectOnly = false): GoalWorktree {
          assertCurrent();
          if (!/^goal\/[a-z0-9._/-]+$/i.test(branch)) throw new Error('Goal requires a goal/* branch.');
          git(context.cwd, ['check-ref-format', '--branch', branch]);
          const source = readWorktreeSource(context.cwd);
          if (expectedRepoRoot && realpathSync(expectedRepoRoot) !== realpathSync(source.repoRoot)) {
            throw new Error('Goal belongs to a different repository; resume from its recorded repository.');
          }
          const baseSha = initial?.sha ?? resumeBase ?? source.baseSha;
          if (!/^[a-f0-9]{40,64}$/i.test(baseSha)) throw new Error('Goal resume base must be a commit hash.');
          git(source.repoRoot, ['cat-file', '-e', `${baseSha}^{commit}`]);
          const effects = options.worktrees;
          const expectedPath = effects.worktreePathFor(source.repoRoot, branch);
          const recorded = effects.findSessionWorktree(source.repoRoot, branch);
          if (inspectOnly && !recorded) throw new Error('Goal task worktree is no longer recorded; refusing acceptance.');
          if (recorded && !resumeBase && !initial) throw new Error(`Goal branch already exists: ${branch}; pass resume=true.`);
          const initialize = (path: string) => {
            if (!initial) return;
            if (git(path, ['rev-parse', 'HEAD']) !== baseSha) {
              throw new Error('Goal task candidate moved from its initialization baseline. Retained work was not changed.');
            }
            const patch = readWorktreePatch(path, baseSha);
            if (patch === initial.patch) return;
            if (patch !== '') throw new Error('Goal task candidate differs from its initialization baseline. Retained work was not changed.');
            assertCurrent();
            const applied = applyPatchToTree(path, initial.patch);
            if (!applied.ok) throw new Error(`Cannot prepare Goal task baseline: ${applied.error}`);
            if (readWorktreePatch(path, baseSha) !== initial.patch) throw new Error('Goal task baseline did not reproduce exactly. Retained work was not changed further.');
          };
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
            initialize(recorded.path);
            if (!inspectOnly && !effects.rehydrateSessionWorktree(source.repoRoot, branch)) throw new Error('Goal worktree disappeared during resume.');
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
          initialize(worktree.path);
          return { repoRoot: source.repoRoot, branch, path: worktree.path, baseSha };
        },
      };
      return host;
    },
  };
}
