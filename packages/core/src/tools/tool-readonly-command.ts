export const READONLY_COMMANDS: Set<string> = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'file', 'stat', 'pwd', 'echo', 'printf', 'date', 'which', 'whereis', 'type', 'find', 'grep', 'rg', 'ag', 'fd', 'git status', 'git log', 'git diff', 'git branch', 'git show', 'git blame', 'npx tsc', 'node --version', 'npm --version', 'python --version', 'agon --help', 'agon config --help', 'agon config list', 'agon config get', 'tree', 'du', 'df']);

/** Repo code runs, so these need permission, but a run is not a workspace edit for task-state accounting. */
const TEST_RUNNER_COMMANDS: readonly string[] = ['npm test', 'npm run test', 'npx vitest'];

interface UnsafeFlagPolicy {
  /** Matched whole, for tools with single-dash long options such as find. */
  words?: readonly string[];
  /** Also matched in the `--name=value` and abbreviated `--na` forms getopt accepts. */
  long?: readonly string[];
  /** Letters matched anywhere in a short-option cluster such as `-Hx`. */
  short?: string;
  /** Without one of these flags, a positional argument makes the command write. */
  operandsRequire?: readonly string[];
  /** Every positional argument must start with this, as in `date +%s`. */
  operandPrefix?: string;
  /** Closed argument list: anything else is unsafe, and `required` must be present. */
  exact?: { required: string; flags: readonly string[]; valueFlags: readonly string[] };
}

const GIT_DIFF_POLICY: UnsafeFlagPolicy = { long: ['--output', '--ext-diff', '--textconv', '--show-signature'] };

const UNSAFE_READONLY_FLAGS:Readonly<Record<string, UnsafeFlagPolicy>> = {
  find: { words: ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls'] },
  fd: { long: ['--exec', '--exec-batch'], short: 'xX' },
  rg: { long: ['--pre', '--hostname-bin'] },
  ag: { long: ['--pager'], short: 'p' },
  tree: { short: 'o' },
  file: { long: ['--compile'], short: 'C' },
  date: { long: ['--set'], short: 's', operandPrefix: '+' },
  'npx tsc': { exact: { required: '--noEmit', flags: ['--noEmit', '--pretty', '--skipLibCheck'], valueFlags: ['-p', '--project'] } },
  'git log': GIT_DIFF_POLICY,
  'git diff': GIT_DIFF_POLICY,
  'git show': GIT_DIFF_POLICY,
  'git blame': { long: ['--textconv'] },
  'git branch': {
    long: ['--delete', '--move', '--copy', '--force', '--track', '--set-upstream-to', '--unset-upstream', '--edit-description'],
    short: 'dDmMcCfut',
    operandsRequire: ['--list', '-l', '--merged', '--no-merged', '--contains', '--no-contains', '--points-at'],
  },
};

const SHELL_WRAPPERS: ReadonlySet<string> = new Set(['timeout', 'time', 'nice', 'nohup', 'env', 'command']);

const EXPANSION_START = /[A-Za-z0-9_@*#?!$-]/;

const SAFE_OUTPUT_TARGET = /^(?:[ \t]*\/dev\/null|&(?:\d+|-))(?=[\s;|&]|$)/;

const SAFE_INPUT_TARGET = /^(?:[ \t]*[\w./~@%+:,=][\w./~@%+:,=-]*|&(?:\d+|-))(?=[\s;|&]|$)/;

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
      if (next === '(' || next === '{' || next === '[') return null;
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
    } else if (ch === '`' || ch === '\n' || ch === '\r' || ch === '(' || ch === ')' || (ch === '#' && !inWord)) {
      return null;
    } else if (ch === '>' || (ch === '&' && next === '>')) {
      let after = ch === '>' ? i + 1 : i + 2;
      if (command[after] === '>') after++;
      const target = SAFE_OUTPUT_TARGET.exec(command.slice(after));
      if (!target) return null;
      endRedirectSource();
      i = after + target[0].length;
    } else if (ch === '<') {
      const target = SAFE_INPUT_TARGET.exec(command.slice(i + 1));
      if (!target) return null;
      endRedirectSource();
      i += 1 + target[0].length;
    } else if (ch === ';' || ch === '|' || ch === '&') {
      if (!endSegment()) return null;
      i += ch !== ';' && (next === ch || (ch === '|' && next === '&')) ? 2 : 1;
    } else if (ch === ' ' || ch === '\t') {
      endWord();
      i++;
    } else {
      if (ch === '$') {
        if (next !== undefined && '({["\''.includes(next)) return null;
        if (next !== undefined && EXPANSION_START.test(next)) hasExpansion = true;
      }
      if ('{*?['.includes(ch)) hasExpansion = true;
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
  const operands = args.filter((arg) => !arg.startsWith('-'));
  const { operandPrefix, operandsRequire } = policy;
  if (operandPrefix !== undefined && !operands.every((operand) => operand.startsWith(operandPrefix))) return false;
  if (!operandsRequire || operands.length === 0) return true;
  return args.some((arg) => operandsRequire.includes(arg.split('=', 1)[0]));
}

function matchesExactArgs(args: readonly string[], exact: NonNullable<UnsafeFlagPolicy['exact']>): boolean {
  if (!args.includes(exact.required)) return false;
  for (let i = 0; i < args.length; i++) {
    if (exact.flags.includes(args[i])) continue;
    if (!exact.valueFlags.includes(args[i])) return false;
    i++;
    if (args[i] === undefined || args[i].startsWith('-')) return false;
  }
  return true;
}

function unwrapArgv(words: string[]): string[] | null {
  if (!SHELL_WRAPPERS.has(words[0])) return words;
  return words[1]?.startsWith('-') ? null : words.slice(1);
}

function argvStartsWith(argv: readonly string[], commandWords: readonly string[]): boolean {
  return commandWords.every((word, index) => argv[index] === word);
}

function isReadOnlySegment({ words, hasExpansion }: ShellSegment): boolean {
  const argv = unwrapArgv(words);
  if (!argv) return false;
  for (const safe of READONLY_COMMANDS) {
    const safeWords = safe.split(' ');
    if (!argvStartsWith(argv, safeWords)) continue;
    const policy = UNSAFE_READONLY_FLAGS[safe];
    if (!policy) return true;
    if (hasExpansion) return false;
    const args = argv.slice(safeWords.length);
    if (policy.exact) return matchesExactArgs(args, policy.exact);
    return !hasUnsafeFlag(args, policy) && operandsAllowed(args, policy);
  }
  return false;
}

function isTestRunnerSegment({ words }: ShellSegment): boolean {
  const argv = unwrapArgv(words);
  return argv !== null && TEST_RUNNER_COMMANDS.some((runner) => argvStartsWith(argv, runner.split(' ')));
}

export function isReadOnlyCommand(command: string): boolean {
  const segments = scanShellCommand(command.trim());
  return segments !== null && segments.every(isReadOnlySegment);
}

/** For effect accounting only, never for permission: a test run needs a prompt but does not count as a workspace edit. */
export function isNonMutatingCommand(command: string): boolean {
  const segments = scanShellCommand(command.trim());
  return segments !== null && segments.every((segment) => isReadOnlySegment(segment) || isTestRunnerSegment(segment));
}
