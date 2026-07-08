import type { CommandDef, CommandMeta, SubCommandsDef } from 'citty';

// ── Lazy citty subcommand loading ──────────────────────────────────────────
// Every `agon <anything>` — even `--help` — used to statically import all
// ~40 command modules (forge, brainstorm, tribunal, RAG, …) before citty ever
// parsed argv, because index.ts imported every command module up front and
// handed citty the real CommandDef objects. That evaluates the entire
// core+forge+RAG module graph on every invocation, regardless of which (if
// any) subcommand is actually being run.
//
// citty's `SubCommandsDef` values are `Resolvable<CommandDef>` — a plain
// value OR a zero-arg function returning one (sync or async) — so a
// subcommand entry can defer its real module import until citty actually
// needs it. The wrinkle: citty's own `renderUsage()` (used for the top-level
// `agon --help` listing) resolves *every* subcommand entry to read its
// `meta.description` for the commands table — if that resolution itself
// triggers the heavy import, top-level `--help` stays just as slow as
// before. The fix used here: give each lazy entry a STATIC `meta` (a cheap
// plain object, matching the real command's meta verbatim — enforced by
// lazy-commands.test.ts) so `--help` never imports anything, while `args`,
// `subCommands`, `setup`, `run`, and `cleanup` all defer to a memoized
// dynamic `import()` that only fires when the command is actually dispatched
// or its own `--help`/nested subcommands are requested.
//
// citty checks `if (cmd.subCommands)` (a truthiness check on the *unresolved*
// field, before calling it) in a couple of places, so a lazy entry must only
// set `subCommands` to a function when the real command genuinely defines
// nested subCommands — otherwise that truthy check passes, the resolved
// value comes back `undefined`, and citty's `Object.entries(undefined)`
// throws. Only `models`, `ext`, and `browser-host` currently nest
// subCommands (confirmed against the generated command sources), so only
// those three get a lazy `subCommands` field; every other entry omits it
// entirely, exactly like the real leaf commands do.

// A command module may export other helpers alongside its CommandDef (e.g.
// `commands/review.js` also exports `isPastePlaceholderOnly`,
// `commands/call.js` also exports `buildCallCommands`) — so this stays a
// loose `unknown` record and the one property we actually want is cast to
// `CommandDef` at the point of use, rather than typing the whole module.
type CommandModule = Record<string, unknown>;

interface LazyCommandOptions {
  hasSubCommands?: boolean;
}

function resolveMaybeFn<T>(value: T | (() => T | Promise<T>) | undefined): T | Promise<T> | undefined {
  return typeof value === 'function' ? (value as () => T | Promise<T>)() : value;
}

function lazyCommand(
  loader: () => Promise<CommandModule>,
  exportName: string,
  meta: CommandMeta,
  options: LazyCommandOptions = {},
): CommandDef {
  let cached: Promise<CommandDef> | undefined;
  const resolve = (): Promise<CommandDef> => {
    if (!cached) {
      cached = loader().then((mod) => mod[exportName] as CommandDef);
    }
    return cached;
  };

  const def: CommandDef = {
    meta,
    args: async () => {
      const cmd = await resolve();
      const resolved = await resolveMaybeFn(cmd.args as any);
      return resolved ?? {};
    },
    setup: async (ctx) => {
      const cmd = await resolve();
      return cmd.setup?.(ctx);
    },
    cleanup: async (ctx) => {
      const cmd = await resolve();
      return cmd.cleanup?.(ctx);
    },
    run: async (ctx) => {
      const cmd = await resolve();
      return cmd.run?.(ctx);
    },
  };

  // Only leaf-vs-parent shape is precomputed statically; the actual nested
  // subCommands map (if any) is still loaded lazily on first access.
  if (options.hasSubCommands) {
    def.subCommands = async () => {
      const cmd = await resolve();
      return resolveMaybeFn(cmd.subCommands as any);
    };
  }

  return def;
}

// Commands whose real implementation nests further subCommands of its own
// (`agon models list`, `agon ext install`, `agon browser-host install`, …).
// Every other command below is a leaf — see the comment above `lazyCommand`
// for why that distinction has to be made statically, without an import.
const forge = lazyCommand(() => import('./commands/forge.js'), 'forgeCommand', {
  name: 'forge',
  description: 'Run competitive forge — engines race to implement a task',
});
const brainstorm = lazyCommand(() => import('./commands/brainstorm.js'), 'brainstormCommand', {
  name: 'brainstorm',
  description: 'Confidence-bidding brainstorm — engines bid, highest-quality answer wins (quality = substance + calibrated confidence)',
});
const tribunal = lazyCommand(() => import('./commands/tribunal.js'), 'tribunalCommand', {
  name: 'tribunal',
  description: 'Adversarial debate — engines argue different sides of a question',
});
const campfire = lazyCommand(() => import('./commands/campfire.js'), 'campfireCommand', {
  name: 'campfire',
  description: 'Open discussion — all engines think together, no competition',
});
const teamForge = lazyCommand(() => import('./commands/team-forge.js'), 'teamForgeCommand', {
  name: 'team-forge',
  description: 'Team competitive forge — teams of engines race to implement a task',
});
const teamBrainstorm = lazyCommand(() => import('./commands/team-brainstorm.js'), 'teamBrainstormCommand', {
  name: 'team-brainstorm',
  description: 'Team brainstorm — teams of engines collaborate on a question',
});
const teamTribunal = lazyCommand(() => import('./commands/team-tribunal.js'), 'teamTribunalCommand', {
  name: 'team-tribunal',
  description: 'Team tribunal — teams of engines argue different sides of a question',
});
const leaderboard = lazyCommand(() => import('./commands/leaderboard.js'), 'leaderboardCommand', {
  name: 'leaderboard',
  description: 'Show engine leaderboard (Glicko-2 ratings)',
});
const history = lazyCommand(() => import('./commands/history.js'), 'historyCommand', {
  name: 'history',
  description: 'Browse past forge runs',
});
const room = lazyCommand(() => import('./commands/room.js'), 'roomCommand', {
  name: 'room',
  description: 'Shared multi-party chat room any CLI can join',
});
const provenance = lazyCommand(() => import('./commands/provenance.js'), 'provenanceCommand', {
  name: 'provenance',
  description: 'AI-contribution / transparency report for a forge run',
});
const engine = lazyCommand(() => import('./commands/engine.js'), 'engineCommand', {
  name: 'engine',
  description: 'Manage AI engines',
});
const doctor = lazyCommand(() => import('./commands/doctor.js'), 'doctorCommand', {
  name: 'doctor',
  description: 'Diagnose Agon engine and worktree health',
});
const last = lazyCommand(() => import('./commands/last.js'), 'lastCommand', {
  name: 'last',
  description: 'Print the path of the most recent run directory (orchestrators: composes with cat/jq)',
});
const models = lazyCommand(() => import('./commands/models.js'), 'modelsCommand', {
  name: 'models',
  description: 'Manage engine→model mappings',
}, { hasSubCommands: true });
const provider = lazyCommand(() => import('./commands/provider.js'), 'providerCommand', {
  name: 'provider',
  description: 'Add, remove, or list API providers; connect/disconnect and manage API keys',
});
const config = lazyCommand(() => import('./commands/config.js'), 'configCommand', {
  name: 'config',
  description: 'View and modify Agon configuration',
});
const review = lazyCommand(() => import('./commands/review.js'), 'reviewCommand', {
  name: 'review',
  description: 'Run a non-interactive AI review of a diff target',
});
const call = lazyCommand(() => import('./commands/call.js'), 'callCommand', {
  name: 'call',
  description: 'Live bridge for external CLIs to run Agon modes',
});
const agentGuide = lazyCommand(() => import('./commands/agent-guide.js'), 'agentGuideCommand', {
  name: 'agent-guide',
  description: 'Print how to call agon — a compact overview for any external engine (Codex, Antigravity, Claude, OpenCode)',
});
const installAgentPrompts = lazyCommand(() => import('./commands/install-agent-prompts.js'), 'installAgentPromptsCommand', {
  name: 'install-agent-prompts',
  description: 'Install lightweight Agon prompts/skills into other CLIs (Codex, Antigravity, Claude Code) — no MCP, no always-on tokens',
});
const goal = lazyCommand(() => import('./commands/goal.js'), 'goalCommand', {
  name: 'goal',
  description: 'Autonomously drive a task queue (e.g. .kern-gaps/) to completion. Per task: forge implements, the diff is witnessed + mutation-witnessed, the frozen gate runs, ALL engines review and a judge decides, blockers get one fix pass, then one commit lands on the goal branch (never main) — and is pushed with --push. Bound it with --max-hours and/or --budget, or neither (free).',
});
const synthesis = lazyCommand(() => import('./commands/synthesis.js'), 'synthesisCommand', {
  name: 'synthesis',
  description: 'Competitive cross-pollination - engines draft, swap, improve, judge picks the best evolved artifact',
});
const ask = lazyCommand(() => import('./commands/ask.js'), 'askCommand', {
  name: 'ask',
  description: 'Ask one engine a single question — fast raw answer, no competition. `agon ask codex "..."`, or `agon ask "..."` for the default engine.',
});
const think = lazyCommand(() => import('./commands/think.js'), 'thinkCommand', {
  name: 'think',
  description: 'Sequential thinking — decompose a problem into structured thoughts before acting. `agon think "..." --strategy reflexion`. Opt-in; surfaces open questions and a goal handoff.',
});
const rag = lazyCommand(() => import('./commands/rag.js'), 'ragCommand', {
  name: 'rag',
  description: 'Project-context retrieval over the docs corpus: index | query "<text>" | stats. Offline embeddings (MiniLM sidecar), cited results.',
});
const nero = lazyCommand(() => import('./commands/nero.js'), 'neroCommand', {
  name: 'nero',
  description: 'Adversarial self-challenge — the top-rated critic attacks a decision and returns concrete failure scenarios + a verdict. `agon nero "<decision>" --reasoning "..."`. Agon\'s /evil-twin for external CLIs.',
});
const council = lazyCommand(() => import('./commands/council.js'), 'councilCommand', {
  name: 'council',
  description: 'Roundtable of ALL active engines — each takes a role, the top-rated engine chairs. `agon council "<decision>"`. Agon\'s stronger LLM-Council: real heterogeneous models, decision brief, directed critique, a chairman verdict with confidence + kill-switch.',
});
const research = lazyCommand(() => import('./commands/research.js'), 'researchCommand', {
  name: 'research',
  description: 'Keyless web-grounded research — Agon discovers sources (npm/GitHub/MDN/IETF/Stack Overflow/Wikipedia, no API key), an engine drafts a cited answer, and Agon verifies every citation. `agon research "<question>"`.',
});
const conquer = lazyCommand(() => import('./commands/conquer.js'), 'conquerCommand', {
  name: 'conquer',
  description: 'Supervised-autonomous build: Cesar drives an external builder CLI (codex/claude/agy) unattended toward a task, convening nero/tribunal/council on forks, and stops at a human merge gate. `agon conquer "<task>" --gate "<test cmd>"`.',
});
const worktree = lazyCommand(() => import('./commands/worktree.js'), 'worktreeCommand', {
  name: 'worktree',
  description: 'Isolated per-session git worktrees (new/list/rm/prune/rehydrate)',
});
const attach = lazyCommand(() => import('./commands/attach.js'), 'attachCommand', {
  name: 'attach',
  description: 'Attach (read-only) to a session: replay its EventLog and follow live (client/server split M2)',
});
const daemon = lazyCommand(() => import('./commands/daemon.js'), 'daemonCommand', {
  name: 'daemon',
  description: 'Run a long-lived agon session host (agond) you can attach to (client/server split M3): start | stop | status',
});
const serve = lazyCommand(() => import('./commands/serve.js'), 'serveCommand', {
  name: 'serve',
  description: 'Launch the loopback HTTP bridge so a browser extension / desktop can attach to one agon session (Agon Everywhere MVP)',
});
const drive = lazyCommand(() => import('./commands/drive.js'), 'driveCommand', {
  name: 'drive',
  description: 'Drive your browser from the terminal via a running `agon serve` + the open side panel (research, check a page design, navigate/read/screenshot)',
});
const chrome = lazyCommand(() => import('./commands/chrome.js'), 'chromeCommand', {
  name: 'chrome',
  description: 'Drive your browser from the terminal — reuses a running agon (serve/REPL) the side panel is on, or embeds a transient bridge (research, check a page design, navigate/read/screenshot)',
});
const ext = lazyCommand(() => import('./commands/ext.js'), 'extCommand', {
  name: 'ext',
  description: 'Browser-extension integration: install the native-messaging host for zero-terminal auto-connect.',
}, { hasSubCommands: true });
const browserHost = lazyCommand(() => import('./commands/browser-host.js'), 'browserHostCommand', {
  name: 'browser-host',
  description: 'Native-messaging pairing: install the com.kernlang.agon host so the browser extension connects with zero paste (install | uninstall | status | stop).',
}, { hasSubCommands: true });
const login = lazyCommand(() => import('./commands/login.js'), 'loginCommand', {
  name: 'login',
  description: "Log an engine's CLI into its clean workspace-pure config dir so dispatches stay authenticated without inheriting your personal Claude Code setup",
});
const update = lazyCommand(() => import('./commands/update.js'), 'updateCommand', {
  name: 'update',
  description: 'Update Agon to the latest (or a specific) version from npm. Streams npm output live and exits 0 on success.',
});

// Same shape as the subCommands map index.ts used to build directly from
// static imports — `worktree`/`wt` and `update`/`upgrade` intentionally
// share the SAME lazy entry (and therefore the same memoized import) as
// before, matching the pre-refactor aliasing.
export const lazySubCommands: SubCommandsDef = {
  forge,
  brainstorm,
  tribunal,
  campfire,
  'team-forge': teamForge,
  'team-brainstorm': teamBrainstorm,
  'team-tribunal': teamTribunal,
  leaderboard,
  history,
  room,
  provenance,
  engine,
  doctor,
  last,
  models,
  provider,
  config,
  review,
  call,
  'agent-guide': agentGuide,
  'install-agent-prompts': installAgentPrompts,
  goal,
  synthesis,
  ask,
  think,
  rag,
  nero,
  council,
  research,
  conquer,
  worktree,
  wt: worktree,
  attach,
  daemon,
  serve,
  drive,
  chrome,
  ext,
  'browser-host': browserHost,
  login,
  update,
  upgrade: update,
};
