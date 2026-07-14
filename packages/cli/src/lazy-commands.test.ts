import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lazySubCommands } from './lazy-commands.js';
import { historyCommand } from './commands/history.js';
import { forgeCommand } from './commands/forge.js';
import { modelsCommand } from './commands/models.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The exact 42 keys `packages/cli/src/index.ts` registered before the lazy
// refactor (40 unique commands; worktree/wt and update/upgrade are aliases
// of the same command). If a command is ever added/removed/renamed, this
// snapshot must be updated deliberately — it exists so a lazy-loading bug
// can never silently drop a command from `agon --help`.
const EXPECTED_COMMAND_NAMES = [
  'forge',
  'brainstorm',
  'tribunal',
  'campfire',
  'team-forge',
  'team-brainstorm',
  'team-tribunal',
  'leaderboard',
  'history',
  'ratings',
  'room',
  'provenance',
  'engine',
  'doctor',
  'last',
  'models',
  'provider',
  'config',
  'review',
  'call',
  'job',
  'agent-guide',
  'install-agent-prompts',
  'goal',
  'synthesis',
  'ask',
  'think',
  'rag',
  'nero',
  'council',
  'research',
  'conquer',
  'worktree',
  'wt',
  'attach',
  'daemon',
  'serve',
  'drive',
  'chrome',
  'ext',
  'browser-host',
  'login',
  'update',
  'upgrade',
].sort();

describe('lazySubCommands', () => {
  it('exposes exactly the same command names the static subCommands map used to', () => {
    expect(Object.keys(lazySubCommands).sort()).toEqual(EXPECTED_COMMAND_NAMES);
  });

  it('aliases share the same lazy entry (one memoized import per real command)', () => {
    expect(lazySubCommands.wt).toBe(lazySubCommands.worktree);
    expect(lazySubCommands.upgrade).toBe(lazySubCommands.update);
  });

  it('every entry has a static, synchronously-readable meta.name and meta.description (no import required for `agon --help`)', () => {
    for (const [key, entry] of Object.entries(lazySubCommands)) {
      // `entry` itself must not be a function (citty's renderUsage() calls
      // resolveValue() on it unconditionally while building the top-level
      // --help table; if it were a function, that call would trigger the
      // real dynamic import for every command on every `agon --help`).
      expect(typeof entry, `${key} must not be a lazy-resolvable function itself`).not.toBe('function');
      const meta = (entry as { meta?: unknown }).meta;
      expect(meta, `${key}.meta must be present`).toBeTruthy();
      expect(typeof meta).toBe('object');
      expect(typeof (meta as { name?: unknown }).name, `${key}.meta.name`).toBe('string');
      expect(typeof (meta as { description?: unknown }).description, `${key}.meta.description`).toBe('string');
    }
  });

  it('only commands with real nested subCommands expose a subCommands field', () => {
    const withSubCommands = new Set(['models', 'ext', 'browser-host', 'ratings', 'job']);
    for (const [key, entry] of Object.entries(lazySubCommands)) {
      const canonical = key === 'wt' ? 'worktree' : key === 'upgrade' ? 'update' : key;
      const hasField = 'subCommands' in (entry as object) && (entry as { subCommands?: unknown }).subCommands !== undefined;
      expect(hasField, `${key}.subCommands presence`).toBe(withSubCommands.has(canonical));
    }
  });

  it('lazily resolves args to match the real command module (history)', async () => {
    const lazyArgs = await (lazySubCommands.history as { args: () => Promise<unknown> }).args();
    expect(lazyArgs).toEqual(historyCommand.args);
  });

  it('lazily resolves args to match the real command module (forge)', async () => {
    const lazyArgs = await (lazySubCommands.forge as { args: () => Promise<unknown> }).args();
    expect(lazyArgs).toEqual(forgeCommand.args);
  });

  it('lazily resolves subCommands for a nested command (models) to match the real module', async () => {
    const lazySub = await (lazySubCommands.models as { subCommands: () => Promise<unknown> }).subCommands();
    expect(lazySub).toEqual(modelsCommand.subCommands);
  });

  it('ext/browser-host lazy metas carry the TOP-LEVEL parent command name, not their install subcommand\'s', async () => {
    // Regression (external review, fix 1): the generated ext.ts /
    // browser-host.ts define several defineCommand blocks — the nested
    // `install` subcommand's meta appears FIRST in the file, and the lazy
    // metas were originally copied from that block instead of the exported
    // top-level command's meta ('ext' / 'browser-host').
    const extEntry = lazySubCommands.ext as { meta: { name: string } };
    expect(extEntry.meta.name).toBe('ext');
    const browserHostEntry = lazySubCommands['browser-host'] as { meta: { name: string } };
    expect(browserHostEntry.meta.name).toBe('browser-host');
  });
});

describe('lazySubCommands — full parity with the real command modules', () => {
  // External review, fix 3: the lazy entries duplicate each command's meta
  // inline (that duplication is the POINT — `agon --help` must render the
  // full command table without importing a single command module), and the
  // hasSubCommands set is hardcoded. Both can
  // silently drift as commands evolve. This suite imports EVERY real command
  // module (test-time cost only) and asserts the lazy map matches reality,
  // turning both drift hazards into test failures instead of stale --help
  // output / a crashed nested-subcommand dispatch.
  //
  // Static import table (vite can't glob-resolve a fully-variable dynamic
  // import against .ts sources): key → [loader, exportName], mirroring the
  // exact specifiers lazy-commands.ts itself uses. The key-snapshot test
  // above guarantees this table can't silently miss a command: the
  // completeness check below fails if a lazy key has no table row.
  const REAL_COMMAND_LOADERS: Record<string, [() => Promise<Record<string, unknown>>, string]> = {
    forge: [() => import('./commands/forge.js'), 'forgeCommand'],
    brainstorm: [() => import('./commands/brainstorm.js'), 'brainstormCommand'],
    tribunal: [() => import('./commands/tribunal.js'), 'tribunalCommand'],
    campfire: [() => import('./commands/campfire.js'), 'campfireCommand'],
    'team-forge': [() => import('./commands/team-forge.js'), 'teamForgeCommand'],
    'team-brainstorm': [() => import('./commands/team-brainstorm.js'), 'teamBrainstormCommand'],
    'team-tribunal': [() => import('./commands/team-tribunal.js'), 'teamTribunalCommand'],
    leaderboard: [() => import('./commands/leaderboard.js'), 'leaderboardCommand'],
    history: [() => import('./commands/history.js'), 'historyCommand'],
    ratings: [() => import('./commands/ratings.js'), 'ratingsCommand'],
    room: [() => import('./commands/room.js'), 'roomCommand'],
    provenance: [() => import('./commands/provenance.js'), 'provenanceCommand'],
    engine: [() => import('./commands/engine.js'), 'engineCommand'],
    doctor: [() => import('./commands/doctor.js'), 'doctorCommand'],
    last: [() => import('./commands/last.js'), 'lastCommand'],
    models: [() => import('./commands/models.js'), 'modelsCommand'],
    provider: [() => import('./commands/provider.js'), 'providerCommand'],
    config: [() => import('./commands/config.js'), 'configCommand'],
    review: [() => import('./commands/review.js'), 'reviewCommand'],
    call: [() => import('./commands/call.js'), 'callCommand'],
    job: [() => import('./commands/job.js'), 'jobCommand'],
    'agent-guide': [() => import('./commands/agent-guide.js'), 'agentGuideCommand'],
    'install-agent-prompts': [() => import('./commands/install-agent-prompts.js'), 'installAgentPromptsCommand'],
    goal: [() => import('./commands/goal.js'), 'goalCommand'],
    synthesis: [() => import('./commands/synthesis.js'), 'synthesisCommand'],
    ask: [() => import('./commands/ask.js'), 'askCommand'],
    think: [() => import('./commands/think.js'), 'thinkCommand'],
    rag: [() => import('./commands/rag.js'), 'ragCommand'],
    nero: [() => import('./commands/nero.js'), 'neroCommand'],
    council: [() => import('./commands/council.js'), 'councilCommand'],
    research: [() => import('./commands/research.js'), 'researchCommand'],
    conquer: [() => import('./commands/conquer.js'), 'conquerCommand'],
    worktree: [() => import('./commands/worktree.js'), 'worktreeCommand'],
    attach: [() => import('./commands/attach.js'), 'attachCommand'],
    daemon: [() => import('./commands/daemon.js'), 'daemonCommand'],
    serve: [() => import('./commands/serve.js'), 'serveCommand'],
    drive: [() => import('./commands/drive.js'), 'driveCommand'],
    chrome: [() => import('./commands/chrome.js'), 'chromeCommand'],
    ext: [() => import('./commands/ext.js'), 'extCommand'],
    'browser-host': [() => import('./commands/browser-host.js'), 'browserHostCommand'],
    login: [() => import('./commands/login.js'), 'loginCommand'],
    update: [() => import('./commands/update.js'), 'updateCommand'],
  };
  const canonicalKeys = Object.keys(lazySubCommands).filter((k) => k !== 'wt' && k !== 'upgrade');

  it('the loader table covers every canonical lazy key (completeness guard for the parity tests)', () => {
    expect(Object.keys(REAL_COMMAND_LOADERS).sort()).toEqual([...canonicalKeys].sort());
  });

  it('meta.name and meta.description are identical to each real command module\'s meta', async () => {
    for (const key of canonicalKeys) {
      const [load, exportName] = REAL_COMMAND_LOADERS[key];
      const real = (await load())[exportName] as { meta?: { name?: string; description?: string } };
      expect(real, `real command export ${exportName} for ${key}`).toBeTruthy();
      const lazyMeta = (lazySubCommands[key] as { meta: { name?: string; description?: string } }).meta;
      expect(lazyMeta.name, `${key}: lazy meta.name vs real`).toBe(real.meta?.name);
      expect(lazyMeta.description, `${key}: lazy meta.description vs real`).toBe(real.meta?.description);
    }
  });

  it('a lazy entry exposes subCommands exactly when the real command defines subCommands', async () => {
    for (const key of canonicalKeys) {
      const [load, exportName] = REAL_COMMAND_LOADERS[key];
      const real = (await load())[exportName] as { subCommands?: unknown };
      const realHas = real.subCommands !== undefined;
      const entry = lazySubCommands[key] as { subCommands?: unknown };
      const lazyHas = 'subCommands' in entry && entry.subCommands !== undefined;
      expect(lazyHas, `${key}: hasSubCommands parity (real=${realHas})`).toBe(realHas);
    }
  });
});

describe('index.ts — repl.js/onboarding.js stay dynamically imported', () => {
  // repl.js (generated/surfaces/app.tsx — the whole Ink/React/Cesar surface,
  // ~2k lines) and onboarding.js turned out to dominate `agon --help`
  // startup even MORE than the ~40 command modules: they were static
  // top-level imports, so their module-eval cost landed on every
  // invocation even though neither is ever called outside the bare-REPL /
  // `setup` paths. index.ts can't easily be unit-tested directly (it's a
  // script with top-level process.argv/TTY-driven side effects, including
  // process.exit), so this is a source-level regression guard: a static
  // `import ... from './repl.js'` (or './onboarding.js') at the top of the
  // file would silently reintroduce the eager cost this fix removed.
  const indexSource = readFileSync(join(__dirname, 'index.ts'), 'utf-8');

  it('does not statically import repl.js', () => {
    expect(indexSource).not.toMatch(/^import .*from ['"]\.\/repl\.js['"];?$/m);
  });

  it('does not statically import onboarding.js', () => {
    expect(indexSource).not.toMatch(/^import .*from ['"]\.\/onboarding\.js['"];?$/m);
  });

  it('still references both modules via dynamic import()', () => {
    expect(indexSource).toMatch(/import\(['"]\.\/repl\.js['"]\)/);
    expect(indexSource).toMatch(/import\(['"]\.\/onboarding\.js['"]\)/);
  });
});
