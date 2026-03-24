export interface SlashCommand {
  cmd: string;
  desc: string;
}



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
  jobId: string|undefined;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: '/forge',       desc: '<task> test with <cmd>  — competitive code generation' },
  { cmd: '/brainstorm',  desc: '<question>              — confidence-bidding answers' },
  { cmd: '/tribunal',    desc: '[mode] <question>        — debate (adversarial|socratic|red-team|steelman|synthesis|postmortem)' },
  { cmd: '/campfire',    desc: '<topic>                  — think together, no competition' },
  { cmd: '/workspace',   desc: 'add|remove|list|switch   — manage project repos' },
  { cmd: '/ws',          desc: '                          — list workspaces (shortcut)' },
  { cmd: '/use',         desc: '<engines>               — set active engines (e.g. /use claude,codex)' },
  { cmd: '/models',      desc: '                        — manage engines' },
  { cmd: '/tokens',      desc: '                        — show token usage & costs' },
  { cmd: '/engines',     desc: '                        — list all engines' },
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
  { cmd: '/pipeline',   desc: '<task> [test with <cmd>]  — build→review→fix loop' },
  { cmd: '/run',         desc: '<cmd>                    — run shell command inline' },
  { cmd: '/undo',        desc: '                        — revert last applied forge patch' },
  { cmd: '/jobs',        desc: '                        — list running/completed jobs' },
  { cmd: '/focus',       desc: '<id>                    — switch to background job output' },
  { cmd: '/help',        desc: '                        — show this help' },
  { cmd: '/exit',        desc: '                        — quit' },
];

export const FITNESS_PATTERN: RegExp = /\b(?:test with|test:|--test|fitness:)\s+(.+)/i;

export const LEADERBOARD_KEYWORDS: RegExp = /\b(leaderboard|elo|rankings?)\b/i;

export const HISTORY_KEYWORDS: RegExp = /\b(history|last runs?|recent)\b/i;

export const ENGINES_KEYWORDS: RegExp = /\b(engines?|what engines)\b/i;

export const CONFIG_KEYWORDS: RegExp = /\b(config|settings?)\b/i;

export const HELP_KEYWORDS: RegExp = /^(help|\?)$/i;

export const EXIT_KEYWORDS: RegExp = /^(exit|quit|bye)$/i;

function parseForgeInput(input: string): Intent {
  const fitnessMatch = FITNESS_PATTERN.exec(input);
  const fitnessCmd = fitnessMatch ? fitnessMatch[1].trim() : null;
  const task = fitnessCmd
    ? input.replace(FITNESS_PATTERN, '').trim()
    : input;
  return { type: 'forge', task, fitnessCmd } as Intent;
}

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
    case 'undo':
      return { type: 'undo' } as Intent;
    case 'jobs':
      return { type: 'jobs' } as Intent;
    case 'focus':
      return { type: 'focus', jobId: rest || undefined } as Intent;
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

export function detectIntent(raw: string): Intent {
  const input = raw.trim();
  if (!input) return { type: 'unknown', input: '' } as Intent;
  
  if (input.startsWith('/')) {
    return parseSlashCommand(input);
  }
  
  if (EXIT_KEYWORDS.test(input)) return { type: 'exit' } as Intent;
  if (HELP_KEYWORDS.test(input)) return { type: 'help' } as Intent;
  if (LEADERBOARD_KEYWORDS.test(input)) return { type: 'leaderboard' } as Intent;
  if (HISTORY_KEYWORDS.test(input)) return { type: 'history' } as Intent;
  if (ENGINES_KEYWORDS.test(input)) return { type: 'engines' } as Intent;
  if (CONFIG_KEYWORDS.test(input)) return { type: 'config' } as Intent;
  
  return { type: 'unknown', input } as Intent;
}

