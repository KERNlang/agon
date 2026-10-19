import type { JobCliInvocationContext } from '@kernlang/agon-mod-jobs';
import { captureProcessSurfaceAuthority } from './surface-authority-runtime.js';
import { parseArgs } from 'citty';
import type { ArgsDef, CommandDef, CommandMeta, SubCommandsDef } from 'citty';
import type { CommandContribution, CommandResult, Json, ModPlatform } from '@kernlang/agon-mod-api';
import { assertContributionInput, selectModSettings } from '@kernlang/agon-kernel';
import { assertProcessSurfaceAvailable, processSurfaceCatalog, processSurfaceClient, processSurfacePublicIds } from './surface-authority-runtime.js';

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
// throws. `models`, `ratings`, `ext`, `browser-host`, and `job` currently nest
// subCommands (confirmed against the command modules themselves), so only
// those parent commands get a lazy `subCommands` field; every other entry omits it
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

function normalizeOptionSpellings(rawArgs: string[], names: string[]): string[] {
  const declared = new Set(names);
  const spellings = new Map(names.map(name => [name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`), name]));
  let options = true;
  return rawArgs.map(arg => {
    if (arg === '--') { options = false; return arg; }
    const match = options ? /^--(no-)?([^=]+)(=.*)?$/.exec(arg) : null;
    if (!match || declared.has(match[2])) return arg;
    const canonical = spellings.get(match[2]);
    return canonical ? `--${match[1] ?? ''}${canonical}${match[3] ?? ''}` : arg;
  });
}

/** Normalize before Citty can consume a required positional as an unknown flag value. */
export async function normalizeCliArguments(command: CommandDef, rawArgs: string[]): Promise<string[]> {
  const children = await resolveMaybeFn(command.subCommands);
  const index = rawArgs.findIndex(arg => !arg.startsWith('-'));
  const child = children?.[rawArgs[index]];
  if (child) {
    const resolved = await resolveMaybeFn(child);
    if (resolved) return [...rawArgs.slice(0, index + 1), ...await normalizeCliArguments(resolved, rawArgs.slice(index + 1))];
  }
  const args = await resolveMaybeFn(command.args);
  return normalizeOptionSpellings(rawArgs, Object.keys(args ?? {}));
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
      // citty executes parent run() after its child. Authorize at entry so
      // lifecycle children may deliberately select a new generation.
      assertProcessSurfaceAvailable('cli', String(meta.name));
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

function schemaGeneratedCommand(publicId: string, description: string, displayName = publicId): CommandDef {
  const record = processSurfaceClient('cli').assertAvailable(publicId);
  const assertSelected = captureProcessSurfaceAuthority();
  const assertInvocation = () => { assertSelected(); assertProcessSurfaceAvailable('cli', publicId); };
  const contribution = record.payload as CommandContribution;
  const schema = (contribution.inputSchema ?? {}) as Record<string, any>;
  const projection = contribution.cli;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const properties = (schema.properties ?? {}) as Record<string, { type?: string; default?: unknown; description?: string }>;
  const projectedArgs = projection ? Object.fromEntries(Object.entries(properties).filter(([name]) => name !== '_').map(([name, spec]) => [name, {
    type: projection.positionals?.includes(name) ? 'positional' : (spec.type === 'boolean' ? 'boolean' : 'string'),
    required: required.has(name),
    ...(spec.default === undefined ? {} : { default: spec.type === 'boolean' ? Boolean(spec.default) : String(spec.default) }),
    ...(projection.aliases?.[name] ? { alias: projection.aliases[name] } : {}),
    description: projection.descriptions?.[name] ?? spec.description,
  }])) : { input: { type: 'positional', required: false, description: 'Optional JSON object passed to the mod command' } };
  return {
    meta: { name: displayName, description: contribution.description || description }, args: projectedArgs as any,
    setup: () => { assertInvocation(); },
    run: async (ctx) => {
      // Citty runs the parent after its child. Authorize in setup, but do not
      // invoke the parent contribution when Citty selected a nested command.
      const selectedChild = ctx.rawArgs?.find(arg => !arg.startsWith('-'));
      if (ctx.cmd?.subCommands && selectedChild) return;
      assertInvocation();
      let input: Json;
      if (projection) {
        // Normalize before parsing: defaults can hide Citty's alternate-spelling lookup.
        const rawArgs = ctx.rawArgs && normalizeOptionSpellings(ctx.rawArgs, Object.keys(properties));
        const parsed = rawArgs ? parseArgs(rawArgs, projectedArgs as ArgsDef) : ctx.args;
        input = Object.fromEntries(Object.entries(parsed as Record<string, Json | undefined>)
          .filter(([name, value]) => name in properties && value !== undefined)) as Json;
      }
      else {
        input = {};
        if (typeof ctx.args.input === 'string' && ctx.args.input.trim()) {
          const parsed = JSON.parse(ctx.args.input) as unknown;
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('mod command input must be a JSON object');
          input = parsed as Json;
        }
      }
      assertContributionInput(contribution.inputSchema ?? { type: 'object', additionalProperties: true }, input);
      const platform = `${process.platform}-${process.arch === 'x64' ? 'x64' : process.arch}` as ModPlatform;
      if (!['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].includes(platform)) throw new TypeError(`unsupported mod platform: ${platform}`);
      const { loadConfig } = await import('@kernlang/agon-core');
      const context: JobCliInvocationContext = { invocationId: `cli:${process.pid}:${Date.now()}`, cwd: process.cwd(), platform, signal: new AbortController().signal, config: selectModSettings(loadConfig(process.cwd()), record.owner.id) };
      if (record.owner.id === 'agon.jobs') {
        if (publicId === 'daemon') {
          const { createCliDaemonHost } = await import('./commands/daemon.js');
          context.daemonCli = createCliDaemonHost(assertInvocation);
        } else {
          const { createCliJobHost } = await import('./jobs/cli-host.js');
          context.jobCli = createCliJobHost(assertInvocation);
        }
      }
      assertInvocation();
      const output = await contribution.run(input, context);
      assertInvocation();
      let result: CommandResult = { exitCode: 0 };
      if (output && typeof output === 'object' && Symbol.asyncIterator in output) {
        for await (const event of output) { assertInvocation(); if (event.type === 'text') process.stdout.write(event.text); else if (event.type === 'progress') process.stderr.write(`${event.message}\n`); else if (event.type === 'result') result = event.result; }
      } else result = output as CommandResult;
      assertInvocation();
      if (result.stdout) process.stdout.write(result.stdout); if (result.stderr) process.stderr.write(result.stderr);
      if (result.result !== undefined && !result.stdout) console.log(typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2));
      if (result.exitCode !== 0) process.exitCode = result.exitCode;
    },
  };
}

/** Parse TUI command text without shell expansion, using the selected CLI schema. */
export async function parseGeneratedCommandLine(publicId: string, text: string, cwd?: string): Promise<Record<string, Json>> {
  const assertSelected = captureProcessSurfaceAuthority();
  const record = processSurfaceClient('cli').assertAvailable(publicId);
  const contribution = record.payload as CommandContribution;
  if (!contribution.cli) throw new Error(`${publicId} has no CLI argument projection`);
  let args = await resolveMaybeFn(schemaGeneratedCommand(publicId, '').args) as ArgsDef;
  if (cwd !== undefined && args.cwd?.type === 'string') args = { ...args, cwd: { ...args.cwd, default: cwd } };
  assertSelected();
  const tokens: string[] = [];
  let word = '';
  let started = false;
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === quote) { quote = undefined; continue; }
    if (quote !== "'" && char === '\\') {
      const next = text[++index];
      if (next === undefined) throw new Error('Incomplete escape in command; close the quote or remove the final backslash.');
      if (quote === '"' && !['"', '\\', '$', '`', '\n'].includes(next)) word += '\\';
      if (next !== '\n') { word += next; started = true; }
      continue;
    }
    if (quote !== "'" && (char === '$' || char === '`'))
      throw new Error('Shell expansion is not supported here. Use single quotes for literal shell text.');
    if (quote) { word += char; continue; }
    if (char === '"' || char === "'") { quote = char; started = true; continue; }
    if (/[;&|<>()\n\r]/.test(char))
      throw new Error('Shell operators are not supported here. Quote the gate command.');
    if (/\s/.test(char)) {
      if (started) tokens.push(word);
      word = ''; started = false;
    } else { word += char; started = true; }
  }
  if (quote) throw new Error('Unclosed quote in command.');
  if (started) tokens.push(word);
  const parsed = parseArgs(normalizeOptionSpellings(tokens, Object.keys(args)), args);
  const properties = (contribution.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {};
  const input = Object.fromEntries(Object.entries(parsed).filter(([name, value]) => name in properties && value !== undefined)) as Record<string, Json>;
  assertContributionInput(contribution.inputSchema ?? {}, input);
  assertSelected();
  return input;
}
// Commands whose real implementation nests further subCommands of its own
// (`agon models list`, `agon ext install`, `agon browser-host install`, …).
// Every other command below is a leaf — see the comment above `lazyCommand`
// for why that distinction has to be made statically, without an import.
const engine = lazyCommand(() => import('./commands/engine.js'), 'engineCommand', {
  name: 'engine',
  description: 'Manage AI engines',
});
const doctor = lazyCommand(() => import('./commands/doctor.js'), 'doctorCommand', {
  name: 'doctor',
  description: 'Diagnose Agon engine and worktree health',
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
const call = lazyCommand(() => import('./commands/call.js'), 'callCommand', {
  name: 'call',
  description: 'Live bridge for external CLIs to run Agon modes',
});
const attach = lazyCommand(() => import('./commands/attach.js'), 'attachCommand', {
  name: 'attach',
  description: 'Attach (read-only) to a session: replay its EventLog and follow live (client/server split M2)',
});
const login = lazyCommand(() => import('./commands/login.js'), 'loginCommand', {
  name: 'login',
  description: "Log an engine's CLI into its clean workspace-pure config dir so dispatches stay authenticated without inheriting your personal Claude Code setup",
});
const update = lazyCommand(() => import('./commands/update.js'), 'updateCommand', {
  name: 'update',
  description: 'Stage, verify, and atomically select a Modular Agon release without overwriting the running process.',
});
const mod = lazyCommand(() => import('./commands/mod.js'), 'modCommand', {
  name: 'mod',
  description: 'Inspect and manage modular Agon packages',
}, { hasSubCommands: true });
const setup = lazyCommand(() => import('./commands/setup.js'), 'setupCommand', {
  name: 'setup',
  description: 'Plan or apply a durable Modular Agon installation and profile',
});

// Same shape as the subCommands map index.ts used to build directly from
// static imports — `worktree`/`wt` and `update`/`upgrade` intentionally
// share the SAME lazy entry (and therefore the same memoized import) as
// before, matching the pre-refactor aliasing.
// These are kernel/lifecycle commands, not user-toggleable modes. Every
// first-party mode below is projected from the selected registry generation.
const kernelLazyCommandImplementations: SubCommandsDef = {
  engine,
  doctor,
  models,
  provider,
  config,
  call,
  attach,
  login,
  update,
  upgrade: update,
  mod,
  setup,
};

export function createGeneratedLazySubCommands(available: ReadonlySet<string> = processSurfacePublicIds('cli')): SubCommandsDef {
  const commands = Object.fromEntries(Object.entries(kernelLazyCommandImplementations)
    .filter(([, command]) => available.has(String(((command as CommandDef).meta as CommandMeta).name))));
  for (const entry of processSurfaceCatalog('cli')) {
    if (!available.has(entry.publicId)) continue;
    if (!entry.category.startsWith('external:') && !['daemon', 'job', 'ask', 'think', 'brainstorm', 'team-brainstorm', 'campfire', 'tribunal', 'team-tribunal', 'review', 'nero', 'council', 'synthesis', 'forge', 'team-forge', 'conquer', 'goal', 'sanitize', 'naturalize', 'mutate', 'rag', 'research', 'history', 'last', 'leaderboard', 'ratings', 'ratings purge-unknown', 'provenance', 'room', 'agent-guide', 'install-agent-prompts', 'worktree', 'wt', 'serve', 'drive', 'chrome', 'ext', 'ext install', 'ext native-host', 'browser-host', 'browser-host install', 'browser-host uninstall', 'browser-host status', 'browser-host stop'].includes(entry.publicId)) continue;
    if (entry.publicId.includes(' ')) continue;
    if (commands[entry.publicId]) continue;
    const command = schemaGeneratedCommand(entry.publicId, entry.description);
    const children = processSurfaceCatalog('cli').filter((candidate) => candidate.publicId.startsWith(`${entry.publicId} `) && available.has(candidate.publicId));
    if (children.length) command.subCommands = Object.fromEntries(children.map((child) => {
      const childName = child.publicId.slice(entry.publicId.length + 1);
      return [childName, schemaGeneratedCommand(child.publicId, child.description, childName)];
    }));
    commands[entry.publicId] = command;
    for (const alias of entry.aliases) {
      if (commands[alias]) throw new TypeError(`generated CLI alias collides with an existing command: ${alias}`);
      commands[alias] = command;
    }
  }
  if (commands.worktree && commands.wt) commands.wt = commands.worktree;
  return commands;
}

export const lazySubCommands: SubCommandsDef = createGeneratedLazySubCommands();
