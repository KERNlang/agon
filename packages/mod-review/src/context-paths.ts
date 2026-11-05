import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { InvocationContext, Json } from '@kernlang/agon-mod-api';
import { isSecretPath, redactSecretsPreservingLines } from '@kernlang/agon-support-verification';

export interface ExtraContext {
  readonly text: string;
  readonly files: readonly string[];
  readonly skipped: readonly { readonly path: string; readonly reason: string }[];
}

const DEFAULT_CONTEXT_MAX_CHARS = 40_000;
const BINARY_PROBE_BYTES = 8_000;
const MAX_BYTES_PER_CHAR = 4;
const LARGEST_NAMED = 5;

export type ReviewNotify = (message: string) => void;
export const stderrNotify: ReviewNotify = message => { process.stderr.write(message); };

export function positiveOption(raw: Json | undefined, configured: unknown, fallback: number, flag: string): number | { error: string } {
  const fromFlag = typeof raw === 'string' && raw.trim() !== '';
  const value = fromFlag ? Number((raw as string).trim()) : configured ?? fallback;
  return Number.isSafeInteger(value) && (value as number) >= 1 ? value as number : { error: `${flag} must be a positive integer.` };
}

export function repeatedPaths(raw: Json | undefined): string[] {
  if (typeof raw === 'string') return [raw];
  return Array.isArray(raw) ? raw.map(String) : [];
}

function fenced(content: string): string {
  const longestRun = Math.max(2, ...[...content.matchAll(/`+/g)].map(match => match[0].length));
  const fence = '`'.repeat(longestRun + 1);
  return `${fence}\n${content}\n${fence}`;
}

type Probed = { kind: 'binary' } | { kind: 'text'; content: string; chars: number } | { kind: 'oversized'; bytes: number };

function probe(real: string, remainingChars: number): Probed {
  const head = Buffer.alloc(BINARY_PROBE_BYTES);
  const fd = openSync(real, 'r');
  let read: number;
  try { read = readSync(fd, head, 0, head.length, 0); } finally { closeSync(fd); }
  if (head.subarray(0, read).includes(0)) return { kind: 'binary' };
  const size = statSync(real).size;
  if (size > remainingChars * MAX_BYTES_PER_CHAR) return { kind: 'oversized', bytes: size };
  const content = readFileSync(real, 'utf8');
  return content.includes('\u0000') ? { kind: 'binary' } : { kind: 'text', content, chars: content.length };
}

function trackedFiles(directory: string): { root: string; files: string[] } | null {
  try {
    const git = (args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 });
    return {
      root: realpathSync(git(['rev-parse', '--show-toplevel']).replace(/\r?\n$/, '')),
      files: git(['ls-files', '-z']).split('\0').filter(Boolean),
    };
  } catch {
    return null;
  }
}

/** Reads `--context` once, before any spend: every refusal here means no engine was called. */
export function loadExtraContext(input: Record<string, Json>, context: InvocationContext, notify: ReviewNotify = stderrNotify): ExtraContext | { error: string } | undefined {
  const requested = repeatedPaths(input.context);
  if (!requested.length) return undefined;
  const config = context.config as Record<string, Json> | undefined;
  const maxChars = positiveOption(input['context-max-chars'], config?.reviewContextMaxChars, DEFAULT_CONTEXT_MAX_CHARS, '--context-max-chars');
  if (typeof maxChars !== 'number') return maxChars;

  const display = (path: string) => {
    const inside = relative(context.cwd, path);
    return inside && !inside.startsWith('..') && !isAbsolute(inside) ? inside : path;
  };
  const skipped: { path: string; reason: string }[] = [];
  const included = new Map<string, { path: string; chars: number; bytes?: number; content?: string }>();
  let total = 0;
  const take = (path: string, real: string) => {
    if (included.has(real)) return;
    const probed = probe(real, maxChars - total);
    if (probed.kind === 'binary') { skipped.push({ path, reason: 'binary' }); return; }
    const chars = probed.kind === 'text' ? probed.chars : Math.ceil(probed.bytes / MAX_BYTES_PER_CHAR);
    total += chars;
    included.set(real, probed.kind === 'text' ? { path, chars, content: probed.content } : { path, chars, bytes: probed.bytes });
  };

  for (const raw of requested) {
    if (total > maxChars) break;
    if (!raw.trim()) return { error: '--context needs a path; got an empty value.' };
    const lexical = resolve(context.cwd, raw);
    let real: string;
    try { real = realpathSync(lexical); }
    catch { return { error: `--context path not found: ${raw}` }; }
    if (isSecretPath(lexical) || isSecretPath(real)) return { error: `Refusing --context ${raw}: it is a secret-named path. Nothing was sent.` };
    const stat = statSync(real);
    if (stat.isFile()) {
      try { take(display(lexical), real); }
      catch (error) { return { error: `--context file cannot be read: ${raw} (${error instanceof Error ? error.message : String(error)})` }; }
      continue;
    }
    if (!stat.isDirectory()) return { error: `--context path is not a file or directory: ${raw}` };
    const tracked = trackedFiles(real);
    if (!tracked) return { error: `Refusing --context ${raw}: it is a directory outside any git repo, so tracked files cannot be told from local ones. Name the files instead.` };
    if (!tracked.files.length) return { error: `Refusing --context ${raw}: the directory has no tracked files. Name the files instead.` };
    for (const file of tracked.files) {
      if (total > maxChars) break;
      const path = display(join(lexical, file));
      if (isSecretPath(file)) { skipped.push({ path, reason: 'secret-named' }); continue; }
      try {
        const target = realpathSync(join(real, file));
        const inRepo = relative(tracked.root, target);
        if (inRepo.startsWith('..') || isAbsolute(inRepo)) skipped.push({ path, reason: 'symlink leaves the repo' });
        else if (isSecretPath(target)) skipped.push({ path, reason: 'secret-named' });
        else if (!statSync(target).isFile()) skipped.push({ path, reason: 'not a regular file' });
        else take(path, target);
      } catch {
        skipped.push({ path, reason: 'unreadable' });
      }
    }
  }

  const files = [...included.values()];
  if (total > maxChars) {
    const largest = [...files].sort((a, b) => b.chars - a.chars).slice(0, LARGEST_NAMED)
      .map(file => `${file.path} (${file.bytes === undefined ? `${file.chars.toLocaleString('en-US')} chars` : `${file.bytes.toLocaleString('en-US')} bytes`})`).join(', ');
    return { error: `Refusing --context: at least ${total.toLocaleString('en-US')} chars, over the ${maxChars.toLocaleString('en-US')} limit, and context is never truncated. Reading stopped at the limit, so this list may be partial. Largest seen: ${largest}. Raise the limit to at least --context-max-chars ${total} or name fewer files.` };
  }

  const list = files.map(file => file.path);
  notify(`agon review --context: sending ${list.length} file(s) to every reviewer:\n${list.map(path => `  ${path}\n`).join('')}`);
  if (skipped.length) notify(`agon review --context: skipped ${skipped.length} file(s):\n${skipped.map(item => `  ${item.path} (${item.reason})\n`).join('')}`);
  return {
    files: list,
    skipped,
    text: files.map(file => `### ${JSON.stringify(file.path)}\n${fenced(redactSecretsPreservingLines(file.content ?? ''))}`).join('\n\n'),
  };
}

export function extraContextReport(extra: ExtraContext | undefined): Record<string, unknown> {
  if (!extra) return {};
  return { contextFiles: extra.files, ...(extra.skipped.length ? { contextSkipped: extra.skipped } : {}) };
}
