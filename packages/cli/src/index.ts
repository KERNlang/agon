import { defineCommand, runMain } from 'citty';
import { forgeCommand } from './commands/forge.js';
import { brainstormCommand } from './commands/brainstorm.js';
import { tribunalCommand } from './commands/tribunal.js';
import { campfireCommand } from './commands/campfire.js';
import { teamForgeCommand } from './commands/team-forge.js';
import { teamBrainstormCommand } from './commands/team-brainstorm.js';
import { teamTribunalCommand } from './commands/team-tribunal.js';
import { leaderboardCommand } from './commands/leaderboard.js';
import { historyCommand } from './commands/history.js';
import { provenanceCommand } from './commands/provenance.js';
import { engineCommand } from './commands/engine.js';
import { doctorCommand } from './commands/doctor.js';
import { lastCommand } from './commands/last.js';
import { modelsCommand } from './commands/models.js';
import { configCommand } from './commands/config.js';
import { providerCommand } from './commands/provider.js';
import { reviewCommand } from './commands/review.js';
import { callCommand } from './commands/call.js';
import { agentGuideCommand } from './commands/agent-guide.js';
import { installAgentPromptsCommand } from './commands/install-agent-prompts.js';
import { goalCommand } from './commands/goal.js';
import { synthesisCommand } from './commands/synthesis.js';
import { askCommand } from './commands/ask.js';
import { thinkCommand } from './commands/think.js';
import { neroCommand } from './commands/nero.js';
import { councilCommand } from './commands/council.js';
import { conquerCommand } from './commands/conquer.js';
import { worktreeCommand } from './commands/worktree.js';
import { loginCommand } from './commands/login.js';
import { startRepl } from './repl.js';
import { runOnboarding } from './onboarding.js';
import { loadConfig, loadAllAuthKeys, configSet } from '@kernlang/agon-core';

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
consumeContinueFlag();
guardAgainstRecursiveDispatch();
maybeNotifyIsolationMigration();

const main = defineCommand({
  meta: {
    name: 'agon',
    version: '0.1.2',
    description: 'Any AI can join. They compete. You ship.',
  },
  subCommands: {
    forge: forgeCommand,
    brainstorm: brainstormCommand,
    tribunal: tribunalCommand,
    campfire: campfireCommand,
    'team-forge': teamForgeCommand,
    'team-brainstorm': teamBrainstormCommand,
    'team-tribunal': teamTribunalCommand,
    leaderboard: leaderboardCommand,
    history: historyCommand,
    provenance: provenanceCommand,
    engine: engineCommand,
    doctor: doctorCommand,
    last: lastCommand,
    models: modelsCommand,
    provider: providerCommand,
    config: configCommand,
    review: reviewCommand,
    call: callCommand,
    'agent-guide': agentGuideCommand,
    'install-agent-prompts': installAgentPromptsCommand,
    goal: goalCommand,
    synthesis: synthesisCommand,
    ask: askCommand,
    think: thinkCommand,
    nero: neroCommand,
    council: councilCommand,
    conquer: conquerCommand,
    worktree: worktreeCommand,
    wt: worktreeCommand,
    login: loginCommand,
  },
});

// Interactive REPL only when: no args at all AND stdin is a TTY
const noArgs = process.argv.length <= 2;
const isTty = process.stdin.isTTY === true;
const isSetup = process.argv[2] === 'setup';

if (isSetup && isTty) {
  runOnboarding()
    .then(() => startRepl())
    .catch(() => process.exit(0));
} else if (noArgs && isTty) {
  const config = loadConfig();
  if (!config.onboarded) {
    runOnboarding()
      .then(() => startRepl())
      .catch(() => process.exit(0));
  } else {
    startRepl();
  }
} else {
  runMain(main);
}
