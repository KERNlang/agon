import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runReviewCore } from '../../packages/cli/src/generated/handlers/review.js';

// Regression: a goal task's review MUST run the review engine in the per-task
// worktree, not the dir agon was launched from. runReviewCore used to hardcode
// cwd = resolveWorkingDir() (= process.cwd()), so during `agon goal --cwd <X>`
// the review engines ran in — and agentic exec engines wrote scratch/fix files
// into — the PARENT repo, invisible to the goal pipeline (which only diffs the
// worktree). cwdOverride pins the dispatch cwd to the worktree.

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

const VALID_FINDINGS = '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```';

function fakeCtx(record: { cwd?: string }) {
  return {
    config: { reviewFileContext: false },
    registry: { get: () => ({ id: 'fake', name: 'fake' }) },
    adapter: {
      // no dispatchStream → runReviewCore takes the plain dispatch branch
      dispatch: async (opts: { cwd?: string }) => {
        record.cwd = opts.cwd;
        return {
          stdout: `looks fine\n${VALID_FINDINGS}`,
          exitCode: 0,
          usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120, source: 'cli-reported' },
        };
      },
    },
  } as any;
}

const diff = 'diff --git a/AGON_GOAL_SMOKE.md b/AGON_GOAL_SMOKE.md\n@@ -0,0 +1 @@\n+smoke';

describe('runReviewCore cwd isolation', () => {
  it('dispatches the review engine in the cwdOverride (goal worktree), not process.cwd()', async () => {
    dir = mkdtempSync(join(tmpdir(), 'agon-wt-'));
    const record: { cwd?: string } = {};
    await runReviewCore(diff, 'goal task', 'fake', fakeCtx(record), undefined, undefined, dir);
    expect(record.cwd).toBe(dir);
    expect(record.cwd).not.toBe(process.cwd());
  });

  it('falls back to the working dir when no cwdOverride is given (interactive/CLI review)', async () => {
    const record: { cwd?: string } = {};
    await runReviewCore(diff, 'interactive review', 'fake', fakeCtx(record));
    // Not the override path — resolves to the active workspace / process.cwd().
    expect(record.cwd).toBeTruthy();
  });

  // Regression: the dispatch's token usage must be surfaced so the goal
  // controller can meter the WHOLE review panel into --budget (not just
  // implement + judge).
  it('surfaces the dispatch token usage on the result', async () => {
    dir = mkdtempSync(join(tmpdir(), 'agon-wt-'));
    const result = await runReviewCore(diff, 'goal task', 'fake', fakeCtx({}), undefined, undefined, dir);
    expect(result.usage?.totalTokens).toBe(120);
  });
});
