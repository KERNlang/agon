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
import { engineCommand } from './commands/engine.js';
import { doctorCommand } from './commands/doctor.js';
import { lastCommand } from './commands/last.js';
import { modelsCommand } from './commands/models.js';
import { configCommand } from './commands/config.js';
import { providerCommand } from './commands/provider.js';
import { reviewCommand } from './commands/review.js';
import { callCommand } from './commands/call.js';
import { startRepl } from './repl.js';
import { runOnboarding } from './onboarding.js';
import { loadConfig, loadAllAuthKeys } from '@agon/core';

// Load stored API keys from ~/.agon/auth.json into process.env at startup
loadAllAuthKeys();

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

consumeTelemetryDebugFlags();

const main = defineCommand({
  meta: {
    name: 'agon',
    version: '0.1.0',
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
    engine: engineCommand,
    doctor: doctorCommand,
    last: lastCommand,
    models: modelsCommand,
    provider: providerCommand,
    config: configCommand,
    review: reviewCommand,
    call: callCommand,
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
