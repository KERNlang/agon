export type Intent =
  | { type: 'forge'; task: string; fitnessCmd: string | null }
  | { type: 'brainstorm'; question: string }
  | { type: 'tribunal'; question: string }
  | { type: 'leaderboard' }
  | { type: 'history'; id?: string }
  | { type: 'engines' }
  | { type: 'config'; action?: string; key?: string; value?: string }
  | { type: 'use'; engineIds: string[] }
  | { type: 'models' }
  | { type: 'tokens' }
  | { type: 'slash-list' }
  | { type: 'help' }
  | { type: 'exit' }
  | { type: 'unknown'; input: string };

export const SLASH_COMMANDS = [
  { cmd: '/forge',       desc: '<task> test with <cmd>  — competitive code generation' },
  { cmd: '/brainstorm',  desc: '<question>              — confidence-bidding answers' },
  { cmd: '/tribunal',    desc: '<question>              — adversarial debate' },
  { cmd: '/use',         desc: '<engines>               — set active engines (e.g. /use claude,codex)' },
  { cmd: '/models',      desc: '                        — manage engines & Caesar model' },
  { cmd: '/tokens',      desc: '                        — show token usage & costs' },
  { cmd: '/engines',     desc: '                        — list all engines' },
  { cmd: '/leaderboard', desc: '                        — ELO rankings' },
  { cmd: '/history',     desc: '[id]                    — past forge runs' },
  { cmd: '/config',      desc: '[list|get|set]          — settings' },
  { cmd: '/help',        desc: '                        — show this help' },
  { cmd: '/exit',        desc: '                        — quit' },
] as const;

const FITNESS_PATTERN = /\b(?:test with|test:|--test|fitness:)\s+(.+)/i;

const FORGE_KEYWORDS =
  /\b(fix|implement|refactor|build|create|write|update|change|modify|remove|delete|migrate|upgrade|convert|patch|debug)\b/i;

const TRIBUNAL_KEYWORDS =
  /\b(should we|which is better|vs\.?|versus|debate|pros and cons|compare|trade-?offs?)\b/i;

const BRAINSTORM_KEYWORDS =
  /\b(brainstorm|ideas?|suggest|approach|best way|strategy|alternatives?|advice)\b/i;

// Question words — only trigger brainstorm if no forge/tribunal keyword matched
const QUESTION_KEYWORDS = /^(how|what)\b/i;

const LEADERBOARD_KEYWORDS = /\b(leaderboard|elo|rankings?)\b/i;

const HISTORY_KEYWORDS = /\b(history|last runs?|recent)\b/i;

const ENGINES_KEYWORDS = /\b(engines?|what engines)\b/i;

const CONFIG_KEYWORDS = /\b(config|settings?)\b/i;

const HELP_KEYWORDS = /^(help|\?)$/i;

const EXIT_KEYWORDS = /^(exit|quit|bye)$/i;

/**
 * Detect user intent from natural-language input.
 * Slash commands (/forge, /brainstorm, etc.) are treated as explicit overrides.
 */
export function detectIntent(raw: string): Intent {
  const input = raw.trim();
  if (!input) return { type: 'unknown', input: '' };

  // Slash commands — explicit routing
  if (input.startsWith('/')) {
    return parseSlashCommand(input);
  }

  // Exit
  if (EXIT_KEYWORDS.test(input)) return { type: 'exit' };

  // Help
  if (HELP_KEYWORDS.test(input)) return { type: 'help' };

  // Read-only lookups (partial match — "show leaderboard" works)
  if (LEADERBOARD_KEYWORDS.test(input)) return { type: 'leaderboard' };
  if (HISTORY_KEYWORDS.test(input)) return { type: 'history' };
  if (ENGINES_KEYWORDS.test(input)) return { type: 'engines' };
  if (CONFIG_KEYWORDS.test(input)) return { type: 'config' };

  // Tribunal — debate patterns
  if (TRIBUNAL_KEYWORDS.test(input)) {
    return { type: 'tribunal', question: input };
  }

  // Forge — action keywords
  if (FORGE_KEYWORDS.test(input)) {
    return parseForgeInput(input);
  }

  // Brainstorm — explicit brainstorm keywords
  if (BRAINSTORM_KEYWORDS.test(input)) {
    return { type: 'brainstorm', question: input };
  }

  // Question words as brainstorm fallback ("how do I...", "what is...")
  if (QUESTION_KEYWORDS.test(input)) {
    return { type: 'brainstorm', question: input };
  }

  return { type: 'unknown', input };
}

function parseForgeInput(input: string): Intent {
  const fitnessMatch = FITNESS_PATTERN.exec(input);
  const fitnessCmd = fitnessMatch ? fitnessMatch[1].trim() : null;
  const task = fitnessCmd
    ? input.replace(FITNESS_PATTERN, '').trim()
    : input;
  return { type: 'forge', task, fitnessCmd };
}

function parseSlashCommand(input: string): Intent {
  const stripped = input.slice(1).trim();

  // Just "/" with nothing after it → show command list
  if (!stripped) return { type: 'slash-list' };

  const parts = stripped.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const rest = parts.slice(1).join(' ');

  switch (cmd) {
    case 'forge':
      return parseForgeInput(rest || '');
    case 'brainstorm':
      return { type: 'brainstorm', question: rest };
    case 'tribunal':
      return { type: 'tribunal', question: rest };
    case 'leaderboard':
    case 'elo':
      return { type: 'leaderboard' };
    case 'history':
      return { type: 'history', id: rest || undefined };
    case 'engines':
      return { type: 'engines' };
    case 'models':
    case 'setup':
      return { type: 'models' };
    case 'tokens':
    case 'usage':
    case 'cost':
      return { type: 'tokens' };
    case 'use': {
      const ids = rest
        .split(/[,\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      return { type: 'use', engineIds: ids };
    }
    case 'config': {
      const configParts = rest.split(/\s+/);
      const action = configParts[0] || undefined;
      const key = configParts[1] || undefined;
      const value = configParts.slice(2).join(' ') || undefined;
      return { type: 'config', action, key, value };
    }
    case 'help':
      return { type: 'help' };
    case 'exit':
    case 'quit':
      return { type: 'exit' };
    default:
      return { type: 'unknown', input };
  }
}
