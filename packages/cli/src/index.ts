import { defineCommand, runMain } from 'citty';
import { lazySubCommands } from './lazy-commands.js';
import { loadConfig, loadAllAuthKeys, configSet, installKernStackTraceMapper } from '@kernlang/agon-core';

// `repl.js` (the whole interactive Cesar/Ink surface, generated/surfaces/app.tsx
// — ~2k lines pulling in React/Ink + the full tool/agent stack) and
// `onboarding.js` (React/Ink + EngineRegistry + the adapter) were previously
// STATIC imports here, so their module-eval cost landed on every invocation —
// including `agon --help` and any one-shot subcommand — even though neither is
// ever called outside the bare-REPL/`setup` paths below. Loaded lazily instead,
// exactly like the subcommands in lazy-commands.ts.
const importRepl = () => import('./repl.js').then((m) => m.startRepl);
const importOnboarding = () => import('./onboarding.js').then((m) => m.runOnboarding);

// A rejected dynamic import must be LOUD. When these were static imports, a
// broken module was a top-level throw (stderr + non-zero exit); funneling an
// import failure into the interactive paths' silent `.catch(() =>
// process.exit(0))` would turn a broken install into a CLI that exits 0
// printing nothing. Used for module LOADING failures only — a user
// cancelling onboarding keeps the original quiet exit-0 behavior.
function reportInteractiveLoadFailure(err: unknown): void {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[agon] failed to load the interactive UI module: ${detail}\n`);
  process.exitCode = 1;
}

try {
  if (!process.env.AGON_NO_STACK_TRACE_MAPPER) {
    installKernStackTraceMapper();
  }
} catch {
  // Stack trace mapping is diagnostic sugar; startup should not depend on it.
}

// Load stored API keys from ~/.agon/auth.json into process.env at startup
loadAllAuthKeys();

// Global engine-isolation flags — consumed before citty so any subcommand honors
// them. They set AGON_ENGINE_ISOLATION, which the adapter resolves per dispatch
// (option > env > config > default workspace-pure). --pure/--bare/--impure are
// shorthands; --isolation <mode> is explicit.
function consumeIsolationFlags() {
  const nextArgv = process.argv.slice(0, 2);
  const args = process.argv.slice(2);
  const set = (m: string) => { process.env.AGON_ENGINE_ISOLATION = m; };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--pure') { set('workspace-pure'); continue; }
    if (arg === '--impure') { set('inherit'); continue; }
    if (arg === '--isolation') {
      const next = args[i + 1];
      // Only consume the flag when a value follows; otherwise leave it in argv
      // so the command parser can report the misuse instead of silently dropping it.
      if (next && !next.startsWith('-')) { set(next); i += 1; continue; }
      nextArgv.push(arg);
      continue;
    }
    if (arg.startsWith('--isolation=')) { set(arg.slice('--isolation='.length)); continue; }
    nextArgv.push(arg);
  }
  process.argv = nextArgv;
}

// One-time, interactive-only notice that the workspace-pure default changed
// behavior (the council asked for a LOUD migration). Never blocks startup.
function maybeNotifyIsolationMigration() {
  try {
    if (!process.stderr.isTTY) return;
    const cfg = loadConfig() as { engineIsolation?: string; isolationMigrationNotified?: boolean };
    const mode = process.env.AGON_ENGINE_ISOLATION || cfg.engineIsolation || 'workspace-pure';
    if (mode === 'inherit' || cfg.isolationMigrationNotified) return;
    process.stderr.write(
      '\n\x1b[33m▸ agon now runs engines in workspace-pure mode by default.\x1b[0m\n' +
      "  Dispatched engines no longer inherit your personal Claude Code plugins/hooks/global\n" +
      "  CLAUDE.md or user MCP servers (the repo's own CLAUDE.md/.mcp.json ARE kept). This makes\n" +
      '  results clean + fair across engines. Restore the old behavior with \x1b[36m--impure\x1b[0m or\n' +
      '  \x1b[36magon config set engineIsolation inherit\x1b[0m.\n\n',
    );
    try { configSet('isolationMigrationNotified', true); } catch { /* best-effort */ }
  } catch { /* never block startup on the notice */ }
}

function consumeTelemetryDebugFlags() {
  const nextArgv = process.argv.slice(0, 2);
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--mock-stall') {
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        process.env.AGON_MOCK_STALL_ENGINE = next;
        i += 1;
      } else {
        process.env.AGON_MOCK_STALL_ENGINE = '*';
      }
      continue;
    }
    if (arg.startsWith('--mock-stall=')) {
      process.env.AGON_MOCK_STALL_ENGINE = arg.slice('--mock-stall='.length) || '*';
      continue;
    }
    if (arg === '--mock-stall-ms') {
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        process.env.AGON_MOCK_STALL_MS = next;
        i += 1;
      }
      continue;
    }
    if (arg.startsWith('--mock-stall-ms=')) {
      process.env.AGON_MOCK_STALL_MS = arg.slice('--mock-stall-ms='.length);
      continue;
    }
    nextArgv.push(arg);
  }

  process.argv = nextArgv;
}

// `agon --continue` / `agon -c` — resume the most recent conversation for this
// directory, exactly like `claude --continue`. Only the bare-REPL form (the flag
// as the SOLE argument) is consumed; `agon --continue doctor` is left untouched so
// continuity is never silently enabled for an unrelated subcommand and the flag can
// never shadow a subcommand's own -c. Sets AGON_CONTINUE, which surfaces/app.kern
// reads to rehydrate the chat session. A bare `agon` stays fresh (no inheritance).
function consumeContinueFlag() {
  if (process.argv.length === 3 && (process.argv[2] === '--continue' || process.argv[2] === '-c')) {
    process.env.AGON_CONTINUE = '1';
    process.argv = process.argv.slice(0, 2);
  }
}

// `agon --ground` — opt-in Cesar grounding: each REPL turn retrieves cited
// context from the repo docs corpus (RAG v0) and injects it as evidence.
// Stripped from argv wherever it appears (no subcommand defines --ground);
// cesar/brain.kern reads AGON_GROUND. Persistent alternative:
// `agon config set cesarGround true`.
function consumeGroundFlag() {
  const nextArgv = process.argv.slice(0, 2);
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg === '--ground') {
      process.env.AGON_GROUND = '1';
      continue;
    }
    nextArgv.push(arg);
  }
  process.argv = nextArgv;
}

// Hard guard against recursive agon: a dispatched engine carries AGON_DISPATCH_DEPTH>0
// (stamped by computeEngineIsolation). If such a child tries to run agon again — e.g. it
// saw a "use agon" instruction — refuse, so we can't fan out into nested agon processes
// that exhaust RAM. Escape hatch: AGON_ALLOW_NESTED=1 for a deliberate nested invocation.
function guardAgainstRecursiveDispatch() {
  const depth = parseInt(process.env.AGON_DISPATCH_DEPTH ?? '0', 10) || 0;
  if (depth > 0 && process.env.AGON_ALLOW_NESTED !== '1') {
    process.stderr.write(
      `[agon] Refusing to run: a dispatched engine tried to invoke agon recursively ` +
        `(AGON_DISPATCH_DEPTH=${depth}). This guards against runaway nested-process / RAM fan-out. ` +
        `Set AGON_ALLOW_NESTED=1 to override if this nesting is intentional.\n`,
    );
    process.exit(1);
  }
}

consumeTelemetryDebugFlags();
consumeIsolationFlags();
consumeGroundFlag();
consumeContinueFlag();
guardAgainstRecursiveDispatch();
maybeNotifyIsolationMigration();

const main = defineCommand({
  meta: {
    name: 'agon',
    version: '0.3.0',
    description: 'Any AI can join. They compete. You ship.',
  },
  subCommands: lazySubCommands,
});

// Interactive REPL only when: no args at all AND stdin is a TTY
const noArgs = process.argv.length <= 2;
const isTty = process.stdin.isTTY === true;
const isSetup = process.argv[2] === 'setup';

// Both interactive modules are loaded UP FRONT (before running either), so a
// module-load failure hits the loud reporting catch while runtime rejections
// from runOnboarding() itself (user cancel) keep the original quiet exit-0.
function runOnboardingThenRepl(): void {
  Promise.all([importOnboarding(), importRepl()]).then(
    ([runOnboarding, startRepl]) => {
      runOnboarding()
        .then(() => startRepl())
        .catch(() => process.exit(0));
    },
    reportInteractiveLoadFailure,
  );
}

if (isSetup && isTty) {
  runOnboardingThenRepl();
} else if (noArgs && isTty) {
  const config = loadConfig();
  if (!config.onboarded) {
    runOnboardingThenRepl();
  } else {
    void importRepl().then((startRepl) => startRepl(), reportInteractiveLoadFailure);
  }
} else {
  runMain(main);
}
