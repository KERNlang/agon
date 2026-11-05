import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult, InvocationContext, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { validateContributionInput } from '@kernlang/agon-kernel';
import { createMod, runReview } from './implementation.js';

const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'agon-trees-')));
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function identify(cwd: string) {
  git(cwd, 'config', 'user.email', 'test@example.invalid');
  git(cwd, 'config', 'user.name', 'Test');
}

function repo(): string {
  const cwd = temp();
  git(cwd, 'init', '-b', 'main');
  identify(cwd);
  writeFileSync(join(cwd, 'a.ts'), 'export const a = 1;\n');
  git(cwd, 'add', 'a.ts');
  git(cwd, 'commit', '-m', 'base');
  return cwd;
}

function commit(cwd: string, file: string, content: string): string {
  writeFileSync(join(cwd, file), content);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-m', `edit ${file}`);
  return git(cwd, 'rev-parse', 'HEAD');
}

function addTree(root: string, branch: string, start = 'HEAD', name = branch): string {
  const path = join(temp(), name);
  git(root, 'worktree', 'add', '-q', '-b', branch, path, start);
  return realpathSync(path);
}

function harness(onDispatch?: (prompt: string, cwd: string) => void | Promise<void>) {
  const calls: { cwd: string; prompt: string }[] = [];
  const dispatch = vi.fn(async (engineId: string, prompt: string, context: InvocationContext) => {
    calls.push({ cwd: context.cwd, prompt });
    await onDispatch?.(prompt, context.cwd);
    const failed = prompt.includes('FAILME');
    const findings = prompt.includes('BLOCKME')
      ? '[{"file":"a.ts","lines":"1","severity":"blocking","blocking":true,"confidence":0.9,"problem":"bad"}]' : '[]';
    return {
      engineId, exitCode: failed ? 1 : 0, finishReason: 'stop', timedOut: false, costUsd: undefined,
      stdout: failed ? '' : `<!--AGON_REVIEW_FINDINGS_v1-->\n\`\`\`json\n${findings}\n\`\`\``, stderr: failed ? 'provider down' : '',
    };
  });
  const services = {
    identity: { id: 'agon.review', version: '1', contentHash: `sha256:${'a'.repeat(64)}` },
    source: 'bundled',
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    receipts: { record: vi.fn(async () => 'r') },
    permissions: { check: vi.fn() },
    state: { read: vi.fn(), write: vi.fn() },
    engines: {
      listActive: vi.fn(async () => ['alpha']),
      describe: vi.fn(async (ids: readonly string[]) => ids.map(id => ({ id, binary: `${id}-cli`, backend: 'cli' }))),
      dispatch,
    },
  } as unknown as ModServices;
  return { services, calls };
}

async function review(input: Record<string, Json>, cwd: string, h = harness(), signal = new AbortController().signal, config: Record<string, Json> = {}) {
  const out = await runReview({ engine: 'alpha', ...input }, { invocationId: 'i', cwd, platform: 'darwin-arm64', signal, config }, h.services) as CommandResult;
  return { out, report: out.result as any, calls: h.calls };
}

const statusOf = (report: any, tree: string) => report.trees.find((entry: any) => entry.tree === tree);

afterEach(() => { vi.restoreAllMocks(); });

describe('multi-tree review through runReview', () => {
  it('blames the wrong tree when directories share a basename, reviews a duplicate twice, or shows the default branch moving as reversed changes', async () => {
    const root = repo();
    const a = addTree(root, 'feat-a', 'HEAD', 'wt');
    const b = addTree(root, 'feat-b', 'HEAD', 'wt');
    commit(a, 'a.ts', 'export const a = 2; // tree a\n');
    commit(b, 'b.ts', 'export const b = "BLOCKME";\n');
    commit(root, 'moved.ts', 'export const m = "MOVED_ON_MAIN";\n');
    const link = join(temp(), 'link');
    symlinkSync(b, link);
    const { out, report, calls } = await review({ worktree: [relative(root, a), a, b, link], format: 'sarif' }, root);

    expect(calls.map(call => call.cwd)).toEqual([a, b]);
    expect(calls.every(call => !call.prompt.includes('MOVED_ON_MAIN'))).toBe(true);
    expect(out.exitCode).toBe(2);
    expect(report.trees.map((entry: any) => entry.tree)).toEqual([a, b]);
    expect(report.consensus.blockers.map((finding: any) => finding.tree)).toEqual([b]);
    expect(report.findings.map((finding: any) => finding.tree)).toEqual([b]);
    expect(report.warnings.filter((warning: string) => warning.includes('same tree'))).toHaveLength(2);
    const result = JSON.parse(out.stdout!).runs[0].results[0];
    expect(result.properties.tree).toBe(b);
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe('a.ts');
  });

  it('drops a locked worktree holding real work, or tries to review a bare or vanished one, under --all-worktrees', async () => {
    const source = repo();
    const bare = join(temp(), 'bare.git');
    git(source, 'clone', '-q', '--bare', source, bare);
    const spaced = join(temp(), 'dir with spaces');
    git(bare, 'worktree', 'add', '-q', '-b', 'spaced', spaced);
    const locked = join(temp(), 'locked');
    git(bare, 'worktree', 'add', '-q', '-b', 'locked', locked);
    git(bare, 'worktree', 'lock', '--reason', 'agent at work', locked);
    const gone = join(temp(), 'gone');
    git(bare, 'worktree', 'add', '-q', '-b', 'gone', gone);
    rmSync(gone, { recursive: true });
    writeFileSync(join(locked, 'a.ts'), 'export const a = "locked work";\n');
    writeFileSync(join(spaced, 'a.ts'), 'export const a = "spaced work";\n');

    const { out, report, calls } = await review({ 'all-worktrees': true }, realpathSync(locked));
    expect(out.exitCode).toBe(0);
    expect(calls.map(call => call.cwd).sort()).toEqual([realpathSync(spaced), realpathSync(locked)].sort());
    expect(report.trees).toHaveLength(2);
    expect(report.warnings.some((warning: string) => warning.includes('bare.git') && warning.includes('bare repository'))).toBe(true);
    expect(report.warnings.some((warning: string) => warning.includes('gone') && warning.includes('prunable'))).toBe(true);
  });

  it('misses work on the default branch, in a detached HEAD or in an untracked file, or ignores an explicit target or base', async () => {
    const root = repo();
    writeFileSync(join(root, 'a.ts'), 'export const a = "DIRTY_ON_MAIN";\n');
    const detachedPath = join(temp(), 'detached');
    git(root, 'worktree', 'add', '-q', '--detach', detachedPath);
    const detached = realpathSync(detachedPath);
    identify(detached);
    commit(detached, 'd.ts', 'export const d = "DETACHED_COMMIT";\n');
    const untracked = addTree(root, 'untracked');
    writeFileSync(join(untracked, 'new.ts'), 'export const n = "UNTRACKED_ONLY";\n');

    const auto = await review({ worktree: [root, detached, untracked] }, root);
    const promptFor = (tree: string) => auto.calls.find(call => call.cwd === tree)!.prompt;
    expect(promptFor(root)).toContain('DIRTY_ON_MAIN');
    expect(promptFor(detached)).toContain('DETACHED_COMMIT');
    expect(promptFor(untracked)).toContain('UNTRACKED_ONLY');

    const explicit = await review({ target: 'uncommitted', worktree: [root, detached, untracked] }, root);
    expect(statusOf(explicit.report, detached).status).toBe('empty');
    expect(statusOf(explicit.report, root).status).toBe('ok');

    const based = await review({ base: 'main', worktree: [detached] }, root);
    expect(statusOf(based.report, detached).base).toBe('main');
    expect(based.calls[0]!.prompt).toContain('DETACHED_COMMIT');
  });

  it('reviews stacked changes twice, or stacks on a diverged sibling or an ancestor older than the default merge-base', async () => {
    const root = repo();
    const old = addTree(root, 'old');
    commit(root, 'm.ts', 'export const m = 1;\n');
    const a = addTree(root, 'stack-a');
    commit(a, 'sa.ts', 'export const s = "ONLY_IN_A";\n');
    const b = addTree(root, 'stack-b', 'stack-a');
    const bHead = commit(b, 'sb.ts', 'export const s = "ONLY_IN_B";\n');
    const c = addTree(root, 'stack-c', 'stack-b');
    commit(c, 'sc.ts', 'export const s = "ONLY_IN_C";\n');
    const sibling = addTree(root, 'sibling', 'main');
    commit(sibling, 'sib.ts', 'export const s = "ONLY_IN_SIBLING";\n');
    const mainHead = git(root, 'rev-parse', 'main');

    const { report, calls } = await review({ worktree: [c, a, b, sibling, old] }, root);
    expect(statusOf(report, c).stackedOn).toBe(b);
    expect(statusOf(report, c).base).toBe(bHead);
    expect(statusOf(report, b).stackedOn).toBe(a);
    expect(statusOf(report, a).stackedOn).toBeUndefined();
    expect(statusOf(report, a).base).toBe(mainHead);
    expect(statusOf(report, sibling).stackedOn).toBeUndefined();
    expect(statusOf(report, sibling).base).toBe(mainHead);
    expect(statusOf(report, old).status).toBe('empty');
    const cPrompt = calls.find(call => call.cwd === c)!.prompt;
    expect(cPrompt).toContain('ONLY_IN_C');
    expect(cPrompt).not.toContain('ONLY_IN_B');
    expect(cPrompt).not.toContain('ONLY_IN_A');
  });

  it('spends on clean trees or pays twice for one identical diff', async () => {
    const root = repo();
    const a = addTree(root, 'clean-a');
    const b = addTree(root, 'clean-b');
    const clean = await review({ worktree: [a, b], format: 'text' }, root);
    expect(clean.out.exitCode).toBe(0);
    expect(clean.calls).toHaveLength(0);
    expect(clean.report.trees.map((entry: any) => entry.status)).toEqual(['empty', 'empty']);
    expect(clean.out.stdout).toContain('No diff found in any of the 2 selected trees');
    expect(clean.out.stdout).toContain('nothing reviewed');

    for (const tree of [a, b]) writeFileSync(join(tree, 'a.ts'), 'export const a = "same edit";\n');
    const same = await review({ worktree: [a, b] }, root);
    expect(same.calls.map(call => call.cwd)).toEqual([a]);
    expect(statusOf(same.report, b)).toMatchObject({ status: 'same', sameAs: a });
  });

  it('spends past --max-trees, or counts empty trees against it', async () => {
    const root = repo();
    const dirty = ['x', 'y', 'z'].map(name => {
      const tree = addTree(root, `limit-${name}`);
      writeFileSync(join(tree, 'a.ts'), `export const a = "${name}";\n`);
      return tree;
    });
    const empty = addTree(root, 'limit-empty');
    const over = await review({ worktree: [...dirty, empty], 'max-trees': '2' }, root);
    expect(over.out.exitCode).toBe(1);
    expect(over.out.stderr).toContain('--max-trees 3');
    expect(over.out.stderr).toContain(dirty[2]);
    expect(over.calls).toHaveLength(0);

    const fromConfig = await review({ worktree: dirty }, root, harness(), undefined, { reviewMaxTrees: 2 });
    expect(fromConfig.out.exitCode).toBe(1);
    expect(fromConfig.calls).toHaveLength(0);

    const atLimit = await review({ worktree: [...dirty, empty], 'max-trees': '3' }, root);
    expect(atLimit.out.exitCode).toBe(0);
    expect(atLimit.calls).toHaveLength(3);

    const invalid = await review({ worktree: dirty, 'max-trees': '0' }, root);
    expect(invalid.out.exitCode).toBe(1);
    expect(invalid.out.stderr).toContain('--max-trees must be a positive integer');
    expect(invalid.calls).toHaveLength(0);
  });

  it('hides a real merge conflict or an uncommitted overlap, changes the verdict for one, or passes silently when the check could not run', async () => {
    const root = repo();
    const a = addTree(root, 'conflict-a');
    const b = addTree(root, 'conflict-b');
    commit(a, 'a.ts', 'export const a = "from a";\n');
    commit(b, 'a.ts', 'export const a = "from b";\n');
    const conflict = await review({ worktree: [a, b] }, root);
    expect(conflict.out.exitCode).toBe(0);
    expect(conflict.report.conflicts).toEqual([{ trees: [a, b], files: ['a.ts'] }]);
    expect(conflict.report.overlaps).toEqual([{ trees: [a, b], files: ['a.ts'] }]);

    const c = addTree(root, 'dirty-c');
    const d = addTree(root, 'dirty-d');
    writeFileSync(join(c, 'a.ts'), 'export const a = "uncommitted c";\n');
    writeFileSync(join(d, 'a.ts'), 'export const a = "uncommitted d";\n');
    const uncommitted = await review({ worktree: [c, d] }, root);
    expect(uncommitted.report.conflicts).toEqual([]);
    expect(uncommitted.report.overlaps).toEqual([{ trees: [c, d], files: ['a.ts'] }]);

    const other = repo();
    writeFileSync(join(other, 'a.ts'), 'export const a = "other repo";\n');
    const repos = await review({ worktree: [c, other] }, root);
    expect(repos.report.conflicts).toEqual([]);
    expect(repos.report.overlaps).toEqual([]);
    expect(repos.report.warnings.some((warning: string) => warning.includes('different repos'))).toBe(true);

    const orphan = addTree(root, 'orphan-base');
    git(orphan, 'checkout', '-q', '--orphan', 'orphan');
    identify(orphan);
    commit(orphan, 'o.ts', 'export const o = 1;\n');
    const unrelated = await review({ worktree: [a, orphan] }, root);
    expect(unrelated.report.warnings.some((warning: string) => warning.includes('no conflict check'))).toBe(true);

    const shimDir = temp();
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    writeFileSync(join(shimDir, 'git'), `#!/bin/sh\nif [ "$1" = merge-tree ]; then echo usage >&2; exit 129; fi\nexec "${realGit}" "$@"\n`);
    chmodSync(join(shimDir, 'git'), 0o755);
    vi.stubEnv('PATH', `${shimDir}:${process.env.PATH}`);
    try {
      const oldGit = await review({ worktree: [a, b] }, root);
      expect(oldGit.report.conflicts).toEqual([]);
      expect(oldGit.report.warnings.some((warning: string) => warning.includes('git 2.38'))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('lets one failing tree stop the others or hide their blockers, spends on a bad path, or keeps dispatching past the deadline or an abort', async () => {
    const root = repo();
    const a = addTree(root, 'fail-a');
    const b = addTree(root, 'fail-b');
    writeFileSync(join(a, 'a.ts'), 'export const a = "FAILME";\n');
    writeFileSync(join(b, 'a.ts'), 'export const a = "BLOCKME";\n');
    const failed = await review({ worktree: [a, b] }, root);
    expect(failed.out.exitCode).toBe(1);
    expect(statusOf(failed.report, a).status).toBe('failed');
    expect(statusOf(failed.report, b)).toMatchObject({ status: 'ok', blockers: 1 });
    expect(failed.report.consensus.blockers.map((finding: any) => finding.tree)).toEqual([b]);

    const notGit = await review({ worktree: [a, temp()] }, root);
    expect(notGit.out.exitCode).toBe(1);
    expect(notGit.out.stderr).toContain('not a git work tree');
    expect(notGit.calls).toHaveLength(0);

    const c = addTree(root, 'slow-c');
    const d = addTree(root, 'slow-d');
    writeFileSync(join(c, 'a.ts'), 'export const a = "slow c";\n');
    writeFileSync(join(d, 'a.ts'), 'export const a = "slow d";\n');
    const slow = harness(async () => { await new Promise(done => setTimeout(done, 1100)); });
    const late = await review({ worktree: [c, d], deadline: '1' }, root, slow);
    expect(late.out.exitCode).toBe(1);
    expect(late.calls).toHaveLength(1);
    expect(statusOf(late.report, d).status).toBe('skipped');
    expect(late.report.incomplete).toBeGreaterThanOrEqual(1);

    const controller = new AbortController();
    const aborting = harness(() => { controller.abort(); });
    const aborted = await review({ worktree: [c, d] }, root, aborting, controller.signal);
    expect(aborted.calls).toHaveLength(1);
    expect(statusOf(aborted.report, d).status).toBe('skipped');
    expect(aborted.out.exitCode).toBe(1);
  });

  it('runs a per-tree mutation pass whose results vanish, loses --split per tree, or spends before refusing an over-limit tree', async () => {
    const root = repo();
    const big = addTree(root, 'split-big');
    const small = addTree(root, 'split-small');
    for (const name of ['b.ts', 'c.ts', 'd.ts']) writeFileSync(join(big, name), `export const x = '${'y'.repeat(150)}';\n`);
    writeFileSync(join(small, 'a.ts'), 'export const a = "small";\n');
    for (const selection of [{ worktree: [big] }, { 'all-worktrees': true }]) {
      const mutate = await review({ ...selection, mutate: true }, root);
      expect(mutate.out.exitCode).toBe(1);
      expect(mutate.out.stderr).toContain('agon mutate --diff');
      expect(mutate.calls).toHaveLength(0);
    }

    const unsplit = await review({ worktree: [big, small], 'max-diff-chars': '300' }, root);
    expect(unsplit.out.exitCode).toBe(1);
    expect(unsplit.out.stderr).toContain(big);
    expect(unsplit.calls).toHaveLength(0);

    const split = await review({ worktree: [big, small], 'max-diff-chars': '300', split: true }, root);
    expect(split.out.exitCode).toBe(0);
    expect(statusOf(split.report, big).split.batches).toBeGreaterThan(1);
    expect(statusOf(split.report, small).split).toBeUndefined();
    expect(split.calls.filter(call => call.cwd === small)).toHaveLength(1);

    const capped = await review({ worktree: [big, small], 'max-diff-chars': '300', split: true, 'max-batches': '1' }, root);
    expect(capped.out.exitCode).toBe(1);
    expect(statusOf(capped.report, big).status).toBe('failed');
    expect(statusOf(capped.report, small).status).toBe('ok');
  });

  it('accepts the arrays the MCP Review tool receives through the shared input schema', async () => {
    const root = repo();
    const spaced = addTree(root, 'mcp-tree', 'HEAD', 'with space');
    writeFileSync(join(spaced, 'a.ts'), 'export const a = "mcp";\n');
    const h = harness();
    let tool: any;
    const registrar = {
      command: () => () => {}, intent: () => () => {}, planStep: () => () => {}, resultType: () => () => {}, config: () => () => {},
      tool: (surface: string, value: unknown) => { if (surface === 'mcp') tool = value; return () => {}; },
    } as unknown as Registrar;
    await (await createMod(h.services)).activate(registrar, h.services);
    const input = { engine: 'alpha', worktree: [spaced], 'max-trees': '1' };
    expect(validateContributionInput(tool.inputSchema, input)).toBeNull();
    await tool.run(input, { invocationId: 'i', cwd: root, platform: 'darwin-arm64', signal: new AbortController().signal, config: {} });
    expect(h.calls.map(call => call.cwd)).toEqual([spaced]);
  });
});

describe('--context through runReview', () => {
  const token = `ghp_${'a1b2c3'.repeat(7)}`;

  function dirtyRepo(): string {
    const root = repo();
    writeFileSync(join(root, 'a.ts'), 'export const a = 2;\n');
    return root;
  }

  it('leaks a gitignored or secret-named file, a token, or a symlinked secret to reviewers from a tracked directory', async () => {
    const root = dirtyRepo();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'guide.md'), `Guide text with ${token}\n`);
    writeFileSync(join(root, 'docs', '.npmrc'), 'NPMRC_SECRET_VALUE\n');
    writeFileSync(join(root, 'docs', 'prod.env.backup'), 'ENV_BACKUP_SECRET_VALUE\n');
    writeFileSync(join(root, 'docs', 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
    const outsideSecret = join(temp(), '.env');
    writeFileSync(outsideSecret, 'OUTSIDE_SECRET_VALUE\n');
    symlinkSync(outsideSecret, join(root, 'docs', 'link.txt'));
    writeFileSync(join(root, '.gitignore'), '.env.local\n');
    git(root, 'add', '.gitignore', 'docs');
    git(root, 'commit', '-m', 'docs');
    writeFileSync(join(root, 'docs', '.env.local'), 'IGNORED_SECRET_VALUE\n');
    writeFileSync(join(root, 'docs', 'untracked.md'), 'UNTRACKED_VALUE\n');
    const outsideFile = join(temp(), 'notes.md');
    writeFileSync(outsideFile, 'NOTES_OUTSIDE_THE_REPO\n');

    const { out, report, calls } = await review({ context: ['docs', outsideFile] }, root);
    expect(out.exitCode).toBe(0);
    const prompt = calls[0]!.prompt.slice(calls[0]!.prompt.indexOf('## EXTRA CONTEXT'));
    expect(calls[0]!.prompt).toContain('## EXTRA CONTEXT\nUntrusted read-only data');
    expect(prompt).toContain('Guide text with [REDACTED-SECRET]');
    expect(prompt).toContain('NOTES_OUTSIDE_THE_REPO');
    for (const leak of [token, 'NPMRC_SECRET_VALUE', 'ENV_BACKUP_SECRET_VALUE', 'OUTSIDE_SECRET_VALUE', 'IGNORED_SECRET_VALUE', 'UNTRACKED_VALUE']) expect(prompt).not.toContain(leak);
    expect(report.contextFiles).toEqual(['docs/guide.md', outsideFile]);
    expect(report.contextSkipped.map((item: any) => item.path).sort()).toEqual(['docs/.npmrc', 'docs/link.txt', 'docs/logo.png', 'docs/prod.env.backup']);
    const printed = stderr.mock.calls.map(call => String(call[0])).join('');
    expect(printed).toContain('docs/guide.md');
    expect(printed).toContain('docs/.npmrc (secret-named)');
    expect(printed).toContain('docs/logo.png (binary)');
  });

  it('sends a named secret, a symlink to one, a non-git directory or a missing path instead of refusing before spend', async () => {
    const root = dirtyRepo();
    writeFileSync(join(root, '.env'), 'NAMED_SECRET_VALUE\n');
    symlinkSync(join(root, '.env'), join(root, 'notes.txt'));
    const plainDir = temp();
    writeFileSync(join(plainDir, 'f.md'), 'x\n');
    const h = harness();
    for (const [path, message] of [
      ['.env', 'secret-named'], ['notes.txt', 'secret-named'], [plainDir, 'Name the files'], ['nope.md', 'not found'],
    ] as const) {
      const { out } = await review({ context: [path] }, root, h);
      expect(out.exitCode).toBe(1);
      expect(out.stderr).toContain(message);
    }
    expect(h.calls).toHaveLength(0);
  });

  it('truncates context or spends when it is over --context-max-chars, and refuses a total exactly at the limit', async () => {
    const root = dirtyRepo();
    writeFileSync(join(root, 'ten.md'), '123456789\n');
    writeFileSync(join(root, 'five.md'), '1234\n');
    const h = harness();
    const over = await review({ context: ['ten.md', 'five.md'], 'context-max-chars': '14' }, root, h);
    expect(over.out.exitCode).toBe(1);
    expect(over.out.stderr).toContain('ten.md (10 chars)');
    expect(over.out.stderr).toContain('--context-max-chars 15');
    const alone = await review({ context: ['ten.md'], 'context-max-chars': '9' }, root, h);
    expect(alone.out.exitCode).toBe(1);
    const fromConfig = await review({ context: ['ten.md'] }, root, h, undefined, { reviewContextMaxChars: 9 });
    expect(fromConfig.out.exitCode).toBe(1);
    expect(h.calls).toHaveLength(0);
    const exact = await review({ context: ['ten.md', 'five.md'], 'context-max-chars': '15' }, root, h);
    expect(exact.out.exitCode).toBe(0);
    expect(h.calls[0]!.prompt).toContain('123456789');
  });

  it('resolves a relative --context against the wrong tree or reads it once per tree in multi-tree mode', async () => {
    const root = repo();
    writeFileSync(join(root, 'ref.md'), 'REFERENCE_FROM_INVOCATION_CWD\n');
    const a = addTree(root, 'ctx-a');
    const b = addTree(root, 'ctx-b');
    writeFileSync(join(a, 'a.ts'), 'export const a = "ctx a";\n');
    writeFileSync(join(b, 'a.ts'), 'export const a = "ctx b";\n');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { report, calls } = await review({ worktree: [a, b], context: ['ref.md'] }, root);
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.prompt.includes('REFERENCE_FROM_INVOCATION_CWD'))).toBe(true);
    expect(report.contextFiles).toEqual(['ref.md']);
    expect(stderr.mock.calls.filter(call => String(call[0]).includes('agon review --context: sending'))).toHaveLength(1);
  });
});
