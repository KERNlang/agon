import { resolve, relative, isAbsolute, sep } from 'node:path';

export type TaskRisk = 'routine' | 'important' | 'dangerous';

export type TaskActionDecision = 'allow' | 'ask_task_once' | 'ask_boundary_once' | 'deny';

export type TaskHarnessProfile = 'legacy' | 'agentic';

/**
 * Normalize the REPL permission UI contract: y approves once, s approves for the session, a persists an allow rule, booleans pass through.
 */
export function isApprovedPermissionResponse(value: boolean|string): boolean {
  return (typeof value === 'string') ? (value === 'y' || value === 'a' || value === 's') : (value === true);
}

export interface TaskExecutionLease {
  input: string;
  autoMode: boolean;
  workspace: string;
  risk: TaskRisk;
  profile: TaskHarnessProfile;
  importantPattern: string;
  dangerousPattern: string;
  destructivePattern: string;
  taskApproved: boolean;
  approvedSignatures: Set<string>;
  promptedSignatures: Set<string>;
  approvalPromises: Map<string,Promise<boolean>>;
}

export interface TaskActionEvaluation {
  decision: TaskActionDecision;
  signature: string;
  reason: string;
}

/**
 * Describe the actual lease gate. AUTO-off routine writes are not dangerous and must not be labeled as dangerous boundaries. `ask_task_once` (the retired important-task prompt) is kept only so an old persisted evaluation still renders a sane label — evaluateTaskAction no longer produces it.
 */
export function taskActionApprovalMessage(evaluation: TaskActionEvaluation): string {
  if (evaluation.decision === 'ask_task_once') {
    return 'Approve this important task once';
  }
  if (evaluation.reason === 'auto_off') {
    return 'AUTO is off for this task — approve this action once';
  }
  if (evaluation.reason === 'workspace_escape') {
    return 'This action leaves the workspace — approve it once';
  }
  if (evaluation.reason === 'sensitive_path') {
    return 'This file is sensitive (secrets, keys, or git hooks) — approve this edit once';
  }
  return 'Approve this destructive action boundary';
}

export const DEFAULT_IMPORTANT_PATTERN: string = '\\b(auth|session|permission|migration|database|shared\\s+contract|public\\s+api|billing|security)\\b';

export const DEFAULT_DANGEROUS_PATTERN: string = '\\b(git\\s+push|push|deploy|publish|release|production|prod|pull\\s+request|create\\s+(?:a\\s+)?pr|external\\s+queue|drop\\s+database|reset\\s+--hard|force[- ]push|rm\\s+-rf)\\b';

export const DEFAULT_DESTRUCTIVE_PATTERN: string = ['git\\s+push\\b[^\\n]*?(?:\\s(?:--force(?:-with-lease)?|--delete|--mirror)\\b|\\s-[a-z]{0,3}f[a-z]{0,3}\\b|\\s-[a-z]{0,3}d[a-z]{0,3}\\b|\\s\\+[^\\s]+|\\s:[^\\s]+)', 'git\\s+reset\\b[^\\n]*\\s--hard\\b', 'git\\s+clean\\b[^\\n]*\\s(?:--force\\b|-[a-z]*f[a-z]*\\b)', '\\brm\\s+(?:-[a-z-]+\\s+)*-[a-z]*(?:rf|fr)[a-z]*(?:\\s|$)', '\\brm\\s+(?:-[a-z-]+\\s+)*(?:-[a-z]*r[a-z]*\\s+-[a-z]*f|-[a-z]*f[a-z]*\\s+-[a-z]*r)[a-z]*\\b', '\\brm\\s+[^\\n]*--recursive\\b[^\\n]*--force\\b|\\brm\\s+[^\\n]*--force\\b[^\\n]*--recursive\\b', '\\bdropdb\\b', '\\bdrop\\s+database\\b', '\\b(?:migrate|migration|db|database|schema)[\\s:]+reset\\b', '\\b(?:prisma|drizzle-kit|sequelize(?:-cli)?|knex|typeorm|alembic|flyway|liquibase|dbmate|atlas|supabase|psql|mysql|mongosh|rails)\\b[^\\n]*\\s--force\\b'].join('|');

export const GIT_GLOBAL_FLAG_PATTERN: RegExp = /\bgit(?:\s+(?:-C\s+\S+|-c\s+\S+|--git-dir(?:=\S*|\s+\S+)|--work-tree(?:=\S*|\s+\S+)|--namespace(?:=\S*|\s+\S+)|--config-env(?:=\S*|\s+\S+)|--attr-source(?:=\S*|\s+\S+)|--exec-path(?:=\S*)?|--no-pager|--paginate|--bare|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-optional-locks|--no-replace-objects|-p))+/gi;

export const LONG_FLAG_SHORT_ALIASES: Record<string,string> = { recursive: 'r', force: 'f', delete: 'd' };

/**
 * Canonicalize ONE simple command: git global flags stripped so the subcommand leads, long flags kept verbatim but also folded into their short letter, and all short flags merged into one deduplicated, sorted cluster right after the head.
 */
function normalizeCommandSegment(segment: string): string {
  const trimmed = String(segment ?? '').trim();
  if (!trimmed) return '';
  const tokens = trimmed.replace(GIT_GLOBAL_FLAG_PATTERN, 'git ').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';
  const headBase = (tokens[0].split('/').pop() ?? '').toLowerCase();
  const headLength = (headBase === 'git' && tokens.length > 1 && !tokens[1].startsWith('-')) ? 2 : 1;
  let letters = '';
  const longFlags: string[] = [];
  const operands: string[] = [];
  tokens.slice(headLength).forEach((token) => {
    if (/^--[a-z][a-z0-9-]*(?:=[\s\S]*)?$/i.test(token)) {
      letters += LONG_FLAG_SHORT_ALIASES[token.slice(2).split('=')[0].toLowerCase()] ?? '';
      longFlags.push(token);
    } else if (/^-[a-z]+$/i.test(token)) {
      letters += token.slice(1).toLowerCase();
    } else {
      operands.push(token);
    }
  });
  const parts = tokens.slice(0, headLength);
  const cluster = Array.from(new Set(letters.split(''))).sort().join('');
  if (cluster) parts.push('-' + cluster);
  return parts.concat(longFlags, operands).join(' ');
}

/**
 * Rewrite a shell command into the canonical spelling the destructive pattern is written against (per simple command: see normalizeCommandSegment), so `rm -r --force`, `rm --force -r` and `rm -rf` all reduce to `rm -fr` and `git -C dir push --force` reduces to `git push -f --force`. The result is a MATCHING PROBE, never something to execute — isDestructiveCommand tests the raw command too, so normalization can only ever add matches (fail-closed), never remove one. Single-dash long options of other tools (find -name) get folded into letters; harmless, because the raw pass is authoritative for them.
 */
export function normalizeDestructiveCommand(command: string): string {
  const raw = String(command ?? '');
  if (!raw.trim()) return '';
  return raw.split(/[\n;]+|&&|\|\||[|&]/).map(normalizeCommandSegment).filter(Boolean).join(' ; ');
}

export const DEFAULT_DESTRUCTIVE_REGEX: RegExp = new RegExp(DEFAULT_DESTRUCTIVE_PATTERN, 'i');

export const _destructiveRegexCache: Map<string,RegExp|null> = new Map<string, RegExp | null>();

function destructivePatternRegex(pattern?: string): RegExp {
  const source = String(pattern ?? '').trim();
  if (!source) return DEFAULT_DESTRUCTIVE_REGEX;
  if (_destructiveRegexCache.has(source)) return _destructiveRegexCache.get(source) ?? DEFAULT_DESTRUCTIVE_REGEX;
  let compiled: RegExp | null = null;
  try { compiled = new RegExp(source, 'i'); }
  catch { compiled = null; }
  // Bounded so a pathological config-churn loop cannot grow it without end.
  if (_destructiveRegexCache.size > 32) _destructiveRegexCache.clear();
  _destructiveRegexCache.set(source, compiled);
  return compiled ?? DEFAULT_DESTRUCTIVE_REGEX;
}

/**
 * Pure matcher for the destructive class that still prompts in permission mode auto (force push, remote branch deletion, git reset --hard, git clean -f/--force, rm -rf in every flag spelling, dropdb/drop database, migrate reset, --force on a db CLI). The command is matched BOTH raw and normalized (normalizeDestructiveCommand), so equivalent spellings — `git -C dir push --force`, `git --git-dir=… push -d`, `rm --recursive --force` — cannot slip through as routine. `pattern` overrides the default policy (config: cesarDestructiveActionPattern) and is matched the same two ways; an unparsable override falls back to the default instead of prompting on everything.
 */
export function isDestructiveCommand(command: string, pattern?: string): boolean {
  const text = String(command ?? '').trim();
  if (!text) return false;
  const regex = destructivePatternRegex(pattern);
  if (regex.test(text)) return true;
  const normalized = normalizeDestructiveCommand(text);
  return normalized !== text && regex.test(normalized);
}

export function canonicalTaskActionSignature(action: string, target: string): string {
  const normalizedAction = String(action ?? '').trim().toLowerCase();
  const fileMutation = ['edit', 'write', 'multiedit', 'notebookedit'].includes(normalizedAction.replace(/^agon/, ''));
  const normalizedTarget = String(target ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return `${normalizedAction}:${fileMutation ? normalizedTarget.replace(/\\/g, '/') : normalizedTarget}`;
}

export function createTaskExecutionLease(input: string, autoMode: boolean, workspace: string, patterns?: {important?:string,dangerous?:string,destructive?:string}, profile?: TaskHarnessProfile): TaskExecutionLease {
  const importantPattern = patterns?.important || DEFAULT_IMPORTANT_PATTERN;
  const dangerousPattern = patterns?.dangerous || DEFAULT_DANGEROUS_PATTERN;
  const destructivePattern = patterns?.destructive || DEFAULT_DESTRUCTIVE_PATTERN;
  const text = String(input ?? '');
  let risk: TaskRisk = 'routine';
  try {
    if (new RegExp(dangerousPattern, 'i').test(text)) risk = 'dangerous';
    else if (new RegExp(importantPattern, 'i').test(text)) risk = 'important';
  } catch {
    risk = 'important';
  }
  return {
    input: text,
    autoMode,
    workspace: resolve(workspace),
    risk,
    profile: profile ?? 'legacy',
    importantPattern,
    dangerousPattern,
    destructivePattern,
    taskApproved: false,
    approvedSignatures: new Set(),
    promptedSignatures: new Set(),
    approvalPromises: new Map(),
  };
}

function buildAuthorizationTokenCounts(clause: string, semanticPush: boolean): Map<string,number> {
  const tokens = new Map<string, number>();
  const normalizedClause = (semanticPush ? clause.replace(/\bforce-push\b/g, 'force push') : clause).replace(/\\/g, '/');
  for (const rawToken of normalizedClause.split(/[^a-z0-9._/-]+/)) {
    if (!rawToken) continue;
    let token = rawToken;
    if (semanticPush) {
      if (token === '-f' || token === '--force') token = 'force';
      else if (token === '--delete') token = 'delete';
      else if (token === '--force-with-lease') token = 'force-with-lease';
      else if (token.startsWith('-')) token = `option:${token.replace(/^-+/, '')}`;
    }
    if (token) tokens.set(token, (tokens.get(token) ?? 0) + 1);
  }
  if (semanticPush) {
    for (const rawRefspec of clause.split(/\s+/)) {
      const refspec = rawRefspec.replace(/^['"]|['"]$/g, '');
      if (refspec.startsWith('+')) tokens.set('force', (tokens.get('force') ?? 0) + 1);
      if (refspec.startsWith(':')) tokens.set('delete', (tokens.get('delete') ?? 0) + 1);
    }
  }
  return tokens;
}

export const CODE_FENCE_LINE: RegExp = /^\s*(?:`{3,}|~{3,})/;

export const DIFF_HEADER_LINE: RegExp = /^(?:diff --git |index [0-9a-f]{6,}|(?:---|\+\+\+) (?:a\/|b\/|\/dev\/null|[\w.~][^\s]*)|@@[^@]*@@)/;

export const DIFF_BODY_LINE: RegExp = /^(?:[+\- ]|\\ No newline)/;

export const QUOTED_LINE: RegExp = /^\s*>/;

export const HEADERLESS_DIFF_LINE: RegExp = /^[+-](?![\s+*-])/;

export const INDENTED_CODE_LINE: RegExp = /^(?:\t| {4,})\S/;

export const PASTE_MARKER_HINT: RegExp = /[\n`~>+\-\t]|^ {4,}\S/;

/**
 * Reduce a turn's text to the user's OWN prose before it can be read as an explicit authorization: fenced code blocks (``` / ~~~, an unterminated fence swallowing the rest), quote-prefixed lines (>), unified-diff regions (headers plus their bodies, or a bare +/- fragment line), and indented code / pasted file content are dropped. Inline code spans are deliberately KEPT — `run \`git push --force\`` is the user instructing, not pasting. Fails closed: dropped content can only remove authority, never add it.
 */
export function userAuthorizationProse(input: string): string {
  const text = String(input ?? '');
  if (!text || !PASTE_MARKER_HINT.test(text)) return text;
  // Stateful, order-dependent filter: fence/diff state carries across lines,
  // which Array.filter preserves because it walks the array in order.
  let fence: string | null = null;
  let inDiff = false;
  return text.split(/\r?\n/).filter((line) => {
    const fenceMatch = CODE_FENCE_LINE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[0].trim().charAt(0);
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      return false;
    }
    if (fence !== null) return false;
    if (QUOTED_LINE.test(line)) return false;
    if (DIFF_HEADER_LINE.test(line)) { inDiff = true; return false; }
    if (inDiff) {
      if (!line.trim() || DIFF_BODY_LINE.test(line)) return false;
      inDiff = false;
    }
    return !HEADERLESS_DIFF_LINE.test(line) && !INDENTED_CODE_LINE.test(line);
  }).join('\n');
}

/**
 * Did the user's OWN prose authorize this exact action+target? Token matching is word-boundary by construction (the clause tokenizer splits on non-token characters, so `pushing`/`pushover`/`repush` never authorize a `push`), and the turn text is stripped of pasted content first (userAuthorizationProse) so a destructive command quoted inside a code block or diff cannot pre-approve itself.
 */
export function taskExplicitlyAuthorizes(lease: TaskExecutionLease, action: string, target: string): boolean {
  const input = userAuthorizationProse(lease.input).toLowerCase();
  const normalizedAction = String(action ?? '').trim().toLowerCase();
  let actionToken = normalizedAction;
  let authorizationTarget = String(target ?? '').toLowerCase();
  let semanticShellBoundary = false;
  if (normalizedAction === 'push') {
    semanticShellBoundary = true;
  } else if (/^(?:agon)?(?:bash|shell)$/.test(normalizedAction)) {
    const trimmedTarget = authorizationTarget.trim();
    const gitPush = /^git\s+push(?:\s|$)/.exec(trimmedTarget);
    if (gitPush) {
      actionToken = 'push';
      semanticShellBoundary = true;
      authorizationTarget = trimmedTarget.slice(gitPush[0].length)
        .split(/\s+/)
        .filter((token) => token && token !== '-u' && token !== '--set-upstream')
        .join(' ');
    }
  }
  const positiveClauses = input
    .split(/(?:[.;,\n]+|\bbut\b|\bhowever\b|\bexcept\b|\bexcluding\b|\bother\s+than\b|\band\s+(?=(?:do\s+not|don['’]?t|never|without|no)\b))/)
    .filter((clause) => !/(?:^|\s)(?:do\s+not|don['’]?t|never|without|not)(?=\s|$)|(?:^|\s)no\s+(?:push|force|delete|touch|use|run|call)(?=\s|$)/.test(clause));
  const authorizingTokenSets: Array<Map<string, number>> = [];
  for (const clause of positiveClauses) {
    const tokens = buildAuthorizationTokenCounts(clause, semanticShellBoundary);
    if (tokens.has(actionToken)) authorizingTokenSets.push(tokens);
  }
  if (!actionToken || authorizingTokenSets.length === 0) return false;
  const targetTokenCounts = buildAuthorizationTokenCounts(authorizationTarget, semanticShellBoundary);
  const targetTokens = Array.from(targetTokenCounts.keys());
  if (targetTokens.length === 0) return true;
  for (const tokens of authorizingTokenSets) {
    let matches = true;
    for (const token of targetTokens) {
      const required = (targetTokenCounts.get(token) ?? 0) + (token === actionToken ? 1 : 0);
      if ((tokens.get(token) ?? 0) < required) { matches = false; break; }
    }
    if (matches) return true;
  }
  return false;
}

/**
 * Goal and Conquer use this action-level check for their explicit-user-only boundary; side effects are evaluated separately against the full delegation target. Reads the user's own prose only (pasted blocks/diffs stripped), so a `agon goal …` line inside a quoted README cannot request a run.
 */
export function taskExplicitlyRequestsAction(lease: TaskExecutionLease, action: string): boolean {
  const token = String(action ?? '').trim().toLowerCase();
  if (!token) return false;
  return buildAuthorizationTokenCounts(userAuthorizationProse(lease.input).toLowerCase(), false).has(token);
}

/**
 * Recognize a path.relative result that crosses the workspace root on either POSIX or Windows. The optional separator keeps the platform rule directly testable.
 */
export function relativePathEscapesWorkspace(rel: string, pathSeparator?: string): boolean {
  const separator = pathSeparator || sep;
  return rel === '..' || rel.startsWith(`..${separator}`) || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel);
}

/**
 * Bind every delegation field that can widen authority into one auditable lease target. External queues and external actions remain visible to the dangerous-boundary policy.
 */
export function buildTaskActionTarget(lease: TaskExecutionLease, primary: string, details?: Record<string,unknown>): string {
  const parts = [String(primary ?? '').trim()].filter(Boolean);
  const d = details ?? {};
  const queue = typeof d.queue === 'string' ? d.queue.trim() : '';
  if (queue) {
    const absoluteQueue = isAbsolute(queue) ? resolve(queue) : resolve(lease.workspace, queue);
    const rel = relative(lease.workspace, absoluteQueue);
    const external = relativePathEscapesWorkspace(rel);
    parts.push((external ? 'external queue ' : 'queue ') + queue);
  }
  for (const key of ['gate', 'builder', 'target', 'fitnessCmd'] as const) {
    const value = typeof d[key] === 'string' ? String(d[key]).trim() : '';
    if (value) parts.push(key + ' ' + value);
  }
  if (d.push === true) parts.push('push');
  if (d.pr === true) parts.push('pull request');
  return parts.join('\n');
}

/**
 * Canonical authority classifier for native, XML, eager, and mapped file-mutation tool names.
 */
export function isTaskFileMutationAction(action: string): boolean {
  const normalized = String(action ?? '').trim().toLowerCase().replace(/^agon/, '');
  return normalized === 'edit'
    || normalized === 'write'
    || normalized === 'multiedit'
    || normalized === 'notebookedit';
}

function targetEscapesWorkspace(lease: TaskExecutionLease, action: string, target: string): boolean {
  const candidate = String(target ?? '').trim();
  if (!candidate || !isTaskFileMutationAction(action)) return false;
  const absoluteTarget = isAbsolute(candidate) ? resolve(candidate) : resolve(lease.workspace, candidate);
  const rel = relative(lease.workspace, absoluteTarget);
  return relativePathEscapesWorkspace(rel);
}

/**
 * Best-effort shell boundary classifier for destructive/output-bearing commands. Redirection operators are padded outside quotes before tokenizing so glued forms (`echo x>/etc/hosts`, `&>`, `2>&1`) surface as standalone operators; the tokenizer drops '&', so fd duplications reduce to bare-digit targets and are skipped. Catches common file-mutating utilities, cp/mv/install destinations (incl. -t/--target-directory), tee targets, cwd changes that leave the workspace (bare cd goes to $HOME = outside), and ~ targets, without pretending to be a full shell parser. Unknown dynamic paths fail closed to the interactive boundary.
 */
export function shellMutationEscapesWorkspace(lease: TaskExecutionLease, command: string): boolean {
  const raw = String(command ?? '').trim();
  if (!raw) return false;
  const normalized = raw.replace(/"[^"]*"|'[^']*'|(&>>?|\d*>>?&?)/g, (match, op) => (op ? ` ${op} ` : match));
  const words = normalized.match(/"[^"]*"|'[^']*'|[^\s;&|]+/g)?.map((word) => word.replace(/^['"]|['"]$/g, '')) ?? [];
  const outside = (candidate: string): boolean => {
    const value = candidate.replace(/^\d*(?:>>?|<)\s*/, '').trim();
    if (!value || value === '/dev/null' || value === '/dev/stdout' || value === '/dev/stderr') return false;
    if (/^~/.test(value)) return true;
    if (/[`$*?{}]/.test(value)) return true;
    const absolute = isAbsolute(value) ? resolve(value) : resolve(lease.workspace, value);
    return relativePathEscapesWorkspace(relative(lease.workspace, absolute));
  };
  if (/(?:^|[;&|])\s*(?:cd|pushd)\s*(?:[;&|]|$)/.test(raw)) return true;
  const mutatesOperands = ['rm', 'rmdir', 'unlink', 'touch', 'mkdir', 'ln', 'truncate', 'chmod', 'chown'];
  for (let i = 0; i < words.length; i++) {
    const token = words[i];
    const base = token.split('/').pop()?.toLowerCase() ?? '';
    if (base === 'cd' || base === 'pushd') {
      let k = i + 1;
      while (k < words.length && words[k].startsWith('-')) k++;
      const target = words[k] ?? '';
      if (outside(target) && words.length > k + 1) return true;
    }
    if (mutatesOperands.includes(base)) {
      for (let j = i + 1; j < words.length; j++) {
        if (!words[j].startsWith('-') && outside(words[j])) return true;
      }
    }
    if (base === 'dd') {
      for (let j = i + 1; j < words.length; j++) {
        const of = /^of=(.*)$/.exec(words[j]);
        if (of && outside(of[1])) return true;
      }
    }
    if (['cp', 'mv', 'install'].includes(base)) {
      const rest = words.slice(i + 1);
      for (let j = 0; j < rest.length; j++) {
        const flagTarget = /^--target-directory=(.+)$/.exec(rest[j]);
        if (flagTarget && outside(flagTarget[1])) return true;
        if ((rest[j] === '-t' || rest[j] === '--target-directory') && rest[j + 1] && outside(rest[j + 1])) return true;
      }
      const operands = rest.filter((word) => !word.startsWith('-'));
      if (operands.length >= 2 && outside(operands[operands.length - 1])) return true;
    }
    if (base === 'tee') {
      const target = words.slice(i + 1).find((word) => !word.startsWith('-'));
      if (target && outside(target)) return true;
    }
    if (/^\d*>>?$/.test(token)) {
      const target = words[i + 1] ?? '';
      if (/^\d+$/.test(target)) continue;
      if (outside(target)) return true;
    }
  }
  return false;
}

/**
 * Classify shell network/publishing actions that can change systems outside the workspace. Read-only HTTP GETs remain routine. The curl short-flag check is case-sensitive on purpose: `-F`/`-d`/`-T` mutate (glued or spaced), while `-f`/`-t` and friends like `-fsSL` are read-only.
 */
export function isExternalSideEffectCommand(command: string): boolean {
  const cmd = String(command ?? '').trim();
  return /\b(?:git\s+push|npm\s+publish|pnpm\s+publish|yarn\s+npm\s+publish|gh\s+pr\s+create|gh\s+release\s+create)\b/i.test(cmd)
    || (/\bcurl\b/i.test(cmd) && (
      /-X\s*(?:POST|PUT|PATCH|DELETE)\b|--request[\s=]+(?:POST|PUT|PATCH|DELETE)\b|(?:^|\s)--(?:data(?:-[a-z-]+)?|form(?:-string)?|upload-file)(?:\s|=)/i.test(cmd)
      || /(?:^|\s)-[dFT]\S*/.test(cmd)
    ))
    || /\bwget\b[^\n]*(?:--post-data|--post-file|--method\s*=\s*(?:POST|PUT|PATCH|DELETE))/i.test(cmd);
}

/**
 * Lease-level destructive classifier. File-mutation tools are exempt by construction (their target is a path, and containment is enforced separately by targetEscapesWorkspace) — the destructive class is Bash/external-side-effect-only, which is exactly what lets mode auto-edit approve contained edits without inheriting a boundary ask. The `push` pseudo-action is normalized back to `git push <target>` so a delegated `+ref`/`--delete` refspec is classified like the shell form.
 */
export function isDestructiveTaskAction(lease: TaskExecutionLease, action: string, target: string): boolean {
  if (isTaskFileMutationAction(action)) return false;
  const normalizedAction = String(action ?? '').trim().toLowerCase().replace(/^agon/, '');
  const rawTarget = String(target ?? '');
  let probe = `${normalizedAction} ${rawTarget}`;
  if (/^(?:bash|shell)$/.test(normalizedAction)) probe = rawTarget;
  else if (normalizedAction === 'push') probe = `git push ${rawTarget}`;
  return isDestructiveCommand(probe, lease.destructivePattern);
}

/**
 * Shell counterpart of targetEscapesWorkspace: a Bash command whose writes land outside the workspace. Still a boundary in mode auto (an escape is the one thing bypassPermissions cannot infer consent for), while ordinary in-workspace shell work runs free.
 */
export function isShellWorkspaceEscape(lease: TaskExecutionLease, action: string, target: string): boolean {
  const normalizedAction = String(action ?? '').trim().toLowerCase().replace(/^agon/, '');
  if (!/^(?:bash|shell)$/.test(normalizedAction)) return false;
  return shellMutationEscapesWorkspace(lease, target);
}

// ── Module: TaskAuthorization ──

/**
 * Claude-Code-parity task boundary. With AUTO on (permission mode auto, or a one-shot /auto <task>) the lease no longer prompts merely because the user's prompt text mentioned auth/session/database (`important_task` is retired) or because the action is a plain push/publish/deploy (the old broad `dangerous_boundary` is retired). What remains interactive: the narrow destructive class (isDestructiveTaskAction) and workspace escapes (file target or shell write). With AUTO off every mutation still asks once (`auto_off`). `escapesMayAsk` (set by the resolver ONLY in permission mode auto) turns the out-of-workspace file-target deny into an ask so the user can consent instead of watching the turn dead-end; it also lets an already-approved escape signature through, which is why the deny is evaluated first when the flag is off. `mandatoryAsk` carries a decision the RESOLVER already made (e.g. a sensitive-path ask, which the lease knows nothing about): the lease may still deny or honor a recorded approval, but it can never re-derive that ask back down to an allow.
 */
export function evaluateTaskAction(lease: TaskExecutionLease, action: string, target: string, options?: {hardDeny?:boolean,prohibited?:boolean,escapesMayAsk?:boolean,mandatoryAsk?:boolean,mandatoryAskReason?:string}): TaskActionEvaluation {
  const signature = canonicalTaskActionSignature(action, target);
  if (options?.hardDeny || options?.prohibited) return { decision: 'deny', signature, reason: 'hard_deny' };
  const targetEscapes = targetEscapesWorkspace(lease, action, target);
  if (targetEscapes && options?.escapesMayAsk !== true) return { decision: 'deny', signature, reason: 'workspace_escape' };
  if (lease.approvedSignatures.has(signature)) return { decision: 'allow', signature, reason: 'boundary_approved' };
  if (targetEscapes) return { decision: 'ask_boundary_once', signature, reason: 'workspace_escape' };
  const destructive = isDestructiveTaskAction(lease, action, target);
  const shellEscape = isShellWorkspaceEscape(lease, action, target);
  if (destructive || shellEscape) {
    if (lease.autoMode && taskExplicitlyAuthorizes(lease, action, target)) return { decision: 'allow', signature, reason: 'explicit_authority' };
    // The reason is reported even with AUTO off (instead of the generic
    // auto_off) so the resolver recognizes it as a real boundary and no
    // blunt allow source — or the redirection-stripping read-only command
    // classifier — can absorb a force push or an out-of-workspace write.
    return { decision: 'ask_boundary_once', signature, reason: destructive ? 'destructive_boundary' : 'workspace_escape' };
  }
  // A resolver-stage ask outranks every remaining allow branch below. It is
  // checked AFTER approvedSignatures (an approval must still stick) and
  // after the destructive/escape class (the more specific reason wins).
  if (options?.mandatoryAsk === true) {
    return { decision: 'ask_boundary_once', signature, reason: options.mandatoryAskReason || 'resolver_ask' };
  }
  if (!lease.autoMode) return { decision: 'ask_boundary_once', signature, reason: 'auto_off' };
  return { decision: 'allow', signature, reason: 'routine_auto' };
}

/**
 * Resolve one task-lease decision before an authority-bearing tool can execute. This sits above tool-specific auto-allow rules so native, API, companion, and eager adapters cannot bypass the task boundary. `options` is threaded to every evaluateTaskAction call so the mode-auto escape ask reaches the join/claim machinery instead of re-deriving a raw deny, and so a resolver-stage ask (`mandatoryAsk`) cannot be downgraded to an allow by the re-derivation.
 */
export async function authorizeTaskAction(lease: TaskExecutionLease|undefined, action: string, target: string, requestApproval: (evaluation:TaskActionEvaluation)=>Promise<boolean>, options?: {escapesMayAsk?:boolean,mandatoryAsk?:boolean,mandatoryAskReason?:string}): Promise<TaskActionEvaluation> {
  if (!lease) {
    return { decision: 'allow', signature: canonicalTaskActionSignature(action, target), reason: 'no_task_lease' };
  }
  const evaluation = evaluateTaskAction(lease, action, target, options);
  if (evaluation.decision === 'allow' || evaluation.decision === 'deny') return evaluation;
  const pendingApproval = lease.approvalPromises.get(evaluation.signature);
  if (pendingApproval) {
    const approved = await pendingApproval;
    if (!approved) return { ...evaluation, decision: 'deny', reason: 'user_denied' };
    approveTaskAction(lease, action, target);
    return { ...evaluateTaskAction(lease, action, target, options), reason: 'joined_user_approval' };
  }
  if (!claimTaskActionPrompt(lease, evaluation.signature)) {
    return { ...evaluation, decision: 'deny', reason: 'duplicate_or_declined_boundary' };
  }
  const approvalPromise = requestApproval(evaluation);
  lease.approvalPromises.set(evaluation.signature, approvalPromise);
  let approved = false;
  try { approved = await approvalPromise; }
  finally { lease.approvalPromises.delete(evaluation.signature); }
  if (!approved) return { ...evaluation, decision: 'deny', reason: 'user_denied' };
  approveTaskAction(lease, action, target);
  return { ...evaluateTaskAction(lease, action, target, options), reason: 'user_approved' };
}

export function claimTaskActionPrompt(lease: TaskExecutionLease, signature: string): boolean {
  if (!signature || lease.promptedSignatures.has(signature)) return false;
  lease.promptedSignatures.add(signature);
  return true;
}

/**
 * Record one approved boundary. `taskApproved` no longer gates anything (the important-task prompt is retired) but is still tracked so an in-flight turn and the harness replay ledger can tell an approved task apart from an untouched one.
 */
export function approveTaskAction(lease: TaskExecutionLease, action: string, target: string): void {
  const signature = canonicalTaskActionSignature(action, target);
  lease.approvedSignatures.add(signature);
  if (lease.risk === 'important' && !isDestructiveTaskAction(lease, action, target)) lease.taskApproved = true;
}

