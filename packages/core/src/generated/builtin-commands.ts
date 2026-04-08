// @kern-source: builtin-commands:6
import { CommandRegistry } from './command-registry.js';

// @kern-source: builtin-commands:7
import type { CommandHandler } from './command-registry.js';

// @kern-source: builtin-commands:9
export function registerBuiltinCommands(registry: CommandRegistry): void {
  const noop = async () => ({ handled: false, ranAsJob: false });
  const passthrough = (rest: string) => ({ input: rest });
  
  const builtins: Array<{ name: string; desc: string; category: string; aliases?: string[] }> = [
    // Competition
    { name: 'forge',           desc: '<task> test with <cmd> [--hardened] — competitive code generation', category: 'competition' },
    { name: 'brainstorm',      desc: '<question>              — confidence-bidding answers', category: 'competition' },
    { name: 'tribunal',        desc: '[mode] <question>        — debate (adversarial|socratic|red-team|steelman|synthesis|postmortem)', category: 'competition' },
    { name: 'campfire',        desc: '<topic>                  — think together, no competition', category: 'competition' },
    { name: 'team-forge',      desc: '[2v2|3v3] <task> test with <cmd> — team code competition', category: 'competition' },
    { name: 'team-tribunal',   desc: '[2v2|3v3] [mode] <question>    — team debate', category: 'competition' },
    { name: 'team-brainstorm', desc: '[2v2|3v3] <question>            — team ideation', category: 'competition' },
  
    // Execution
    { name: 'build',      desc: '<task>                   — agent builds in cwd (reads/edits/tests)', category: 'execution' },
    { name: 'pipeline',   desc: '<task> [test with <cmd>]  — build→review→fix loop', category: 'execution' },
    { name: 'run',         desc: '<cmd>                    — run shell command inline', category: 'execution' },
    { name: 'commit',      desc: '[message]                — stage & commit with auto-generated message', category: 'execution' },
    { name: 'apply',       desc: '[path] [--force]       — apply winning forge patch', category: 'execution' },
    { name: 'undo',        desc: '                        — revert last applied forge patch', category: 'execution' },
  
    // Planning
    { name: 'plan',      desc: '<task> or no args    — plan mode or show plan', category: 'planning' },
    { name: 'plans',     desc: '                        — list recent plans', category: 'planning' },
    { name: 'approve',   desc: '                        — approve current plan', category: 'planning' },
    { name: 'retry',     desc: '                        — retry failed plan step', category: 'planning' },
    { name: 'cancel',    desc: '                        — cancel current plan', category: 'planning' },
  
    // Config
    { name: 'workspace', desc: 'add|remove|list|switch   — manage project repos', category: 'config', aliases: ['ws'] },
    { name: 'cesar',     desc: '<engine>                — set Cesar brain engine', category: 'config' },
    { name: 'models',    desc: '                        — browse & add models from 4000+ providers', category: 'config' },
    { name: 'engines',   desc: '                        — select active engines', category: 'config' },
    { name: 'config',    desc: '[list|get|set]          — settings', category: 'config' },
    { name: 'provider',  desc: 'add|remove|list          — manage API providers', category: 'config' },
  
    // Info
    { name: 'tokens',      desc: '                        — show token usage & costs', category: 'info' },
    { name: 'leaderboard', desc: '                        — ELO rankings', category: 'info' },
    { name: 'history',     desc: '[id]                    — past forge runs', category: 'info' },
    { name: 'flow',        desc: '                        — log this session', category: 'info' },
    { name: 'flows',       desc: '                        — flow analytics dashboard', category: 'info' },
    { name: 'chats',       desc: '[id|resume <id>]        — chat history or resume session', category: 'info' },
    { name: 'jobs',        desc: '                        — list running/completed jobs', category: 'info' },
    { name: 'focus',       desc: '<id>                    — switch to background job output', category: 'info' },
  
    // Session
    { name: 'explore',   desc: '                        — toggle exploration mode (read-only)', category: 'session' },
    { name: 'nero',      desc: '                        — toggle Nero mode (adversarial)', category: 'session' },
    { name: 'btw',       desc: '<question>               — ask something while engines work', category: 'session' },
    { name: 'clear',     desc: '                        — reset session', category: 'session' },
  
    // Utility
    { name: 'img',  desc: '<path>                   — attach image to next prompt', category: 'utility' },
    { name: 'cp',   desc: '[N]                     — copy code block N to clipboard', category: 'utility' },
    { name: 'help', desc: '                        — show this help', category: 'utility', aliases: ['slash-list'] },
    { name: 'exit', desc: '                        — quit', category: 'utility' },
  ];
  
  for (const b of builtins) {
    const handler: CommandHandler = {
      definition: {
        name: b.name,
        description: b.desc,
        category: b.category,
        aliases: b.aliases,
        source: 'builtin',
      },
      parseArgs: passthrough,
      execute: noop,
    };
    registry.register(handler);
  }
}

