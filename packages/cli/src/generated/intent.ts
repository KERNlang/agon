// @kern-source: intent:1
export interface SlashCommand {
  cmd: string;
  desc: string;
}

// @kern-source: intent:2

// @kern-source: intent:3

// @kern-source: intent:5
export interface Intent {
  type: string;
  task: string|undefined;
  fitnessCmd: string|null|undefined;
  question: string|undefined;
  topic: string|undefined;
  input: string|undefined;
  id: string|undefined;
  action: string|undefined;
  key: string|undefined;
  value: string|undefined;
  path: string|undefined;
  engineIds: string[]|undefined;
  planId: string|undefined;
  patchPath: string|undefined;
  force: boolean|undefined;
  sessionId: string|undefined;
  index: number|undefined;
  tribunalMode: string|undefined;
  membersPerSide: number|undefined;
  hardened: boolean|undefined;
  jobId: string|undefined;
  taskClass: 'code'|'question'|'ambiguous'|undefined;
  args: string|undefined;
}

// @kern-source: intent:30
export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: '/forge',       desc: '<task> test with <cmd> [--hardened] — competitive code generation' },
  { cmd: '/brainstorm',  desc: '<question>              — confidence-bidding answers' },
  { cmd: '/tribunal',    desc: '[mode] <question>        — debate (adversarial|socratic|red-team|steelman|synthesis|postmortem)' },
  { cmd: '/campfire',    desc: '<topic>                  — think together, no competition' },
  { cmd: '/workspace',   desc: 'add|remove|list|switch   — manage project repos' },
  { cmd: '/ws',          desc: '                          — list workspaces (shortcut)' },
  { cmd: '/cesar',       desc: '<engine>                — set Cesar brain engine (e.g. /cesar codex)' },
  { cmd: '/models',      desc: '                        — browse & add models from 4000+ providers' },
  { cmd: '/tokens',      desc: '                        — show token usage & costs' },
  { cmd: '/engines',     desc: '                        — select active engines' },
  { cmd: '/leaderboard', desc: '                        — ELO rankings' },
  { cmd: '/history',     desc: '[id]                    — past forge runs' },
  { cmd: '/config',      desc: '[list|get|set]          — settings' },
  { cmd: '/plan',        desc: '[id]                    — show current or specific plan' },
  { cmd: '/plans',       desc: '                        — list recent plans' },
  { cmd: '/approve',     desc: '                        — approve current plan' },
  { cmd: '/retry',       desc: '                        — retry failed plan step' },
  { cmd: '/cancel',      desc: '                        — cancel current plan' },
  { cmd: '/apply',       desc: '[path] [--force]       — apply winning forge patch' },
  { cmd: '/cp',          desc: '[N]                     — copy code block N to clipboard' },
  { cmd: '/img',         desc: '<path>                   — attach image to next prompt' },
  { cmd: '/flow',        desc: '                        — log this session' },
  { cmd: '/flows',       desc: '                        — flow analytics dashboard' },
  { cmd: '/chats',       desc: '[id|resume <id>]        — chat history or resume session' },
  { cmd: '/build',       desc: '<task>                   — agent builds in cwd (reads/edits/tests)' },
  { cmd: '/team-forge',      desc: '[2v2|3v3] <task> test with <cmd> — team code competition' },
  { cmd: '/team-tribunal',   desc: '[2v2|3v3] [mode] <question>    — team debate' },
  { cmd: '/team-brainstorm', desc: '[2v2|3v3] <question>            — team ideation' },
  { cmd: '/pipeline',   desc: '<task> [test with <cmd>]  — build→review→fix loop' },
  { cmd: '/provider',    desc: 'add|remove|list          — manage API providers' },
  { cmd: '/run',         desc: '<cmd>                    — run shell command inline' },
  { cmd: '/commit',      desc: '[message]                — stage & commit with auto-generated message' },
  { cmd: '/undo',        desc: '                        — revert last applied forge patch' },
  { cmd: '/jobs',        desc: '                        — list running/completed jobs' },
  { cmd: '/focus',       desc: '<id>                    — switch to background job output' },
  { cmd: '/explore',     desc: '                        — toggle exploration mode (read-only)' },
  { cmd: '/nero',        desc: '                        — toggle Nero mode (adversarial devil\'s advocate)' },
  { cmd: '/clear',       desc: '                        — reset session (saves chat, clears brain)' },
  { cmd: '/help',        desc: '                        — show this help' },
  { cmd: '/exit',        desc: '                        — quit' },
];

// @kern-source: intent:76
export const FITNESS_PATTERN: RegExp = /\b(?:test with|test:|--test|fitness:)\s+(.+)/i;

// @kern-source: intent:80
export const LEADERBOARD_KEYWORDS: RegExp = /\b(leaderboard|elo|rankings?)\b/i;

// @kern-source: intent:83
export const HISTORY_KEYWORDS: RegExp = /\b(history|last runs?|recent)\b/i;

// @kern-source: intent:86
export const ENGINES_KEYWORDS: RegExp = /\b(engines?|what engines)\b/i;

// @kern-source: intent:89
export const CONFIG_KEYWORDS: RegExp = /\b(config|settings?)\b/i;

// @kern-source: intent:92
export const HELP_KEYWORDS: RegExp = /^(help|\?)$/i;

// @kern-source: intent:95
export const EXIT_KEYWORDS: RegExp = /^(exit|quit|bye)$/i;

// @kern-source: intent:98
export const SENTENCE_PREFIX: RegExp = /^(do|does|did|is|are|was|were|have|has|had|can|could|would|should|will|shall|i\s)/i;

// @kern-source: intent:101
export const QUESTION_PATTERN: RegExp = /^(what|how|why|where|when|who|which|explain|describe|tell|show|list|is there|does|can you explain|walk me through)\b/i;

// @kern-source: intent:104
export const CODE_TASK_PATTERN: RegExp = /^(fix|add|implement|refactor|debug|create|build|write|update|change|remove|delete|rename|move|test|deploy|install|upgrade|migrate|convert|extract|inline|optimize|port)\b/i;

// @kern-source: intent:107
export const CODE_ARTIFACT_PATTERN: RegExp = /(?:at \w+.*:\d+|\.[tj]sx?\b|\.[a-z]{2,4}:\d+|^[+-]{3}\s)/m;

// @kern-source: intent:110
export function classifyTask(input: string): 'code'|'question'|'ambiguous' {
  if (QUESTION_PATTERN.test(input)) return 'question';
  if (CODE_TASK_PATTERN.test(input)) return 'code';
  if (CODE_ARTIFACT_PATTERN.test(input)) return 'code';
  return 'ambiguous';
}

// @kern-source: intent:118
function parseForgeInput(input: string): Intent {
  // Only match --hardened as a standalone flag (not inside task text or test args)
  const hardenedMatch = input.match(/^(--hardened)\s+(.*)$/i) || input.match(/^(.*?)\s+(--hardened)\s*$/i);
  const hardened = hardenedMatch !== null;
  const cleaned = hardened
    ? (hardenedMatch[1] === '--hardened' ? hardenedMatch[2] : hardenedMatch[1]).trim()
    : input;
  const fitnessMatch = FITNESS_PATTERN.exec(cleaned);
  const fitnessCmd = fitnessMatch ? fitnessMatch[1].trim() : null;
  const task = fitnessCmd
    ? cleaned.replace(FITNESS_PATTERN, '').trim()
    : cleaned;
  return { type: 'forge', task, fitnessCmd, hardened } as Intent;
}

// @kern-source: intent:134
function parseSlashCommand(input: string): Intent {
  const stripped = input.slice(1).trim();
  if (!stripped) return { type: 'slash-list' } as Intent;
  
  const parts = stripped.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const rest = parts.slice(1).join(' ');
  
  switch (cmd) {
    case 'forge':
      return parseForgeInput(rest || '');
    case 'brainstorm':
      return { type: 'brainstorm', question: rest } as Intent;
    case 'tribunal': {
      const MODES = ['adversarial', 'socratic', 'red-team', 'steelman', 'synthesis', 'postmortem'];
      const tribunalParts = rest.split(/\s+/);
      const firstWord = tribunalParts[0]?.toLowerCase();
      // Check --mode flag
      const modeIdx = tribunalParts.indexOf('--mode');
      if (modeIdx >= 0 && tribunalParts[modeIdx + 1] && MODES.includes(tribunalParts[modeIdx + 1])) {
        const tMode = tribunalParts[modeIdx + 1];
        const tQuestion = [...tribunalParts.slice(0, modeIdx), ...tribunalParts.slice(modeIdx + 2)].join(' ');
        return { type: 'tribunal', question: tQuestion, tribunalMode: tMode } as Intent;
      }
      // Check --<mode> flag
      for (const m of MODES) {
        if (firstWord === `--${m}` || firstWord === m) {
          return { type: 'tribunal', question: tribunalParts.slice(1).join(' '), tribunalMode: m } as Intent;
        }
      }
      return { type: 'tribunal', question: rest } as Intent;
    }
    case 'team-tribunal': {
      const MODES = ['adversarial', 'socratic', 'red-team', 'steelman', 'synthesis', 'postmortem'];
      const ttParts = rest.split(/\s+/);
      let ttSize: number | undefined;
      let ttMode: string | undefined;
      let ttStart = 0;
      // Parse optional NvN format
      const sizeMatch = ttParts[0]?.match(/^(\d+)v(\d+)$/i);
      if (sizeMatch) {
        ttSize = parseInt(sizeMatch[1], 10);
        ttStart = 1;
      }
      // Parse optional mode
      const mw = ttParts[ttStart]?.toLowerCase();
      if (mw && MODES.includes(mw)) {
        ttMode = mw;
        ttStart++;
      } else if (mw && mw.startsWith('--')) {
        const stripped = mw.slice(2);
        if (MODES.includes(stripped)) { ttMode = stripped; ttStart++; }
      }
      const ttQuestion = ttParts.slice(ttStart).join(' ');
      return { type: 'team-tribunal', question: ttQuestion, tribunalMode: ttMode, membersPerSide: ttSize } as Intent;
    }
    case 'team-forge': {
      const tfParts = rest.split(/\s+/);
      let tfSize: number | undefined;
      let tfStart = 0;
      const tfSizeMatch = tfParts[0]?.match(/^(\d+)v(\d+)$/i);
      if (tfSizeMatch) { tfSize = parseInt(tfSizeMatch[1], 10); tfStart = 1; }
      const tfRest = tfParts.slice(tfStart).join(' ');
      const tfFitness = FITNESS_PATTERN.exec(tfRest);
      const tfCmd = tfFitness ? tfFitness[1].trim() : null;
      const tfTask = tfCmd ? tfRest.replace(FITNESS_PATTERN, '').trim() : tfRest;
      return { type: 'team-forge', task: tfTask, fitnessCmd: tfCmd, membersPerSide: tfSize } as Intent;
    }
    case 'team-brainstorm': {
      const tbParts = rest.split(/\s+/);
      let tbSize: number | undefined;
      let tbStart = 0;
      const tbSizeMatch = tbParts[0]?.match(/^(\d+)v(\d+)$/i);
      if (tbSizeMatch) { tbSize = parseInt(tbSizeMatch[1], 10); tbStart = 1; }
      return { type: 'team-brainstorm', question: tbParts.slice(tbStart).join(' '), membersPerSide: tbSize } as Intent;
    }
    case 'leaderboard':
    case 'elo':
      return { type: 'leaderboard' } as Intent;
    case 'history':
      return { type: 'history', id: rest || undefined } as Intent;
    case 'engines':
      if (rest === 'discover' || rest === 'scan') return { type: 'discover' } as Intent;
      return { type: 'engines' } as Intent;
    case 'discover':
      return { type: 'discover' } as Intent;
    case 'provider': {
      const provParts = rest.trim().split(/\s+/);
      const provAction = provParts[0] || 'list';
      const provArgs = provParts.slice(1).join(' ');
      return { type: 'provider', action: provAction, args: provArgs } as Intent;
    }
    case 'campfire':
    case 'think':
    case 'talk':
      return { type: 'campfire', topic: rest } as Intent;
    case 'workspace':
    case 'ws': {
      const wsParts = rest.split(/\s+/);
      const action = wsParts[0] || 'list';
      const wsPath = wsParts.slice(1).join(' ') || undefined;
      return { type: 'workspace', action, path: wsPath } as Intent;
    }
    case 'models':
    case 'setup':
      return { type: 'models' } as Intent;
    case 'tokens':
    case 'usage':
    case 'cost':
      return { type: 'tokens' } as Intent;
    case 'cesar': {
      const cesarIds = rest
        .split(/[,\s]+/)
        .map((s: string) => s.trim().toLowerCase())
        .filter(Boolean);
      return { type: 'cesar', engineIds: cesarIds } as Intent;
    }
    case 'use': {
      const ids = rest
        .split(/[,\s]+/)
        .map((s: string) => s.trim().toLowerCase())
        .filter(Boolean);
      return { type: 'use', engineIds: ids } as Intent;
    }
    case 'config': {
      const configParts = rest.split(/\s+/);
      const action = configParts[0] || undefined;
      const key = configParts[1] || undefined;
      const value = configParts.slice(2).join(' ') || undefined;
      return { type: 'config', action, key, value } as Intent;
    }
    case 'plan':
      return { type: 'plan', planId: rest || undefined } as Intent;
    case 'plans':
      return { type: 'plans' } as Intent;
    case 'approve':
      return { type: 'approve' } as Intent;
    case 'retry':
    case 'resume':
      return { type: 'retry' } as Intent;
    case 'cancel':
    case 'abort':
      return { type: 'cancel' } as Intent;
    case 'img':
    case 'image':
      return { type: 'img', path: rest } as Intent;
    case 'chat':
    case 'ask':
      return { type: 'chat', input: rest } as Intent;
    case 'apply': {
      const force = rest.includes('--force');
      const path = rest.replace('--force', '').trim() || undefined;
      return { type: 'apply', patchPath: path, force } as Intent;
    }
    case 'cp':
    case 'copy': {
      const cpIndex = rest ? parseInt(rest, 10) : undefined;
      return { type: 'cp', index: isNaN(cpIndex as number) ? undefined : cpIndex } as Intent;
    }
    case 'flow':
      return { type: 'flow' } as Intent;
    case 'flows':
      return { type: 'flows' } as Intent;
    case 'chats': {
      const chatParts = rest.split(/\s+/);
      if (chatParts[0] === 'resume' && chatParts[1]) {
        return { type: 'chats-resume', sessionId: chatParts[1] } as Intent;
      }
      return { type: 'chats', sessionId: rest || undefined } as Intent;
    }
    case 'build':
    case 'agent':
      return { type: 'build', input: rest } as Intent;
    case 'pipeline':
    case 'pipe': {
      const fitMatch = FITNESS_PATTERN.exec(rest);
      const fitCmd = fitMatch ? fitMatch[1].trim() : null;
      const pipeTask = fitCmd ? rest.replace(FITNESS_PATTERN, '').trim() : rest;
      return { type: 'pipeline', task: pipeTask, fitnessCmd: fitCmd } as Intent;
    }
    case 'run':
    case 'exec':
    case 'shell':
      return { type: 'run', input: rest } as Intent;
    case 'commit':
      return { type: 'commit', input: rest || undefined } as Intent;
    case 'undo':
      return { type: 'undo' } as Intent;
    case 'jobs':
      return { type: 'jobs' } as Intent;
    case 'focus':
      return { type: 'focus', jobId: rest || undefined } as Intent;
    case 'explore':
    case 'plan-mode':
    case 'readonly':
      return { type: 'explore' } as Intent;
    case 'nero':
    case 'devil':
    case 'adversarial':
      return { type: 'nero' } as Intent;
    case 'clear':
      return { type: 'clear' } as Intent;
    case 'help':
      return { type: 'help' } as Intent;
    case 'exit':
    case 'quit':
      return { type: 'exit' } as Intent;
    default:
      return { type: 'unknown', input } as Intent;
  }
}

// @kern-source: intent:347
export function detectIntent(raw: string): Intent {
  const input = raw.trim();
  if (!input) return { type: 'unknown', input: '' } as Intent;
  
  if (input.startsWith('/')) {
    return parseSlashCommand(input);
  }
  
  if (EXIT_KEYWORDS.test(input)) return { type: 'exit' } as Intent;
  if (HELP_KEYWORDS.test(input)) return { type: 'help' } as Intent;
  
  // Only match keyword shortcuts for short, command-like inputs.
  // Skip if input looks like a natural language sentence (question words, pronouns, >4 words).
  const isCommandLike = input.split(/\s+/).length <= 4 && !SENTENCE_PREFIX.test(input);
  if (isCommandLike) {
    if (LEADERBOARD_KEYWORDS.test(input)) return { type: 'leaderboard' } as Intent;
    if (HISTORY_KEYWORDS.test(input)) return { type: 'history' } as Intent;
    if (ENGINES_KEYWORDS.test(input)) return { type: 'engines' } as Intent;
    if (CONFIG_KEYWORDS.test(input)) return { type: 'config' } as Intent;
  }
  
  return { type: 'auto', input, taskClass: classifyTask(input) } as Intent;
}

