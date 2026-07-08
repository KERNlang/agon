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

  it('only commands with real nested subCommands (models, ext, browser-host) expose a subCommands field', () => {
    const withSubCommands = new Set(['models', 'ext', 'browser-host']);
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

  it('meta on the lazy models/ext/browser-host entries matches the real command name exactly (name differs from the registered key)', async () => {
    const extEntry = lazySubCommands.ext as { meta: { name: string } };
    expect(extEntry.meta.name).toBe('install');
    const browserHostEntry = lazySubCommands['browser-host'] as { meta: { name: string } };
    expect(browserHostEntry.meta.name).toBe('install');
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
