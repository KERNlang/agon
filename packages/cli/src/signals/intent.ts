import { FIRST_PARTY_SURFACE_CATALOG, KERNEL_MANAGEMENT_SURFACE_CATALOG } from '@kernlang/agon-kernel';
import { parseProcessFirstPartyIntent, processSurfaceCatalog, processSurfaceNames } from '../surface-authority-runtime.js';
import { hostRegexMatch, hostRegexObjectTest } from '../lib/kern-host.js';

const FALLBACK_TUI_CATALOG = Object.freeze([...FIRST_PARTY_SURFACE_CATALOG, ...KERNEL_MANAGEMENT_SURFACE_CATALOG]);

export interface SlashCommand { cmd: string; desc: string }
export interface Intent {
  type: string; task?: string; fitnessCmd?: string|null; question?: string; topic?: string; input?: string; id?: string;
  action?: string; key?: string; value?: string; path?: string; engineIds?: string[]; planId?: string; patchPath?: string;
  force?: boolean; sessionId?: string; index?: number; tribunalMode?: string; tribunalProtocol?: string; membersPerSide?: number;
  hardened?: boolean; jobId?: string; taskClass?: 'code'|'question'|'ambiguous'; args?: string; target?: string;
  engineId?: string; commandName?: string; turnId?: string; autoMode?: boolean; autoCredit?: boolean; strategy?: string;
  steps?: number; gate?: string; builder?: string; maxTurns?: number; gateTimeout?: number; maxHours?: number;
  turnTimeout?: number; swaps?: number; reasoning?: string; count?: number; last?: boolean; roles?: string[]; scope?: string;
  _modSurface?: { publicId: string; registryId: string; kind: string; value: unknown };
}

export function createTuiSurfaceIds(entries: readonly { category: string; publicId: string; aliases: readonly string[] }[] = FALLBACK_TUI_CATALOG): ReadonlySet<string> {
  return new Set(entries.filter((entry) => ['tuiSlashCommands', 'intentVariants', 'builtinCommandMetadata', 'kernelModManagement', 'external:tuiActions'].includes(entry.category))
    .flatMap((entry) => [entry.publicId, ...entry.aliases]).map((name) => name.startsWith('/') ? name.slice(1) : name));
}
export function createSlashCommands(available: ReadonlySet<string> = processSurfaceNames('tui')): SlashCommand[] {
  return processSurfaceCatalog('tui').filter((entry) => ['tuiSlashCommands', 'kernelModManagement', 'external:tuiActions'].includes(entry.category)
    && entry.kind === 'tui-action' && available.has(entry.publicId)).map((entry) => ({ cmd: entry.publicId, desc: entry.description }));
}

export const SLASH_COMMANDS = createSlashCommands();
export const FITNESS_PATTERN = /\b(?:test with|test:|--test|fitness:)\s+(.+)/i;
export const LEADERBOARD_KEYWORDS = /\b(leaderboard|elo|rankings?)\b/i;
export const HISTORY_KEYWORDS = /\b(history|last runs?|recent)\b/i;
export const ENGINES_KEYWORDS = /\b(engines?|what engines)\b/i;
export const CONFIG_KEYWORDS = /\b(config|settings?)\b/i;
export const HELP_KEYWORDS = /^(help|\?)$/i;
export const EXIT_KEYWORDS = /^(exit|quit|bye)$/i;
export const SENTENCE_PREFIX = /^(do|does|did|is|are|was|were|have|has|had|can|could|would|should|will|shall|i\s)/i;
export const QUESTION_PATTERN = /^(what|how|why|where|when|who|which|explain|describe|tell|show|list|is there|does|can you explain|walk me through)\b/i;
export const CODE_TASK_PATTERN = /^(fix|add|implement|refactor|debug|create|build|write|update|change|remove|delete|rename|move|test|deploy|install|upgrade|migrate|convert|extract|inline|optimize|port)\b/i;
export const CODE_ARTIFACT_PATTERN = /(?:at \w+.*:\d+|\.[tj]sx?\b|\.[a-z]{2,4}:\d+|^[+-]{3}\s)/m;
export const AGENT_TRIGGER_PATTERN = /^(?:agent(?:\s+mode)?|autonomous(?:\s+agent)?|run\s+agent)\s+([\s\S]+)$/i;
export const AUTOCREDIT_OFF_KEYWORDS = /\b(?:schalt(?:e|)?\s+(?:das|es|autoCredit)\s+ab|mach(?:e|)?\s+(?:das|es|autoCredit)\s+(?:aus|weg)|das\s+nervt|(?:autoCredit|co[\s-]?authored?|contributor)\s+(?:aus|ab|weg|nervt))\b/i;
export const AUTOCREDIT_ON_KEYWORDS = /\b(?:schalt(?:e|)?\s+(?:das|es|autoCredit)\s+an|mach(?:e|)?\s+(?:das|es|autoCredit)\s+an|(?:autoCredit|co[\s-]?authored?|contributor)\s+an)\b/i;

export function classifyTask(input: string): 'code'|'question'|'ambiguous' {
  if (hostRegexObjectTest(QUESTION_PATTERN, input)) return 'question';
  if (hostRegexObjectTest(CODE_TASK_PATTERN, input) || hostRegexObjectTest(CODE_ARTIFACT_PATTERN, input)) return 'code';
  return 'ambiguous';
}
function parseAgentShortcut(input: string): Intent|null {
  const match = hostRegexMatch(AGENT_TRIGGER_PATTERN, input), task = (match?.[1] ?? '').trim();
  return task ? { type: 'agent', input: task } : null;
}
const oneOf = (value: string, names: readonly string[]) => names.includes(value);

function parseKernelSlashCommand(cmd: string, rest: string, input: string, commandRegistry: any, available: ReadonlySet<string>): Intent {
  if (oneOf(cmd, ['cesar-report', 'cesar-stats'])) return { type: 'cesar-report' };
  if (oneOf(cmd, ['cesar-hints', 'cesar-debug'])) return { type: 'cesar-hints', input: rest };
  if (cmd === 'engines') {
    const parts = rest.trim().split(/\s+/).filter(Boolean), action = parts[0]?.toLowerCase();
    if (oneOf(action ?? '', ['discover', 'scan', 'rescan', 'refresh'])) return { type: 'discover', action: 'scan' };
    if (oneOf(action ?? '', ['hide', 'remove', 'delete', 'unhide', 'restore', 'show', 'list'])) return { type: 'engines', action, id: parts[1] };
    return { type: 'engines' };
  }
  if (cmd === 'discover') return { type: 'discover' };
  if (cmd === 'provider') { const parts = rest.trim().split(/\s+/); return { type: 'provider', action: parts[0] || 'list', args: parts.slice(1).join(' ') }; }
  if (cmd === 'models') return oneOf(rest.trim().toLowerCase(), ['cli', 'engine', 'engines']) ? { type: 'engines' } : { type: 'models' };
  if (cmd === 'setup') return { type: 'models' };
  if (oneOf(cmd, ['tokens', 'usage', 'cost'])) return { type: 'tokens' };
  if (cmd === 'raw') { const index = Number.parseInt(rest.trim(), 10); return { type: 'raw', index: Number.isFinite(index) && index > 0 ? index : undefined }; }
  if (cmd === 'doctor') return { type: 'doctor', scope: rest || 'engines' };
  if (oneOf(cmd, ['harness-replay', 'replay-harness', 'tool-replay'])) return { type: 'harness-replay', turnId: rest || undefined };
  if (cmd === 'cesar') return { type: 'cesar', engineIds: rest.split(/[,\s]+/).map((id) => id.trim().toLowerCase()).filter(Boolean) };
  if (cmd === 'use') return { type: 'use', engineIds: rest.split(/[,\s]+/).map((id) => id.trim().toLowerCase()).filter(Boolean) };
  if (cmd === 'config') { const parts = rest.split(/\s+/); return { type: 'config', action: parts[0] || undefined, key: parts[1] || undefined, value: parts.slice(2).join(' ') || undefined }; }
  if (cmd === 'mod') return { type: 'mod', args: rest };
  if (oneOf(cmd, ['img', 'image'])) return { type: 'img', path: rest };
  if (oneOf(cmd, ['chat', 'ask'])) return { type: 'chat', input: rest };
  if (oneOf(cmd, ['cp', 'copy'])) { const arg = rest.trim().toLowerCase(); if (oneOf(arg, ['last', 'msg', 'response'])) return { type: 'cp', last: true }; const index = rest ? Number.parseInt(rest, 10) : undefined; return { type: 'cp', index: Number.isNaN(index as number) ? undefined : index }; }
  if (cmd === 'chats') { const parts = rest.split(/\s+/); return parts[0] === 'resume' && parts[1] ? { type: 'chats-resume', sessionId: parts[1] } : { type: 'chats', sessionId: rest || undefined }; }
  if (oneOf(cmd, ['run', 'exec', 'shell'])) return { type: 'run', input: rest };
  if (cmd === 'checkpoints') return { type: 'checkpoints' };
  if (cmd === 'status') return { type: 'status' };
  if (oneOf(cmd, ['explore', 'plan-mode', 'readonly'])) return { type: 'explore' };
  if (oneOf(cmd, ['permissions', 'perms'])) {
    const match = rest.match(/^(add)\s+(allow|deny)\s+(.+)$/i) ?? rest.match(/^(remove)\s+(.+)$/i);
    if (match?.[1].toLowerCase() === 'add') return { type: 'permissions', action: 'add', key: match[2].toLowerCase(), value: match[3].trim() };
    if (match?.[1].toLowerCase() === 'remove') return { type: 'permissions', action: 'remove', value: match[2].trim() };
    return { type: 'permissions' };
  }
  if (oneOf(cmd, ['nogate', 'no-gate'])) return { type: 'nogate' };
  if (cmd === 'init') return { type: 'init', scope: rest || undefined };
  if (cmd === 'mcp') { const parts = rest.trim().split(/\s+/), action = parts[0]?.toLowerCase() || 'list', server = parts.slice(1).join(' ') || undefined; if (oneOf(action, ['connect', 'add'])) return { type: 'mcp', action: 'connect', value: server }; if (oneOf(action, ['disconnect', 'remove'])) return { type: 'mcp', action: 'disconnect', value: server }; return { type: 'mcp', action: 'list' }; }
  if (cmd === 'compact') return { type: 'compact' };
  if (oneOf(cmd, ['clear', 'clean'])) return { type: 'clear' };
  if (cmd === 'help') return { type: 'help' };
  if (cmd === 'extensions') return { type: 'extensions' };
  if (oneOf(cmd, ['exit', 'quit'])) return { type: 'exit' };
  if (available.has(cmd) || available.has('/' + cmd)) return { type: 'mod-surface-command', commandName: cmd, args: rest };
  if (commandRegistry?.has(cmd)) return { type: 'extension-command', commandName: cmd, args: rest };
  return { type: 'unknown', input };
}

function parseSlashCommand(input: string, commandRegistry: any, available: ReadonlySet<string>): Intent {
  const stripped = input.slice(1).trim();
  if (!stripped) return { type: 'slash-list' };
  const parts = stripped.split(/\s+/), cmd = parts[0].toLowerCase(), rest = parts.slice(1).join(' ');
  if (!available.has(cmd) && !available.has('/' + cmd) && !commandRegistry?.has(cmd)) return { type: 'unknown', input };
  const physical = parseProcessFirstPartyIntent(cmd, input);
  if (physical.authoritative) {
    if (!physical.value || typeof physical.value !== 'object' || Array.isArray(physical.value)) return { type: 'unknown', input };
    return {
      type: physical.publicId,
      ...(physical.value as object),
      _modSurface: {
        publicId: physical.publicId,
        registryId: physical.registryId,
        kind: physical.kind,
        value: physical.value,
      },
    } as Intent;
  }
  return parseKernelSlashCommand(cmd, rest, input, commandRegistry, available);
}

export function detectIntent(raw: string, commandRegistry?: any, available: ReadonlySet<string> = processSurfaceNames('tui')): Intent {
  const input = raw.trim();
  if (!input) return { type: 'unknown', input: '' };
  if (input.startsWith('/')) return parseSlashCommand(input, commandRegistry, available);
  if (input.startsWith('! ')) { const command = input.slice(2).trim(); if (command) return { type: 'run', input: command }; }
  if (hostRegexObjectTest(EXIT_KEYWORDS, input)) return { type: 'exit' };
  if (hostRegexObjectTest(HELP_KEYWORDS, input)) return { type: 'help' };
  const agent = parseAgentShortcut(input); if (agent) return agent;
  if (hostRegexObjectTest(AUTOCREDIT_OFF_KEYWORDS, input)) return { type: 'toggleAutoCredit', autoCredit: false, input };
  if (hostRegexObjectTest(AUTOCREDIT_ON_KEYWORDS, input)) return { type: 'toggleAutoCredit', autoCredit: true, input };
  const commandLike = input.split(/[ \t\n\r\f\v]+/).length <= 4 && !hostRegexObjectTest(SENTENCE_PREFIX, input);
  if (commandLike) {
    if (hostRegexObjectTest(LEADERBOARD_KEYWORDS, input)) return { type: 'leaderboard' };
    if (hostRegexObjectTest(HISTORY_KEYWORDS, input)) return { type: 'history' };
    if (hostRegexObjectTest(ENGINES_KEYWORDS, input)) return { type: 'engines' };
    if (hostRegexObjectTest(CONFIG_KEYWORDS, input)) return { type: 'config' };
  }
  return { type: 'auto', input, taskClass: classifyTask(input) };
}
