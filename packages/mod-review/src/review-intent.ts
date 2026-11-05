import type { Json } from '@kernlang/agon-mod-api';

const KNOWN_ROLES = new Set(['security', 'correctness', 'dryness', 'performance', 'overall']);
const CONNECTIVES = ['and', 'or', 'plus', 'with', 'it', 'this', 'that', 'them', 'changes', 'diff'];
const TARGET_PREFIXES = ['branch:', 'commit:', 'range:'];
const LIST_FLAGS: Readonly<Record<string, string>> = { '--worktree': 'worktree', '--context': 'context' };
const VALUE_FLAGS: Readonly<Record<string, string>> = { '--max-trees': 'max-trees', '--context-max-chars': 'context-max-chars' };
const FLAG_USAGE = '/review accepts --worktree <path>, --all-worktrees, --max-trees <n>, --context <path> and --context-max-chars <n>; use agon review for the rest.';

function tokenize(text: string): string[] | { error: string } {
  const tokens: string[] = [];
  let word = '';
  let started = false;
  let quote: '"' | "'" | undefined;
  for (const char of text) {
    if (char === quote) { quote = undefined; continue; }
    if (quote) { word += char; continue; }
    if (char === '"' || char === "'") { quote = char; started = true; continue; }
    if (/\s/.test(char)) {
      if (started) tokens.push(word);
      word = '';
      started = false;
      continue;
    }
    word += char;
    started = true;
  }
  if (quote) return { error: `Unclosed quote in /review. ${FLAG_USAGE}` };
  if (started) tokens.push(word);
  return tokens;
}

/** Without a flag token the text is returned untouched, so bare `/review` keeps its own word and comma parsing. */
function extractFlags(text: string): { rest: string; flags: Record<string, Json> } | { error: string } {
  if (!/(^|\s)["']?-/.test(text)) return { rest: text, flags: {} };
  const tokens = tokenize(text);
  if (!Array.isArray(tokens)) return tokens;
  const flags: Record<string, Json> = {};
  const rest: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith('-')) { rest.push(token); continue; }
    const equals = token.indexOf('=');
    const name = equals < 0 ? token : token.slice(0, equals);
    if (name === '--all-worktrees' && equals < 0) { flags['all-worktrees'] = true; continue; }
    const listKey = Object.hasOwn(LIST_FLAGS, name) ? LIST_FLAGS[name] : undefined;
    const valueKey = Object.hasOwn(VALUE_FLAGS, name) ? VALUE_FLAGS[name] : undefined;
    if (!listKey && !valueKey) return { error: `Unknown /review flag ${name}. ${FLAG_USAGE}` };
    const value = equals < 0 ? tokens[++index] : token.slice(equals + 1);
    if (!value) return { error: `/review ${name} needs a value. ${FLAG_USAGE}` };
    if (listKey) flags[listKey] = [...((flags[listKey] as string[] | undefined) ?? []), value];
    else flags[valueKey!] = value;
  }
  return { rest: rest.join(' '), flags };
}

export function parseReviewIntent(input: string) {
  if (!/^\/(?:review|cr)(?:\s|$)/i.test(input)) return undefined;
  const extracted = extractFlags(input.replace(/^\/(?:review|cr)\s*/i, ''));
  if ('error' in extracted) return { parseError: extracted.error };
  const parts = extracted.rest.split(/[\s,]+/).filter(Boolean);
  const engineIds: string[] = [];
  const roles: string[] = [];
  let target: string | undefined;
  let index = 0;
  let roleMode = false;
  if (/^(?:role|roles)$/i.test(parts[0] ?? '')) {
    roleMode = true;
    index = 1;
    while (index < parts.length && KNOWN_ROLES.has(parts[index]!.toLowerCase())) roles.push(parts[index++]!.toLowerCase());
  }
  for (; index < parts.length; index += 1) {
    const part = parts[index]!;
    const lower = part.toLowerCase();
    if (CONNECTIVES.includes(lower)) continue;
    if (lower === 'uncommitted' || TARGET_PREFIXES.some(prefix => lower.startsWith(prefix))) {
      target ??= part;
      continue;
    }
    if (!engineIds.includes(lower)) engineIds.push(lower);
  }
  return {
    ...(roleMode ? { type: 'review-role' } : {}),
    ...(engineIds.length ? { engineId: engineIds[0], engineIds } : {}),
    ...(target ? { target } : {}),
    ...(roles.length ? { roles } : {}),
    ...extracted.flags,
  };
}

export function reviewIntentInput(parsed: Record<string, Json>): Record<string, Json> {
  const multiTree = parsed['all-worktrees'] === true || Array.isArray(parsed.worktree);
  return {
    ...(typeof parsed.target === 'string' ? { target: parsed.target } : {}),
    ...(Array.isArray(parsed.engineIds) ? { engines: parsed.engineIds.join(',') }
      : typeof parsed.engineId === 'string' ? { engine: parsed.engineId } : {}),
    ...(Array.isArray(parsed.roles) ? { roles: parsed.roles.join(',') } : {}),
    ...(multiTree || Array.isArray(parsed.context) ? { format: 'text' } : {}),
    ...Object.fromEntries(['worktree', 'all-worktrees', 'max-trees', 'context', 'context-max-chars']
      .filter(key => parsed[key] !== undefined).map(key => [key, parsed[key]!])),
  };
}
