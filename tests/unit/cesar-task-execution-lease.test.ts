import { describe, expect, it } from 'vitest';
import {
  approveTaskAction,
  authorizeTaskAction,
  buildTaskActionTarget,
  canonicalTaskActionSignature,
  claimTaskActionPrompt,
  createTaskExecutionLease,
  evaluateTaskAction,
  isDestructiveCommand,
  isDestructiveTaskAction,
  normalizeDestructiveCommand,
  userAuthorizationProse,
  isShellWorkspaceEscape,
  isTaskFileMutationAction,
  isExternalSideEffectCommand,
  isApprovedPermissionResponse,
  relativePathEscapesWorkspace,
  shellMutationEscapesWorkspace,
  taskExplicitlyAuthorizes,
  taskExplicitlyRequestsAction,
  taskActionApprovalMessage,
  DEFAULT_DESTRUCTIVE_PATTERN,
} from '../../packages/cli/src/generated/cesar/task-execution-lease.js';

describe('Cesar task execution lease', () => {
  it('labels each boundary accurately', () => {
    const manual = createTaskExecutionLease('create the homepage', false, '/repo');
    const routineWrite = evaluateTaskAction(manual, 'Write', '/repo/app/page.tsx');
    expect(routineWrite).toMatchObject({ decision: 'ask_boundary_once', reason: 'auto_off' });
    expect(taskActionApprovalMessage(routineWrite)).toBe('AUTO is off for this task — approve this action once');

    // CC-parity contract: an "important" prompt word (auth/session/permission)
    // no longer produces a prompt at all, so there is no important-task label
    // left to render from a live evaluation — only from a legacy one.
    const important = createTaskExecutionLease('change auth permissions', true, '/repo');
    expect(evaluateTaskAction(important, 'Edit', '/repo/auth.ts')).toMatchObject({ decision: 'allow', reason: 'routine_auto' });
    expect(taskActionApprovalMessage({ decision: 'ask_task_once', signature: 'edit:/repo/auth.ts', reason: 'important_task' }))
      .toBe('Approve this important task once');

    const destructive = createTaskExecutionLease('finish the task', true, '/repo');
    expect(taskActionApprovalMessage(evaluateTaskAction(destructive, 'Bash', 'git push --force origin main')))
      .toBe('Approve this destructive action boundary');
    expect(taskActionApprovalMessage(evaluateTaskAction(destructive, 'Bash', 'printf ok > ../outside.txt')))
      .toBe('This action leaves the workspace — approve it once');
    expect(taskActionApprovalMessage({ decision: 'ask_boundary_once', signature: 'edit:.env', reason: 'sensitive_path' }))
      .toBe('This file is sensitive (secrets, keys, or git hooks) — approve this edit once');
  });

  it('matches the destructive class and nothing broader', () => {
    // The seatbelt that survives mode auto. Plain publishing/deploying is NOT
    // in it — that is exactly what the CC-parity change opened up.
    for (const command of [
      'git push --force origin main', 'git push -f origin x', 'git push --force-with-lease',
      'git push origin --delete old', 'git push origin :main', 'git push origin +main', 'git push --mirror origin',
      'git reset --hard HEAD~1', 'git clean -fd', 'rm -rf node_modules', 'rm -fr dist', 'rm -r -f dist',
      'rm --recursive --force build', 'dropdb agon', 'psql -c "drop database agon"',
      'npx prisma migrate reset', 'npm run db:reset', 'prisma db push --force',
    ]) {
      expect(isDestructiveCommand(command), command).toBe(true);
    }
    for (const command of [
      'git push origin main', 'git push -u origin feature/x', 'git push --set-upstream origin main',
      'git push --follow-tags origin main', 'git push origin HEAD:main', 'git reset --soft HEAD~1',
      'git clean -n', 'rm file.txt', 'rm -r dir', 'npm publish', 'npm run release',
      'curl -X POST https://example.com/deploy', 'npm run build', '',
    ]) {
      expect(isDestructiveCommand(command), command).toBe(false);
    }
    // Policy is config-tunable, and a broken override falls back to the
    // default instead of prompting on every command.
    expect(isDestructiveCommand('helm uninstall prod', '\\bhelm\\s+uninstall\\b')).toBe(true);
    expect(isDestructiveCommand('rm -rf node_modules', '\\bhelm\\s+uninstall\\b')).toBe(false);
    expect(isDestructiveCommand('rm -rf node_modules', '([unclosed')).toBe(true);
    expect(DEFAULT_DESTRUCTIVE_PATTERN.length).toBeGreaterThan(0);
  });

  // Security: equivalent spellings of the SAME destructive operation must not
  // classify as routine just because the pattern was written against one
  // spelling. The command is normalized (git global flags stripped, long flags
  // folded into their short letters) and matched raw + normalized.
  it('classifies every equivalent spelling of a destructive command', () => {
    for (const command of [
      // remote branch deletion, short flag
      'git push -d origin feature/x', 'git push -qd origin feature/x',
      // git clean with the long flag
      'git clean --force', 'git clean --force -d', 'git clean -d --force',
      // git global options in front of the subcommand
      'git -C /tmp/repo push --force origin main',
      'git --git-dir=/tmp/other/hooks push --force origin main',
      'git --git-dir /tmp/other push --force origin main',
      'git -c user.name=x push --force origin main',
      'git --no-pager -C /tmp/repo push --force origin main',
      'git -C /tmp/repo clean --force',
      'git -C /tmp/repo reset --hard HEAD~1',
      'git --work-tree=/tmp/wt -C /tmp/repo push -d origin feature/x',
      // mixed / long rm flag spellings, either order
      'rm --recursive --force /tmp/x', 'rm --force --recursive /tmp/x',
      'rm -r --force /tmp/x', 'rm --force -r /tmp/x',
      'rm --recursive -f /tmp/x', 'rm -f --recursive /tmp/x',
      // still classified inside a compound command
      'npm test && git -C /tmp/repo push --force origin main',
    ]) {
      expect(isDestructiveCommand(command), command).toBe(true);
    }
    // Near misses that must stay routine — normalization must not over-match.
    for (const command of [
      'git cleanup', 'git cleanup --force', 'firm -rf x', 'confirm -rf x',
      'git push --dry-run origin main', 'git push --no-verify origin main',
      'git -C /tmp/repo push origin main', 'git -C /tmp/repo status',
      'git clean --dry-run', 'git clean -n -d',
      'rm -r dir', 'rm --recursive dir', 'rm -i dir', 'rm --interactive --dir dir',
      'git reset --soft HEAD~1', 'git -C /tmp/repo reset --soft HEAD~1',
      'find . -name node_modules -type d', 'echo "rm --force"',
    ]) {
      expect(isDestructiveCommand(command), command).toBe(false);
    }
    // The normalizer is a matching probe only, and is idempotent-ish enough
    // that an already-canonical command is left recognizable.
    expect(normalizeDestructiveCommand('git -C /tmp/repo push --force origin main'))
      .toBe('git push -f --force origin main');
    expect(normalizeDestructiveCommand('rm --force -r /tmp/x')).toBe('rm -fr --force /tmp/x');
    expect(normalizeDestructiveCommand('')).toBe('');
  });

  // VULN-1: the explicit-authorization scan reads the turn text as authority,
  // so PASTED content (fenced block, diff, quoted file) must be stripped first.
  it('never reads pasted content as the user authorizing a destructive command', () => {
    const fenced = createTaskExecutionLease(
      'here is the failing script, tell me what it does\n```sh\ngit push --force origin feature/x\n```',
      true, '/repo');
    expect(taskExplicitlyAuthorizes(fenced, 'Bash', 'git push --force origin feature/x')).toBe(false);
    expect(evaluateTaskAction(fenced, 'Bash', 'git push --force origin feature/x'))
      .toMatchObject({ decision: 'ask_boundary_once', reason: 'destructive_boundary' });

    const tilde = createTaskExecutionLease(
      'review this\n~~~\nforce push branch feature/x to origin\n~~~', true, '/repo');
    expect(taskExplicitlyAuthorizes(tilde, 'Bash', 'git push --force origin feature/x')).toBe(false);

    const unterminated = createTaskExecutionLease(
      'what is wrong here?\n```\nforce push branch feature/x to origin', true, '/repo');
    expect(taskExplicitlyAuthorizes(unterminated, 'Bash', 'git push --force origin feature/x')).toBe(false);

    const quoted = createTaskExecutionLease(
      'the runbook says:\n> force push branch feature/x to origin\nis that safe?', true, '/repo');
    expect(taskExplicitlyAuthorizes(quoted, 'Bash', 'git push --force origin feature/x')).toBe(false);

    const diff = createTaskExecutionLease(
      ['explain this patch', 'diff --git a/deploy.sh b/deploy.sh', 'index 1234567..89abcde 100644',
        '--- a/deploy.sh', '+++ b/deploy.sh', '@@ -1,2 +1,3 @@', ' set -e',
        '+force push branch feature/x to origin', '-echo done'].join('\n'),
      true, '/repo');
    expect(taskExplicitlyAuthorizes(diff, 'Bash', 'git push --force origin feature/x')).toBe(false);

    const headerlessDiff = createTaskExecutionLease(
      'what changed?\n+force push branch feature/x to origin\n-echo done', true, '/repo');
    expect(taskExplicitlyAuthorizes(headerlessDiff, 'Bash', 'git push --force origin feature/x')).toBe(false);

    const indented = createTaskExecutionLease(
      'the script does this:\n\n    git push --force origin feature/x\n\nwhat happens?', true, '/repo');
    expect(taskExplicitlyAuthorizes(indented, 'Bash', 'git push --force origin feature/x')).toBe(false);

    const goalInPaste = createTaskExecutionLease('summarize this\n```\nuse conquer to rebuild the recap\n```', true, '/repo');
    expect(taskExplicitlyRequestsAction(goalInPaste, 'conquer')).toBe(false);

    // The legitimate cases keep working: the user's own prose still authorizes,
    // including inline code spans and a markdown bullet list (NOT a diff line).
    const literal = createTaskExecutionLease('run git push --force origin feature/x', true, '/repo');
    expect(evaluateTaskAction(literal, 'Bash', 'git push --force origin feature/x'))
      .toMatchObject({ decision: 'allow', reason: 'explicit_authority' });
    const inlineSpan = createTaskExecutionLease('please run `git push --force origin feature/x` now', true, '/repo');
    expect(evaluateTaskAction(inlineSpan, 'Bash', 'git push --force origin feature/x').decision).toBe('allow');
    const bullet = createTaskExecutionLease('do these:\n- force push branch feature/x to origin\n- run the tests', true, '/repo');
    expect(evaluateTaskAction(bullet, 'Bash', 'git push --force origin feature/x').decision).toBe('allow');
    const afterFence = createTaskExecutionLease(
      'context:\n```\nsome log output\n```\nforce push branch feature/x to origin', true, '/repo');
    expect(evaluateTaskAction(afterFence, 'Bash', 'git push --force origin feature/x').decision).toBe('allow');
    const horizontalRule = createTaskExecutionLease(
      'context\n---\nforce push branch feature/x to origin', true, '/repo');
    expect(evaluateTaskAction(horizontalRule, 'Bash', 'git push --force origin feature/x').decision).toBe('allow');

    // Token matching stays word-boundary: a substring never authorizes.
    for (const prose of ['pushing branch feature/x to origin', 'pushover branch feature/x to origin', 'repush branch feature/x to origin']) {
      const lease = createTaskExecutionLease(`force ${prose}`, true, '/repo');
      expect(taskExplicitlyAuthorizes(lease, 'Bash', 'git push --force origin feature/x'), prose).toBe(false);
    }
    expect(userAuthorizationProse('plain single line')).toBe('plain single line');
  });

  // VULN-4: a resolver-stage ask (it alone knows about sensitive paths) must
  // survive the lease's re-derivation instead of being downgraded to allow.
  it('never downgrades a mandatory resolver ask to an allow', () => {
    const lease = createTaskExecutionLease('tidy the repo', true, '/repo');
    const options = { mandatoryAsk: true, mandatoryAskReason: 'sensitive_path' };
    expect(evaluateTaskAction(lease, 'Edit', '/repo/.git/hooks/pre-commit', options))
      .toMatchObject({ decision: 'ask_boundary_once', reason: 'sensitive_path' });
    // A recorded approval still wins (prompt coalescing must keep working).
    approveTaskAction(lease, 'Edit', '/repo/.git/hooks/pre-commit');
    expect(evaluateTaskAction(lease, 'Edit', '/repo/.git/hooks/pre-commit', options))
      .toMatchObject({ decision: 'allow', reason: 'boundary_approved' });
    // A hard deny still outranks it, and the more specific destructive reason
    // is preferred over the generic resolver reason.
    expect(evaluateTaskAction(lease, 'Edit', '/repo/x.ts', { ...options, hardDeny: true }).decision).toBe('deny');
    expect(evaluateTaskAction(lease, 'Bash', 'git push --force origin main', options))
      .toMatchObject({ decision: 'ask_boundary_once', reason: 'destructive_boundary' });
    // Without the flag the same action is the plain routine_auto allow the
    // vulnerability rode in on.
    const fresh = createTaskExecutionLease('tidy the repo', true, '/repo');
    expect(evaluateTaskAction(fresh, 'Edit', '/repo/.git/hooks/pre-commit'))
      .toMatchObject({ decision: 'allow', reason: 'routine_auto' });
  });

  it('classifies destructive actions per tool kind, exempting file mutations', () => {
    const lease = createTaskExecutionLease('do the work', true, '/repo');
    expect(isDestructiveTaskAction(lease, 'Bash', 'git push --force origin main')).toBe(true);
    expect(isDestructiveTaskAction(lease, 'AgonBash', 'rm -rf /tmp/cache')).toBe(true);
    // The `push` pseudo-action is normalized back to the shell form.
    expect(isDestructiveTaskAction(lease, 'push', 'origin +main')).toBe(true);
    expect(isDestructiveTaskAction(lease, 'push', 'origin feature/x')).toBe(false);
    // File mutations are exempt by construction — containment is enforced
    // separately, which is what lets auto-edit approve contained edits.
    expect(isDestructiveTaskAction(lease, 'Edit', '/repo/scripts/rm -rf.sh')).toBe(false);
    expect(isShellWorkspaceEscape(lease, 'Bash', 'printf ok > ../outside.txt')).toBe(true);
    expect(isShellWorkspaceEscape(lease, 'Bash', 'printf ok > notes.txt')).toBe(false);
    expect(isShellWorkspaceEscape(lease, 'Edit', '../outside.txt')).toBe(false);
  });

  it('treats explicitly naming Goal or Conquer as the authority boundary despite target paraphrasing', () => {
    const conquer = createTaskExecutionLease('use conquer to fix the recap', true, '/repo');
    expect(taskExplicitlyRequestsAction(conquer, 'conquer')).toBe(true);
    expect(taskExplicitlyAuthorizes(conquer, 'conquer', 'repair this terminal summary cleanly')).toBe(false);

    const implicit = createTaskExecutionLease('fix the recap automatically', true, '/repo');
    expect(taskExplicitlyAuthorizes(implicit, 'conquer', 'fix the recap')).toBe(false);

    const substringOnly = createTaskExecutionLease('do not forget the release notes', true, '/repo');
    expect(taskExplicitlyRequestsAction(substringOnly, 'forge')).toBe(false);
    const explicitForge = createTaskExecutionLease('use forge for the release notes', true, '/repo');
    expect(taskExplicitlyRequestsAction(explicitForge, 'forge')).toBe(true);
  });

  it('binds delegation side effects into the authority target', () => {
    const lease = createTaskExecutionLease('launch goal for finish task', true, '/repo');
    const target = buildTaskActionTarget(lease, 'finish task', {
      queue: '/outside/tasks', gate: 'npm test', push: true, pr: true,
    });
    expect(target).toContain('external queue /outside/tasks');
    expect(target).toContain('gate npm test');
    expect(target).toContain('push');
    expect(target).toContain('pull request');
    // The target still binds every authority-widening field (audit trail), but
    // in AUTO a plain push/PR/external-queue delegation now runs without a
    // prompt (CC bypassPermissions parity). Goal/Conquer keep their own
    // explicit-user-request gate in escalation.ts.
    expect(evaluateTaskAction(lease, 'goal', target).decision).toBe('allow');
  });

  it('lets delegation targets auto-run in AUTO unless they carry a destructive command', () => {
    const lease = createTaskExecutionLease('fix the recap automatically', true, '/repo');
    for (const action of ['Forge', 'Agent', 'Pipeline']) {
      expect(evaluateTaskAction(lease, action, 'fix recap\npush\npull request').decision).toBe('allow');
      expect(evaluateTaskAction(lease, action, 'fix recap\nexternal queue /outside/tasks').decision).toBe('allow');
      expect(evaluateTaskAction(lease, action, 'fix recap\ngate rm -rf /tmp/cache'))
        .toMatchObject({ decision: 'ask_boundary_once', reason: 'destructive_boundary' });
    }
    // A source filename alone must not turn an ordinary edit into a boundary.
    expect(evaluateTaskAction(lease, 'Edit', '/repo/release.ts').decision).toBe('allow');
  });

  it('allows a routine AUTO implementation without per-tool prompts', () => {
    const lease = createTaskExecutionLease('fix the recap and run tests', true, '/repo');
    for (const [action, target] of [['Edit', '/repo/a.ts'], ['Write', '/repo/b.ts'], ['Bash', 'npm test'], ['Forge', 'recap fix']] as const) {
      expect(evaluateTaskAction(lease, action, target)).toEqual({ decision: 'allow', signature: expect.any(String), reason: 'routine_auto' });
    }
  });

  it('does not prompt merely because an agentic AUTO task is important', () => {
    const lease = createTaskExecutionLease('change the auth session contract', true, '/repo', undefined, 'agentic');
    expect(lease.risk).toBe('important');
    expect(evaluateTaskAction(lease, 'Edit', '/repo/auth.ts')).toMatchObject({
      decision: 'allow', reason: 'routine_auto',
    });
  });

  it('still classifies external side effects (leaseless backstop) but no longer prompts for them in AUTO', () => {
    // The classifier is unchanged — it is what isLeaselessBashBoundary uses for
    // delegated/background seams that carry no lease.
    expect(isExternalSideEffectCommand('curl https://example.com/status')).toBe(false);
    expect(isExternalSideEffectCommand('curl -X POST https://example.com/deploy')).toBe(true);
    expect(isExternalSideEffectCommand('git push origin main')).toBe(true);

    // Inside a lease with AUTO on, an external side effect is NOT a boundary
    // any more (CC bypassPermissions parity); only the destructive class is.
    const lease = createTaskExecutionLease('inspect and fix the local code', true, '/repo', undefined, 'agentic');
    expect(evaluateTaskAction(lease, 'Bash', 'curl https://example.com/status').decision).toBe('allow');
    expect(evaluateTaskAction(lease, 'Bash', 'curl -X POST https://example.com/deploy').decision).toBe('allow');
    expect(evaluateTaskAction(lease, 'Bash', 'npm publish').decision).toBe('allow');
    expect(evaluateTaskAction(lease, 'Bash', 'git push origin main').decision).toBe('allow');
  });

  it('fences shell writes outside the workspace without misclassifying ordinary release files', () => {
    const lease = createTaskExecutionLease('finish the implementation', true, '/repo', undefined, 'agentic');
    expect(shellMutationEscapesWorkspace(lease, 'rm /tmp/outside.txt')).toBe(true);
    expect(shellMutationEscapesWorkspace(lease, 'printf ok > ../outside.txt')).toBe(true);
    expect(shellMutationEscapesWorkspace(lease, 'rm src/generated.ts')).toBe(false);
    expect(evaluateTaskAction(lease, 'Edit', '/repo/release.ts').decision).toBe('allow');
    expect(evaluateTaskAction(lease, 'Bash', 'printf ok > ../outside.txt').decision).toBe('ask_boundary_once');
  });

  it('never asks merely because the task text is important, in either harness profile', () => {
    // Retired `important_task` prompt: mode auto is CC bypassPermissions, and a
    // prompt that mentions auth/session/database is not a boundary.
    for (const profile of ['legacy', 'agentic'] as const) {
      const lease = createTaskExecutionLease('change the auth session contract and the database migration', true, '/repo', undefined, profile);
      expect(lease.risk).toBe('important');
      expect(evaluateTaskAction(lease, 'Edit', '/repo/auth.ts')).toMatchObject({ decision: 'allow', reason: 'routine_auto' });
      expect(evaluateTaskAction(lease, 'Write', '/repo/auth.test.ts')).toMatchObject({ decision: 'allow', reason: 'routine_auto' });
      expect(evaluateTaskAction(lease, 'Bash', 'npm test')).toMatchObject({ decision: 'allow', reason: 'routine_auto' });
    }
  });

  it('prompts once per destructive signature and remembers the approval', () => {
    const lease = createTaskExecutionLease('clean up the branches', true, '/repo');
    const first = evaluateTaskAction(lease, 'Bash', 'git push --force origin main');
    expect(first).toMatchObject({ decision: 'ask_boundary_once', reason: 'destructive_boundary' });
    expect(claimTaskActionPrompt(lease, first.signature)).toBe(true);
    expect(claimTaskActionPrompt(lease, first.signature)).toBe(false);
    approveTaskAction(lease, 'Bash', 'git push --force origin main');
    expect(evaluateTaskAction(lease, 'Bash', 'git push --force origin main')).toMatchObject({ decision: 'allow', reason: 'boundary_approved' });
    // A different destructive command is a different signature.
    expect(evaluateTaskAction(lease, 'Bash', 'git push --force origin release').decision).toBe('ask_boundary_once');
  });

  it('joins concurrent duplicate approval requests to one user decision', async () => {
    const lease = createTaskExecutionLease('clean up the remote branches', true, '/repo');
    let resolveApproval!: (approved: boolean) => void;
    let prompts = 0;
    const requestApproval = () => {
      prompts += 1;
      return new Promise<boolean>((resolve) => { resolveApproval = resolve; });
    };

    const first = authorizeTaskAction(lease, 'Bash', 'git push --delete origin old', requestApproval);
    const duplicate = authorizeTaskAction(lease, 'Bash', 'git push --delete origin old', requestApproval);
    resolveApproval(true);

    await expect(first).resolves.toMatchObject({ decision: 'allow' });
    await expect(duplicate).resolves.toMatchObject({ decision: 'allow' });
    expect(prompts).toBe(1);
  });

  it('runs plain pushes/publishes without a prompt in AUTO regardless of explicit authority', () => {
    // Retired broad `dangerous_boundary`: CC bypassPermissions parity means a
    // plain push no longer needs the prompt text to have authorized it.
    const implicit = createTaskExecutionLease('finish the release work', true, '/repo');
    expect(evaluateTaskAction(implicit, 'Edit', '/repo/release.ts').decision).toBe('allow');
    expect(evaluateTaskAction(implicit, 'Forge', 'finish the implementation').decision).toBe('allow');
    expect(evaluateTaskAction(implicit, 'push', 'origin feature/x').decision).toBe('allow');
    expect(evaluateTaskAction(implicit, 'push', 'origin main').decision).toBe('allow');
    expect(evaluateTaskAction(implicit, 'Bash', 'git push origin main').decision).toBe('allow');
    expect(evaluateTaskAction(implicit, 'AgonBash', 'git push -u origin feature/x').decision).toBe('allow');
    expect(evaluateTaskAction(implicit, 'Bash', 'git push --set-upstream origin feature/x').decision).toBe('allow');
    expect(evaluateTaskAction(implicit, 'Bash', 'git push --tags origin').decision).toBe('allow');
    expect(evaluateTaskAction(implicit, 'Bash', 'npm publish').decision).toBe('allow');
    expect(evaluateTaskAction(implicit, 'Bash', 'gh release create v1.0.0').decision).toBe('allow');
    expect(evaluateTaskAction(implicit, 'Bash', 'npm run deploy:prod').decision).toBe('allow');
    // A push branch named like the verb or a one-character remote is now moot —
    // nothing about a plain push is gated any more.
    expect(evaluateTaskAction(implicit, 'Bash', 'git push origin push').decision).toBe('allow');
    expect(evaluateTaskAction(implicit, 'Bash', 'git push o x').decision).toBe('allow');
    // AUTO off keeps asking once per action, as before.
    const manual = createTaskExecutionLease('push branch feature/x to origin', false, '/repo');
    expect(evaluateTaskAction(manual, 'Bash', 'git push origin feature/x'))
      .toMatchObject({ decision: 'ask_boundary_once', reason: 'auto_off' });
  });

  it('requires a destructive boundary once unless action and target were explicit', () => {
    const implicit = createTaskExecutionLease('finish the release work', true, '/repo');
    expect(evaluateTaskAction(implicit, 'push', 'origin +main'))
      .toMatchObject({ decision: 'ask_boundary_once', reason: 'destructive_boundary' });
    approveTaskAction(implicit, 'push', 'origin +main');
    expect(evaluateTaskAction(implicit, 'push', 'origin +main').decision).toBe('allow');
    expect(evaluateTaskAction(implicit, 'push', 'origin :main').decision).toBe('ask_boundary_once');

    const explicit = createTaskExecutionLease('push branch feature/x to origin', true, '/repo');
    expect(evaluateTaskAction(explicit, 'Bash', 'git push --force origin feature/x').decision).toBe('ask_boundary_once');
    expect(evaluateTaskAction(explicit, 'Bash', 'git push -f origin feature/x').decision).toBe('ask_boundary_once');

    const explicitForce = createTaskExecutionLease('force push branch feature/x to origin', true, '/repo');
    expect(evaluateTaskAction(explicitForce, 'Bash', 'git push --force origin feature/x'))
      .toMatchObject({ decision: 'allow', reason: 'explicit_authority' });
    expect(evaluateTaskAction(explicitForce, 'Bash', 'git push -f origin feature/x').decision).toBe('allow');

    const unrelated = createTaskExecutionLease('fix the recap', true, '/repo');
    expect(evaluateTaskAction(unrelated, 'AgonBash', 'git push --force origin feature/x').decision).toBe('ask_boundary_once');

    const oneCharacterScope = createTaskExecutionLease('force push branch x to remote o', true, '/repo');
    expect(evaluateTaskAction(oneCharacterScope, 'Bash', 'git push --force o x').decision).toBe('allow');
    const missingOneCharacterRef = createTaskExecutionLease('force push to remote o', true, '/repo');
    expect(evaluateTaskAction(missingOneCharacterRef, 'Bash', 'git push --force o x').decision).toBe('ask_boundary_once');

    const branchNamedPush = createTaskExecutionLease('force push branch push to origin', true, '/repo');
    expect(evaluateTaskAction(branchNamedPush, 'Bash', 'git push --force origin push').decision).toBe('allow');
    const missingPushBranch = createTaskExecutionLease('force push to origin', true, '/repo');
    expect(evaluateTaskAction(missingPushBranch, 'Bash', 'git push --force origin push').decision).toBe('ask_boundary_once');

    const normalMain = createTaskExecutionLease('push branch main to origin', true, '/repo');
    expect(evaluateTaskAction(normalMain, 'Bash', 'git push origin +main').decision).toBe('ask_boundary_once');
    expect(evaluateTaskAction(normalMain, 'Bash', 'git push origin :main').decision).toBe('ask_boundary_once');
    expect(evaluateTaskAction(normalMain, 'push', 'origin +main').decision).toBe('ask_boundary_once');
    expect(evaluateTaskAction(normalMain, 'push', 'origin :main').decision).toBe('ask_boundary_once');
    const forceRefspec = createTaskExecutionLease('force push branch main to origin', true, '/repo');
    expect(evaluateTaskAction(forceRefspec, 'Bash', 'git push origin +main').decision).toBe('allow');
    expect(evaluateTaskAction(forceRefspec, 'push', 'origin +main').decision).toBe('allow');
    const deleteRefspec = createTaskExecutionLease('push delete branch main from origin', true, '/repo');
    expect(evaluateTaskAction(deleteRefspec, 'Bash', 'git push origin :main').decision).toBe('allow');
    expect(evaluateTaskAction(deleteRefspec, 'push', 'origin :main').decision).toBe('allow');

    const literalForceFlag = createTaskExecutionLease('git push -f origin feature/x', true, '/repo');
    expect(evaluateTaskAction(literalForceFlag, 'Bash', 'git push -f origin feature/x').decision).toBe('allow');
    const hyphenatedForce = createTaskExecutionLease('force-push branch feature/x to origin', true, '/repo');
    expect(evaluateTaskAction(hyphenatedForce, 'Bash', 'git push --force origin feature/x').decision).toBe('allow');

    // With AUTO off a destructive command still reports the destructive reason
    // (not the generic auto_off) so no blunt allow source can absorb it — and
    // explicit prompt authority does not apply when AUTO is off.
    const manualForce = createTaskExecutionLease('force push branch feature/x to origin', false, '/repo');
    expect(evaluateTaskAction(manualForce, 'Bash', 'git push --force origin feature/x'))
      .toMatchObject({ decision: 'ask_boundary_once', reason: 'destructive_boundary' });

    const negated = createTaskExecutionLease("don't force push branch feature/x to origin", true, '/repo');
    expect(evaluateTaskAction(negated, 'Bash', 'git push --force origin feature/x').decision).toBe('ask_boundary_once');

    const noForce = createTaskExecutionLease("push branch feature/x to origin but don't force push", true, '/repo');
    expect(evaluateTaskAction(noForce, 'Bash', 'git push origin feature/x').decision).toBe('allow');
    expect(evaluateTaskAction(noForce, 'Bash', 'git push --force origin feature/x').decision).toBe('ask_boundary_once');

    const oneCharacterTarget = createTaskExecutionLease('use goal to finish the release', true, '/repo');
    expect(evaluateTaskAction(oneCharacterTarget, 'goal', 'x').decision).toBe('allow');

    const excludedMain = createTaskExecutionLease('force push branch feature/x to origin; do not touch main', true, '/repo');
    expect(evaluateTaskAction(excludedMain, 'Bash', 'git push --force origin feature/x').decision).toBe('allow');
    expect(evaluateTaskAction(excludedMain, 'Bash', 'git push --force origin main').decision).toBe('ask_boundary_once');
    const exceptMain = createTaskExecutionLease('force push branch feature/x to origin except main', true, '/repo');
    expect(evaluateTaskAction(exceptMain, 'Bash', 'git push --force origin feature/x').decision).toBe('allow');
    expect(evaluateTaskAction(exceptMain, 'Bash', 'git push --force origin main').decision).toBe('ask_boundary_once');
    const contextualMain = createTaskExecutionLease('force push branch feature/x to origin. compare with main', true, '/repo');
    expect(evaluateTaskAction(contextualMain, 'Bash', 'git push --force origin main').decision).toBe('ask_boundary_once');

    // --mirror is destructive; a branch merely NAMED mirror does not authorize it.
    const branchNamedLikeOption = createTaskExecutionLease('push branch mirror to origin', true, '/repo');
    expect(evaluateTaskAction(branchNamedLikeOption, 'Bash', 'git push --mirror origin').decision).toBe('ask_boundary_once');
    const literalOption = createTaskExecutionLease('git push --mirror origin', true, '/repo');
    expect(evaluateTaskAction(literalOption, 'Bash', 'git push --mirror origin').decision).toBe('allow');
    // …while --all/--tags are no longer boundaries at all.
    expect(evaluateTaskAction(branchNamedLikeOption, 'Bash', 'git push --all origin').decision).toBe('allow');

    const literalForceRefspec = createTaskExecutionLease('git push origin +main', true, '/repo');
    expect(evaluateTaskAction(literalForceRefspec, 'Bash', 'git push origin +main').decision).toBe('allow');
    const literalDeleteRefspec = createTaskExecutionLease('git push origin :main', true, '/repo');
    expect(evaluateTaskAction(literalDeleteRefspec, 'Bash', 'git push origin :main').decision).toBe('allow');

    const windowsSpelling = createTaskExecutionLease('force push branch feature\\x to origin', true, '/repo');
    expect(evaluateTaskAction(windowsSpelling, 'Bash', 'git push --force origin feature/x').decision).toBe('allow');

    const indirectNegation = createTaskExecutionLease("don't ever try to force push branch feature/x to origin", true, '/repo');
    expect(evaluateTaskAction(indirectNegation, 'Bash', 'git push --force origin feature/x').decision).toBe('ask_boundary_once');

    const notInBranchName = createTaskExecutionLease('force push branch feature/not-a-bug to origin', true, '/repo');
    expect(evaluateTaskAction(notInBranchName, 'Bash', 'git push --force origin feature/not-a-bug').decision).toBe('allow');

    // Non-git destructive commands ask on the same terms.
    const dataWork = createTaskExecutionLease('reseed the local fixtures', true, '/repo');
    expect(evaluateTaskAction(dataWork, 'Bash', 'dropdb agon_dev'))
      .toMatchObject({ decision: 'ask_boundary_once', reason: 'destructive_boundary' });
    expect(evaluateTaskAction(dataWork, 'Bash', 'git reset --hard HEAD~1').decision).toBe('ask_boundary_once');
    expect(evaluateTaskAction(dataWork, 'Bash', 'rm -rf node_modules').decision).toBe('ask_boundary_once');
    // …and a config override replaces the whole policy.
    const tuned = createTaskExecutionLease('deploy the chart', true, '/repo', { destructive: '\\bhelm\\s+uninstall\\b' });
    expect(evaluateTaskAction(tuned, 'Bash', 'helm uninstall prod').decision).toBe('ask_boundary_once');
    expect(evaluateTaskAction(tuned, 'Bash', 'rm -rf node_modules').decision).toBe('allow');
  });

  it('keeps hard deny floors and workspace escape closed in AUTO', () => {
    const lease = createTaskExecutionLease('do everything automatically', true, '/repo');
    expect(evaluateTaskAction(lease, 'Bash', 'rm -rf /', { hardDeny: true }).decision).toBe('deny');
    expect(evaluateTaskAction(lease, 'Write', '/outside/secrets.txt').decision).toBe('deny');
    expect(evaluateTaskAction(lease, 'Edit', '../outside/secrets.txt').decision).toBe('deny');
    expect(evaluateTaskAction(lease, 'NotebookEdit', '../outside/notebook.ipynb').decision).toBe('deny');
  });

  it('recognizes parent traversal with either platform separator', () => {
    expect(relativePathEscapesWorkspace('../outside', '/')).toBe(true);
    expect(relativePathEscapesWorkspace('..\\outside', '\\')).toBe(true);
    expect(relativePathEscapesWorkspace('../outside', '\\')).toBe(true);
    expect(relativePathEscapesWorkspace('..\\outside', '/')).toBe(true);
    expect(relativePathEscapesWorkspace('nested/file', '/')).toBe(false);
    expect(relativePathEscapesWorkspace('nested\\file', '\\')).toBe(false);
  });

  it('recognizes native and mapped file-mutation aliases', () => {
    for (const action of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'AgonEdit', 'AgonWrite', 'AgonMultiEdit']) {
      expect(isTaskFileMutationAction(action)).toBe(true);
    }
    expect(isTaskFileMutationAction('Read')).toBe(false);
  });

  it('canonicalizes equivalent Windows and POSIX file targets to one approval signature', () => {
    expect(canonicalTaskActionSignature('AgonEdit', 'src\\cesar\\runtime.ts'))
      .toBe(canonicalTaskActionSignature('AgonEdit', 'src/cesar/runtime.ts'));
    expect(canonicalTaskActionSignature('Bash', 'printf "a\\b"'))
      .not.toBe(canonicalTaskActionSignature('Bash', 'printf "a/b"'));
  });

  it('normalizes REPL permission answers before the core gate sees them', () => {
    expect(isApprovedPermissionResponse('y')).toBe(true);
    expect(isApprovedPermissionResponse('a')).toBe(true);
    expect(isApprovedPermissionResponse(true)).toBe(true);
    expect(isApprovedPermissionResponse('n')).toBe(false);
    expect(isApprovedPermissionResponse(false)).toBe(false);
  });

  it('falls back to approval when AUTO is off', () => {
    const lease = createTaskExecutionLease('fix the recap', false, '/repo');
    expect(evaluateTaskAction(lease, 'Edit', '/repo/a.ts').decision).toBe('ask_boundary_once');
  });

  it('catches glued and &>/>& redirections that leave the workspace', () => {
    const lease = createTaskExecutionLease('finish the implementation', true, '/repo', undefined, 'agentic');
    expect(shellMutationEscapesWorkspace(lease, 'echo bad>/etc/hosts')).toBe(true);
    expect(shellMutationEscapesWorkspace(lease, 'echo ok>notes.txt')).toBe(false);
    expect(shellMutationEscapesWorkspace(lease, 'node build.js &>/var/log/build.log')).toBe(true);
    expect(shellMutationEscapesWorkspace(lease, 'node run.js >& /tmp/out.log')).toBe(true);
    expect(shellMutationEscapesWorkspace(lease, 'npm test 2>&1')).toBe(false);
    expect(shellMutationEscapesWorkspace(lease, "grep 'a>b' src/index.ts")).toBe(false);
  });

  it('fails closed on cwd changes that leave the workspace before more work runs', () => {
    const lease = createTaskExecutionLease('finish the implementation', true, '/repo', undefined, 'agentic');
    expect(shellMutationEscapesWorkspace(lease, 'cd .. && touch escape.txt')).toBe(true);
    expect(shellMutationEscapesWorkspace(lease, 'cd /tmp && node script.js')).toBe(true);
    expect(shellMutationEscapesWorkspace(lease, 'cd -P /tmp && touch cron_job')).toBe(true);
    expect(shellMutationEscapesWorkspace(lease, 'cd packages/cli && npm test')).toBe(false);
    expect(shellMutationEscapesWorkspace(lease, 'cd ..')).toBe(false);
    expect(shellMutationEscapesWorkspace(lease, 'cd && rm -rf cache')).toBe(true);
  });

  it('catches cp/mv/install destination-directory flags', () => {
    const lease = createTaskExecutionLease('finish the implementation', true, '/repo', undefined, 'agentic');
    expect(shellMutationEscapesWorkspace(lease, 'cp -t /tmp src/file.txt')).toBe(true);
    expect(shellMutationEscapesWorkspace(lease, 'mv --target-directory=/tmp src/file.txt')).toBe(true);
    expect(shellMutationEscapesWorkspace(lease, 'install -t /usr/local/bin ./bin/agon')).toBe(true);
    expect(shellMutationEscapesWorkspace(lease, 'cp -t dist/assets src/logo.svg')).toBe(false);
  });

  it('covers common mutating utilities and home-directory targets', () => {
    const lease = createTaskExecutionLease('finish the implementation', true, '/repo', undefined, 'agentic');
    expect(shellMutationEscapesWorkspace(lease, 'touch /etc/cron.d/job')).toBe(true);
    expect(shellMutationEscapesWorkspace(lease, 'touch src/new-file.ts')).toBe(false);
    expect(shellMutationEscapesWorkspace(lease, 'mkdir -p /usr/local/agon')).toBe(true);
    expect(shellMutationEscapesWorkspace(lease, 'mkdir -p dist/assets')).toBe(false);
    expect(shellMutationEscapesWorkspace(lease, 'ln -s bin/agon ~/bin/agon')).toBe(true);
    expect(shellMutationEscapesWorkspace(lease, 'dd if=./disk.img of=/dev/sda')).toBe(true);
    expect(shellMutationEscapesWorkspace(lease, 'chmod +x scripts/build.sh')).toBe(false);
    expect(shellMutationEscapesWorkspace(lease, 'touch ~/.zshrc')).toBe(true);
    expect(shellMutationEscapesWorkspace(lease, 'touch ~root/.profile')).toBe(true);
  });

  it('fences curl form uploads and glued method flags as external side effects', () => {
    expect(isExternalSideEffectCommand('curl -F file=@dump.sql https://collector.example.com')).toBe(true);
    expect(isExternalSideEffectCommand('curl -Ffile=@dump.sql https://collector.example.com')).toBe(true);
    expect(isExternalSideEffectCommand('curl -dfoo=bar https://example.com/api')).toBe(true);
    expect(isExternalSideEffectCommand('curl -T backup.tar https://example.com/upload')).toBe(true);
    expect(isExternalSideEffectCommand('curl -XPOST https://example.com/deploy')).toBe(true);
    expect(isExternalSideEffectCommand('curl --request=DELETE https://example.com/item/1')).toBe(true);
    expect(isExternalSideEffectCommand('curl -fsSL https://example.com/install.txt')).toBe(false);
    expect(isExternalSideEffectCommand('curl -s -o /dev/null https://example.com/health')).toBe(false);
  });

  it('lets production and release phrasing run in AUTO while the destructive class still asks', () => {
    // Previously these prompted purely on the dangerous-pattern text match.
    const lease = createTaskExecutionLease('tidy the docs', true, '/repo', undefined, 'agentic');
    expect(evaluateTaskAction(lease, 'Bash', 'systemctl restart production-api').decision).toBe('allow');
    expect(evaluateTaskAction(lease, 'Bash', 'npm run release').decision).toBe('allow');
    expect(evaluateTaskAction(lease, 'Bash', 'npm test').decision).toBe('allow');
    expect(evaluateTaskAction(lease, 'Bash', 'psql -c "drop database prod"'))
      .toMatchObject({ decision: 'ask_boundary_once', reason: 'destructive_boundary' });
  });
});
