import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CommandResult, InvocationContext, Json, ModServices } from '@kernlang/agon-mod-api';
import { redactSecretsDeep, resolveAutoReviewBase, resolveReviewTarget, reviewMaxDiffChars } from '@kernlang/agon-support-verification';
import type { ConsensusReport } from './consensus.js';
import { extraContextReport, loadExtraContext, positiveOption, repeatedPaths, type ExtraContext } from './context-paths.js';
import { formatReport, formatSummaryLine, type ReviewFormat, type ReviewReport } from './report.js';
import { mergeConsensus, splitDiffByFile } from './split.js';

export const TREE_INPUT_PROPERTIES = Object.freeze({
  worktree: { type: 'array', items: { type: 'string' } },
  'all-worktrees': { type: 'boolean' },
  'max-trees': { type: 'string' },
  context: { type: 'array', items: { type: 'string' } },
  'context-max-chars': { type: 'string' },
});

export const TREE_REPEATED_OPTIONS = Object.freeze({ worktree: 'list', context: 'list' } as const);

export const TREE_DESCRIPTIONS = Object.freeze({
  worktree: 'Review this git work tree too; repeat for more. Each tree gets its own full routed review and findings merge into one report tagged with their tree. Relative paths resolve from the current directory. With no target, each tree is reviewed against its merge-base with the default branch, or against the nearest selected ancestor tree. Cannot be combined with --mutate.',
  'all-worktrees': 'Review every worktree of the current repo, locked ones included. Bare and prunable entries are left out and listed in the warnings. Cannot be combined with --mutate.',
  'max-trees': 'Most trees to review with --worktree or --all-worktrees (default 8, or config reviewMaxTrees). Each tree spends a full panel, so more than this refuses before any spend. Empty and duplicate trees do not count.',
  context: 'Send this file or directory to every reviewer as untrusted read-only reference; repeat for more. Relative paths resolve from the current directory. A directory must be in a git repo and sends tracked files only. Secret-named paths are refused by name and skipped inside a directory, binary files are skipped, and tokens are redacted. The exact file list goes to stderr and the report contextFiles.',
  'context-max-chars': 'Largest --context total, in characters (default 40000, or config reviewContextMaxChars). Over it, review refuses before spending and names the largest files; context is never truncated.',
});

const DEFAULT_MAX_TREES = 8;
const TREE_FLAGS = Object.keys(TREE_INPUT_PROPERTIES);

const text = (value: Json | undefined) => (typeof value === 'string' ? value.trim() : '');
const lastLine = (output: string) => output.replace(/\r?\n$/, '');
const git = (cwd: string, args: readonly string[]) =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 });

function gitPasses(cwd: string, args: readonly string[]): boolean {
  try { git(cwd, args); return true; } catch { return false; }
}

interface Tree {
  readonly path: string;
  readonly repo: string;
  readonly head?: string;
}

interface TreePlan extends Tree {
  target?: string;
  base?: string;
  stackedOn?: string;
  diff?: string;
  status: 'pending' | 'ok' | 'failed' | 'skipped' | 'empty' | 'same';
  sameAs?: string;
  error?: string;
  detail?: Record<string, unknown>;
}

function openTree(path: string): Tree {
  const top = realpathSync(lastLine(git(path, ['rev-parse', '--show-toplevel'])));
  const repo = realpathSync(resolve(top, lastLine(git(top, ['rev-parse', '--git-common-dir']))));
  let head: string | undefined;
  try { head = lastLine(git(top, ['rev-parse', '--verify', 'HEAD'])); } catch { head = undefined; }
  return { path: top, repo, ...(head ? { head } : {}) };
}

function listWorktrees(cwd: string): { path: string; bare: boolean; prunable?: string }[] {
  let raw: string;
  let separator = '\0';
  try { raw = git(cwd, ['worktree', 'list', '--porcelain', '-z']); }
  catch { raw = git(cwd, ['worktree', 'list', '--porcelain']); separator = '\n'; }
  const entries: { path: string; bare: boolean; prunable?: string }[] = [];
  for (const line of raw.split(separator)) {
    if (line.startsWith('worktree ')) entries.push({ path: line.slice('worktree '.length), bare: false });
    else if (line === 'bare' && entries.length) entries.at(-1)!.bare = true;
    else if ((line === 'prunable' || line.startsWith('prunable ')) && entries.length) entries.at(-1)!.prunable = line.slice('prunable '.length) || 'prunable';
  }
  return entries;
}

function selectTrees(input: Record<string, Json>, cwd: string): { trees: Tree[]; warnings: string[] } | { error: string } {
  const warnings: string[] = [];
  const trees = new Map<string, Tree>();
  for (const raw of repeatedPaths(input.worktree)) {
    let tree: Tree;
    try {
      if (!raw.trim()) throw new Error('empty path');
      tree = openTree(resolve(cwd, raw));
    } catch {
      return { error: `Refusing --worktree ${JSON.stringify(raw)}: not a git work tree (resolved from ${cwd}). Nothing was reviewed.` };
    }
    if (trees.has(tree.path)) warnings.push(`--worktree ${raw} is the same tree as ${tree.path}; reviewed once`);
    trees.set(tree.path, tree);
  }
  if (input['all-worktrees'] === true) {
    let entries: ReturnType<typeof listWorktrees>;
    try { entries = listWorktrees(cwd); }
    catch { return { error: `Refusing --all-worktrees: ${cwd} is not inside a git repo.` }; }
    for (const entry of entries) {
      const excluded = entry.bare ? 'bare repository'
        : entry.prunable ? `prunable: ${entry.prunable}`
        : existsSync(entry.path) ? undefined : 'directory is missing';
      if (excluded) { warnings.push(`--all-worktrees left out ${entry.path} (${excluded})`); continue; }
      try {
        const tree = openTree(entry.path);
        if (!trees.has(tree.path)) trees.set(tree.path, tree);
      } catch (error) {
        warnings.push(`--all-worktrees left out ${entry.path} (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`);
      }
    }
  }
  if (!trees.size) return { error: 'No reviewable tree was selected.' };
  return { trees: [...trees.values()], warnings };
}

function isStrictAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  return ancestor !== descendant && gitPasses(cwd, ['merge-base', '--is-ancestor', ancestor, descendant]);
}

/** The default-branch merge-base, or undefined when only uncommitted work can be reviewed. */
function defaultBase(tree: Tree, warnings: string[]): string | undefined {
  // '' never equals the default branch, so a tree on that branch still gets its ref instead of null.
  const ref = resolveAutoReviewBase(tree.path, '');
  if (!ref) {
    warnings.push(`${tree.path}: no default branch found, so only its uncommitted work is reviewed`);
    return undefined;
  }
  try {
    return lastLine(git(tree.path, ['merge-base', 'HEAD', ref]));
  } catch {
    warnings.push(`${tree.path}: no merge-base with ${ref}, so only its uncommitted work is reviewed`);
    return undefined;
  }
}

function planBases(trees: readonly Tree[], explicitTarget: string, explicitBase: string, warnings: string[]): TreePlan[] {
  if (explicitTarget || explicitBase) {
    return trees.map(tree => ({
      ...tree, status: 'pending',
      ...(explicitTarget ? { target: explicitTarget } : {}), ...(explicitBase ? { base: explicitBase } : {}),
    }));
  }
  return trees.map(tree => {
    const plan: TreePlan = { ...tree, status: 'pending', target: 'uncommitted' };
    if (!tree.head) return plan;
    const mergeBase = defaultBase(tree, warnings);
    if (!mergeBase) { plan.base = tree.head; return plan; }
    plan.base = mergeBase;
    const ancestors = trees.filter((other): other is Tree & { head: string } => other.repo === tree.repo && !!other.head
      && isStrictAncestor(tree.path, other.head, tree.head!) && isStrictAncestor(tree.path, mergeBase, other.head));
    const distance = (head: string) => Number(lastLine(git(tree.path, ['rev-list', '--count', `${head}..${tree.head}`])));
    const nearest = ancestors.map(other => ({ other, commits: distance(other.head) })).sort((a, b) => a.commits - b.commits)[0]?.other;
    if (nearest) { plan.base = nearest.head; plan.stackedOn = nearest.path; }
    return plan;
  });
}

function refuseOversized(plans: readonly TreePlan[], limit: number): string | undefined {
  const refusals = plans.filter(plan => (plan.diff?.length ?? 0) > limit).map(plan => {
    try {
      resolveReviewTarget(plan.target ?? 'uncommitted', plan.path, plan.base, limit, '--max-diff-chars');
      return `${plan.path}: its diff changed while being measured and is over the limit`;
    } catch (error) {
      return `${plan.path}: ${error instanceof Error ? error.message : String(error)}`;
    }
  });
  return refusals.length ? `Refusing to review ${refusals.length} of ${plans.length} trees before any spend.\n${refusals.join('\n')}` : undefined;
}

function resolveDiffs(plans: TreePlan[]): void {
  const seen = new Map<string, string>();
  for (const plan of plans) {
    let diff: string;
    try {
      diff = resolveReviewTarget(plan.target ?? 'uncommitted', plan.path, plan.base, Number.POSITIVE_INFINITY, '--max-diff-chars').diff;
    } catch (error) {
      plan.status = 'failed';
      plan.error = error instanceof Error ? error.message : String(error);
      continue;
    }
    plan.diff = diff;
    if (!diff.trim()) { plan.status = 'empty'; continue; }
    const key = `${plan.repo}\0${createHash('sha256').update(diff).digest('hex')}`;
    const first = seen.get(key);
    if (first) { plan.status = 'same'; plan.sameAs = first; }
    else seen.set(key, plan.path);
  }
}

interface PairFiles { readonly trees: readonly [string, string]; readonly files: readonly string[] }

function mergeConflicts(a: TreePlan, b: TreePlan, warnings: string[]): string[] {
  if (!a.head || !b.head || a.head === b.head) return [];
  try {
    git(a.path, ['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', a.head, b.head]);
    return [];
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    if (failure.status === 1 && typeof failure.stdout === 'string') return [...new Set(failure.stdout.split('\0').slice(1).filter(Boolean))];
    warnings.push(`no conflict check for ${a.path} and ${b.path}: git merge-tree --write-tree failed (it needs git 2.38 or newer and related histories)`);
    return [];
  }
}

function crossCheck(plans: readonly TreePlan[], warnings: string[]): { conflicts: PairFiles[]; overlaps: PairFiles[] } {
  const conflicts: PairFiles[] = [];
  const overlaps: PairFiles[] = [];
  const touched = new Map(plans.map(plan => [plan, new Set(plan.diff?.trim() ? splitDiffByFile(plan.diff).map(file => file.path) : [])]));
  for (const [index, a] of plans.entries()) {
    for (const b of plans.slice(index + 1)) {
      if (a.repo !== b.repo) { warnings.push(`no cross-tree check for ${a.path} and ${b.path}: they are different repos`); continue; }
      const conflicted = mergeConflicts(a, b, warnings);
      if (conflicted.length) conflicts.push({ trees: [a.path, b.path], files: conflicted });
      if (b.sameAs === a.path || a.sameAs === b.path) continue;
      const shared = [...touched.get(a)!].filter(file => touched.get(b)!.has(file));
      if (shared.length) overlaps.push({ trees: [a.path, b.path], files: shared });
    }
  }
  return { conflicts, overlaps };
}

function tagConsensus(consensus: ConsensusReport, tree: string): ConsensusReport {
  const tag = <T extends object>(items: readonly T[]) => items.map(item => ({ ...item, tree }));
  return {
    ...consensus,
    findings: tag(consensus.findings), verified: tag(consensus.verified), needsCheck: tag(consensus.needsCheck),
    speculative: tag(consensus.speculative), nits: tag(consensus.nits), blockers: tag(consensus.blockers),
  };
}

type TreeReport = Record<string, unknown> & Partial<ReviewReport> & { findings?: object[]; engines?: string[]; roles?: Record<string, string>; reviews?: readonly object[] };

export type TreeRunner = (input: Record<string, Json>, context: InvocationContext, extra: ExtraContext | undefined) => Promise<CommandResult>;

export const isMultiTreeInput = (input: Record<string, Json>) => input['all-worktrees'] === true || repeatedPaths(input.worktree).length > 0;

export async function runMultiTreeReview(
  input: Record<string, Json>,
  format: ReviewFormat,
  context: InvocationContext,
  services: ModServices,
  runTree: TreeRunner,
): Promise<CommandResult> {
  const refuse = (message: string): CommandResult => ({ exitCode: 1, stderr: `${message}\n` });
  if (input.mutate === true) return refuse('Refusing to review several trees with --mutate: each tree would run its own mutation pass and the results would be lost from the merged report. Review the trees, then run agon mutate --diff <target> in each tree separately.');
  const config = context.config as Record<string, Json> | undefined;
  const maxTrees = positiveOption(input['max-trees'], config?.reviewMaxTrees, DEFAULT_MAX_TREES, '--max-trees');
  if (typeof maxTrees !== 'number') return refuse(maxTrees.error);
  const deadlineSeconds = text(input.deadline) ? positiveOption(input.deadline, undefined, 1, '--deadline') : undefined;
  if (typeof deadlineSeconds === 'object') return refuse(deadlineSeconds.error);
  let diffLimit: number | { error: string };
  try { diffLimit = positiveOption(input['max-diff-chars'], reviewMaxDiffChars(context.config), 1, '--max-diff-chars'); }
  catch (error) { return refuse(error instanceof Error ? error.message : String(error)); }
  if (typeof diffLimit !== 'number') return refuse(diffLimit.error);

  const selected = selectTrees(input, context.cwd);
  if ('error' in selected) return refuse(selected.error);
  const extra = loadExtraContext(input, context);
  if (extra && 'error' in extra) return refuse(extra.error);

  const warnings = [...selected.warnings];
  const plans = planBases(selected.trees, text(input.target), text(input.base), warnings);
  resolveDiffs(plans);
  if (input.split !== true) {
    const oversized = refuseOversized(plans, diffLimit);
    if (oversized) return refuse(oversized);
  }
  const reviewable = plans.filter(plan => plan.status === 'pending');
  if (reviewable.length > maxTrees) {
    return refuse(`Refusing to review ${reviewable.length} trees: over the limit of ${maxTrees}, and each tree spends a full panel. Trees: ${reviewable.map(plan => plan.path).join(', ')}. Raise the limit with --max-trees ${reviewable.length} or select fewer trees.`);
  }
  const { conflicts, overlaps } = crossCheck(plans, warnings);

  process.stderr.write(`agon review: ${plans.length} tree(s) selected, ${reviewable.length} to review, each with the full routed panel\n`);
  const treeInput = Object.fromEntries(Object.entries(input).filter(([name]) => !TREE_FLAGS.includes(name)));
  const startedAtMs = Date.now();
  const run = await services.runs?.start('review', text(input.label) || undefined, context);
  const reports: Array<TreeReport & { tree: string }> = [];
  let blocked = false;
  for (const plan of reviewable) {
    const remaining = deadlineSeconds === undefined ? undefined : Math.ceil(deadlineSeconds - (Date.now() - startedAtMs) / 1000);
    if (context.signal.aborted || (remaining !== undefined && remaining < 1)) {
      plan.status = 'skipped';
      plan.error = context.signal.aborted ? 'review was aborted before this tree' : 'review deadline passed before this tree';
      continue;
    }
    let outcome: CommandResult;
    try {
      outcome = await runTree({
        ...treeInput,
        ...(plan.target ? { target: plan.target } : {}), ...(plan.base ? { base: plan.base } : {}),
        format: 'json', quiet: false,
        ...(remaining !== undefined ? { deadline: String(remaining) } : {}),
      }, { ...context, cwd: plan.path }, extra);
    } catch (error) {
      plan.status = 'failed';
      plan.error = error instanceof Error ? error.message : String(error);
      continue;
    }
    const report = outcome.result as TreeReport | undefined;
    if (report) {
      reports.push({ ...report, tree: plan.path });
      warnings.push(...(report.warnings ?? []).map(warning => `${plan.path}: ${warning}`));
      plan.detail = {
        ...(report.runDir ? { runDir: report.runDir } : {}),
        ...(report.routing ? { routing: report.routing } : {}),
        ...(report.split ? { split: { batches: report.split.batches, ...(report.split.incomplete ? { incomplete: report.split.incomplete } : {}) } } : {}),
        blockers: report.consensus?.blockers.length ?? 0,
      };
    }
    if (outcome.exitCode === 1) {
      plan.status = 'failed';
      plan.error = outcome.stderr?.trim() || 'no reviewer produced evidence';
    } else {
      plan.status = 'ok';
      if (outcome.exitCode === 2) blocked = true;
    }
  }

  const incomplete = plans.filter(plan => plan.status === 'failed' || plan.status === 'skipped');
  for (const plan of incomplete) warnings.push(`${plan.path} was ${plan.status === 'failed' ? 'not usably reviewed' : 'not reviewed'}: ${plan.error}`);
  if (incomplete.length) warnings.push(`${incomplete.length} of ${plans.length} trees incomplete; the verdict does not cover every tree`);
  if (plans.every(plan => plan.status === 'empty')) warnings.push(`No diff found in any of the ${plans.length} selected trees; nothing was reviewed.`);
  const exitCode = incomplete.length ? 1 : blocked ? 2 : 0;

  const withConsensus = reports.filter(report => report.consensus);
  const merged = {
    target: text(input.target) || (text(input.base) ? `working tree vs ${text(input.base)}` : 'working tree vs merge-base with the default branch'),
    trees: plans.map(plan => ({
      tree: plan.path, status: plan.status,
      ...(plan.head ? { head: plan.head } : {}), ...(plan.base ? { base: plan.base } : {}),
      ...(plan.stackedOn ? { stackedOn: plan.stackedOn } : {}), ...(plan.sameAs ? { sameAs: plan.sameAs } : {}),
      ...(plan.diff !== undefined ? { diffChars: plan.diff.length } : {}),
      ...(plan.error ? { error: plan.error } : {}), ...plan.detail,
    })),
    conflicts,
    overlaps,
    ...(incomplete.length ? { incomplete: incomplete.length } : {}),
    engines: [...new Set(reports.flatMap(report => report.engines ?? []))],
    roles: Object.assign({}, ...reports.map(report => report.roles ?? {})) as Record<string, string>,
    reviews: reports.flatMap(report => (report.reviews ?? []).map(review => ({ ...review, tree: report.tree }))),
    findings: reports.flatMap(report => (report.findings ?? []).map(finding => ({ ...finding, tree: report.tree }))),
    consensus: mergeConsensus(withConsensus.map(report => tagConsensus(report.consensus!, report.tree)), index => withConsensus[index]!.tree),
    panelHealth: {
      requested: reports.reduce((sum, report) => sum + (report.panelHealth?.requested ?? 0), 0),
      responded: reports.reduce((sum, report) => sum + (report.panelHealth?.responded ?? 0), 0),
      degraded: incomplete.length > 0 || reports.some(report => report.panelHealth?.degraded),
    },
    ...extraContextReport(extra),
    warnings,
    ...(run ? { runDir: run.path } : {}),
  };
  const report = redactSecretsDeep(merged);
  if (run) {
    await services.runs!.writeArtifact(run, 'report.json', `${JSON.stringify(report, null, 2)}\n`, context);
    await services.runs!.finish(run, {
      mode: 'review', startedAt: run.startedAt, endedAt: new Date().toISOString(),
      engines: merged.reviews.map(review => {
        const seat = review as unknown as { engineId: string; status: string; error?: string };
        return { id: seat.engineId, status: seat.status, detail: seat.error || null };
      }),
      requested: merged.engines, timeoutSec: null,
      summary: `${reviewable.length} of ${plans.length} trees to review; ${merged.panelHealth.responded}/${merged.panelHealth.requested} seats produced machine-readable evidence${incomplete.length ? `; ${incomplete.length} trees incomplete` : ''}`,
      ok: exitCode === 0,
    }, context);
  }
  return {
    exitCode,
    stdout: input.quiet === true && format !== 'sarif'
      ? `${run ? `${run.path}\n` : ''}${formatSummaryLine(report as unknown as ReviewReport)}\n`
      : formatReport(report as unknown as ReviewReport, format, { verbose: input.verbose === true }),
    result: report as unknown as Json,
  };
}
