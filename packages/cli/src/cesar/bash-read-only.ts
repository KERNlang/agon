const SAFE_REDIRECT = /^&?(?:>>?\s*\/dev\/null|>&[12])(?=[\s;|&]|$)/;
const SED_PRINT_SCRIPT = /^(?:\d+|\$)?(?:,(?:\d+|\$))?p$/;

const READ_ONLY_VERBS = new Map<string, RegExp | null>([
  ...['basename', 'cat', 'cd', 'cmp', 'cut', 'df', 'diff', 'dirname', 'du', 'echo', 'egrep', 'false', 'fgrep', 'grep', 'head', 'id', 'jq', 'ls', 'nl', 'printenv', 'printf', 'pwd', 'readlink', 'realpath', 'stat', 'tac', 'tail', 'tr', 'true', 'uname', 'wc', 'which', 'whoami'].map((verb): [string, null] => [verb, null]),
  ['fd', /^(?:-[a-zA-Z]*[xX]|--exec)/],
  ['file', /^(?:-[a-zA-Z]*C|--compile)/],
  ['find', /^-(?:delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/],
  ['rg', /^--(?:pre|hostname-bin)/],
  ['sort', /^(?:-[a-zA-Z]*o|--output|--compress)/],
  ['tree', /^-o$/],
]);

const GIT_READ_ONLY = new Map<string, { deny?: RegExp; only?: RegExp }>([
  ...['blame', 'diff', 'log', 'ls-files', 'rev-parse', 'show', 'status'].map((sub): [string, { deny: RegExp }] => [sub, { deny: /^--(?:output|ext-diff)/ }]),
  ['branch', { only: /^(?:-a|-r|-v|-vv|--all|--list|--remotes|--show-current)$/ }],
  ['remote', { only: /^-v$/ }],
  ['tag', { only: /^(?:-l|--list)$/ }],
]);

function splitSimpleCommands(command: string): string[][] | null {
  const commands: string[][] = [[]];
  let word = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  const endWord = () => {
    if (started) commands[commands.length - 1].push(word);
    word = '';
    started = false;
  };
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else word += ch;
      continue;
    }
    if (ch === '$' || ch === '`') return null;
    if (ch === '\\') {
      i += 1;
      if (i >= command.length || command[i] === '\n') return null;
      word += command[i];
      started = true;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else word += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === '>' || (ch === '&' && command[i + 1] === '>')) {
      const redirect = SAFE_REDIRECT.exec(command.slice(i));
      if (!redirect) return null;
      if (/^\d+$/.test(word)) {
        word = '';
        started = false;
      }
      endWord();
      i += redirect[0].length - 1;
      continue;
    }
    if ('\n\r<()'.includes(ch)) return null;
    if (ch === ';' || ch === '|' || ch === '&') {
      const doubled = command[i + 1] === ch;
      if ((ch === '&' && !doubled) || (ch === '|' && command[i + 1] === '&')) return null;
      if (doubled && ch !== ';') i += 1;
      endWord();
      commands.push([]);
      continue;
    }
    if (/\s/.test(ch)) {
      endWord();
      continue;
    }
    word += ch;
    started = true;
  }
  if (quote) return null;
  endWord();
  return commands.filter((words) => words.length > 0);
}

function isGitReadOnly(args: string[]): boolean {
  const rule = GIT_READ_ONLY.get(args[0] ?? '');
  if (!rule) return false;
  return args.slice(1).every((arg) => (rule.only ? rule.only.test(arg) : !rule.deny?.test(arg)));
}

function isReadOnlySimpleCommand([verb, ...args]: string[]): boolean {
  if (verb === 'git') return isGitReadOnly(args);
  if (verb === 'sed') return args.length >= 2 && args[0] === '-n' && SED_PRINT_SCRIPT.test(args[1]) && !args.slice(2).some((arg) => arg.startsWith('-'));
  if (!READ_ONLY_VERBS.has(verb)) return false;
  const deny = READ_ONLY_VERBS.get(verb);
  return !deny || !args.some((arg) => deny.test(arg));
}

export function bashMayMutate(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  const commands = splitSimpleCommands(trimmed);
  return commands === null || !commands.every(isReadOnlySimpleCommand);
}
