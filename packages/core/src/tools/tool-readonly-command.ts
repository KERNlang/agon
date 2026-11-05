export const READONLY_COMMANDS: Set<string> = new Set(['ls', 'cat', 'head', 'tail', 'less', 'more', 'wc', 'file', 'stat', 'pwd', 'echo', 'printf', 'date', 'which', 'whereis', 'type', 'find', 'grep', 'rg', 'ag', 'fd', 'fzf', 'git status', 'git log', 'git diff', 'git branch', 'git show', 'git blame', 'npm test', 'npm run test', 'npx vitest', 'npx tsc', 'node --version', 'npm --version', 'python --version', 'agon --help', 'agon config --help', 'agon config list', 'agon config get', 'tree', 'du', 'df']);

interface UnsafeFlagPolicy {
  /** Matched whole, for tools with single-dash long options such as find. */
  words?: readonly string[];
  /** Also matched in the `--name=value` and abbreviated `--na` forms getopt accepts. */
  long?: readonly string[];
  /** Letters matched anywhere in a short-option cluster such as `-Hx`. */
  short?: string;
  /** Without one of these flags, a positional argument makes the command write. */
  operandsRequire?: readonly string[];
}

const GIT_DIFF_POLICY: UnsafeFlagPolicy = { long: ['--output', '--ext-diff'] };

const UNSAFE_READONLY_FLAGS:Readonly<Record<string, UnsafeFlagPolicy>> = {
  find: { words: ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls'] },
  fd: { long: ['--exec', '--exec-batch'], short: 'xX' },
  rg: { long: ['--pre', '--hostname-bin'] },
  ag: { long: ['--pager'] },
  fzf: { long: ['--bind', '--preview', '--history', '--listen', '--with-shell'] },
  less: { long: ['--log-file', '--LOG-FILE'], short: 'oO' },
  tree: { short: 'o' },
  file: { long: ['--compile'], short: 'C' },
  date: { long: ['--set'], short: 's' },
  'git log': GIT_DIFF_POLICY,
  'git diff': GIT_DIFF_POLICY,
  'git show': GIT_DIFF_POLICY,
  'git branch': {
    long: ['--delete', '--move', '--copy', '--force', '--track', '--set-upstream-to', '--unset-upstream', '--edit-description'],
    short: 'dDmMcCfut',
    operandsRequire: ['--list', '-l', '--merged', '--no-merged', '--contains', '--no-contains', '--points-at'],
  },
};

const SHELL_WRAPPERS: ReadonlySet<string> = new Set(['timeout', 'time', 'nice', 'nohup', 'env', 'command']);

const EXPANSION_START = /[A-Za-z0-9_{@*#?!$-]/;

const SAFE_OUTPUT_TARGET = /^(?:[ \t]*\/dev\/null|&(?:\d+|-))(?=[\s;|&]|$)/;

interface ShellSegment {
  words: string[];
  hasExpansion: boolean;
}

interface DoubleQuotedText {
  text: string;
  end: number;
  hasExpansion: boolean;
}

function scanDoubleQuoted(command: string, start: number): DoubleQuotedText | null {
  let text = '';
  let hasExpansion = false;
  for (let i = start + 1; i < command.length; i++) {
    const ch = command[i];
    const next = command[i + 1];
    if (ch === '"') return { text, end: i + 1, hasExpansion };
    if (ch === '`') return null;
    if (ch === '\\') {
      if (next === undefined || next === '\n' || next === '\r') return null;
      text += '$`"\\'.includes(next) ? next : ch + next;
      i++;
      continue;
    }
    if (ch === '$' && next !== undefined) {
      if (next === '(') return null;
      if (EXPANSION_START.test(next)) hasExpansion = true;
    }
    text += ch;
  }
  return null;
}

function scanShellCommand(command: string): ShellSegment[] | null {
  const segments: ShellSegment[] = [];
  let words: string[] = [];
  let word = '';
  let inWord = false;
  let wordQuoted = false;
  let hasExpansion = false;

  const endWord = (): void => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
    wordQuoted = false;
  };
  const endRedirectSource = (): void => {
    if (!wordQuoted && /^\d+$/.test(word)) {
      word = '';
      inWord = false;
    }
    endWord();
  };
  const endSegment = (): boolean => {
    endWord();
    if (words.length === 0) return false;
    segments.push({ words, hasExpansion });
    words = [];
    hasExpansion = false;
    return true;
  };

  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    const next = command[i + 1];

    if (ch === "'") {
      const close = command.indexOf("'", i + 1);
      if (close < 0) return null;
      word += command.slice(i + 1, close);
      inWord = wordQuoted = true;
      i = close + 1;
    } else if (ch === '"') {
      const quoted = scanDoubleQuoted(command, i);
      if (!quoted) return null;
      word += quoted.text;
      hasExpansion ||= quoted.hasExpansion;
      inWord = wordQuoted = true;
      i = quoted.end;
    } else if (ch === '\\') {
      if (next === undefined || next === '\n' || next === '\r') return null;
      word += next;
      inWord = wordQuoted = true;
      i += 2;
    } else if (ch === '`' || ch === '\n' || ch === '\r' || ch === '(' || ch === ')') {
      return null;
    } else if (ch === '>' || (ch === '&' && next === '>')) {
      let after = ch === '>' ? i + 1 : i + 2;
      if (command[after] === '>') after++;
      const target = SAFE_OUTPUT_TARGET.exec(command.slice(after));
      if (!target) return null;
      endRedirectSource();
      i = after + target[0].length;
    } else if (ch === '<') {
      if (next === '(' || next === '>') return null;
      endRedirectSource();
      i++;
      while (command[i] === '<') i++;
      if (command[i] === '&') i++;
    } else if (ch === ';' || ch === '|' || ch === '&') {
      if (!endSegment()) return null;
      i += ch !== ';' && (next === ch || (ch === '|' && next === '&')) ? 2 : 1;
    } else if (ch === ' ' || ch === '\t') {
      endWord();
      i++;
    } else {
      if (ch === '$') {
        // ANSI-C $'...' has its own escape rules, so quote tracking cannot follow it.
        if (next === '(' || next === "'") return null;
        if (next !== undefined && EXPANSION_START.test(next)) hasExpansion = true;
      }
      if (ch === '{') hasExpansion = true;
      word += ch;
      inWord = true;
      i++;
    }
  }
  return endSegment() ? segments : null;
}

function matchesLongFlag(arg: string, flag: string): boolean {
  if (!arg.startsWith('--') || arg.length <= 2) return false;
  const name = arg.split('=', 1)[0];
  return flag.startsWith(name);
}

function hasUnsafeFlag(args: readonly string[], policy: UnsafeFlagPolicy): boolean {
  return args.some((arg) =>
    policy.words?.includes(arg)
    || policy.long?.some((flag) => matchesLongFlag(arg, flag))
    || (policy.short !== undefined && /^-[^-]/.test(arg) && [...arg.slice(1)].some((letter) => policy.short!.includes(letter))));
}

function operandsAllowed(args: readonly string[], policy: UnsafeFlagPolicy): boolean {
  const required = policy.operandsRequire;
  if (!required || args.every((arg) => arg.startsWith('-'))) return true;
  return args.some((arg) => required.includes(arg.split('=', 1)[0]));
}

function isReadOnlySegment({ words, hasExpansion }: ShellSegment): boolean {
  let argv = words;
  if (SHELL_WRAPPERS.has(argv[0])) {
    if (argv[1]?.startsWith('-')) return false;
    argv = argv.slice(1);
  }
  for (const safe of READONLY_COMMANDS) {
    const safeWords = safe.split(' ');
    if (!safeWords.every((safeWord, index) => argv[index] === safeWord)) continue;
    const policy = UNSAFE_READONLY_FLAGS[safe];
    if (!policy) return true;
    const args = argv.slice(safeWords.length);
    return !hasExpansion && !hasUnsafeFlag(args, policy) && operandsAllowed(args, policy);
  }
  return false;
}

export function isReadOnlyCommand(command: string): boolean {
  const segments = scanShellCommand(command.trim());
  return segments !== null && segments.every(isReadOnlySegment);
}
