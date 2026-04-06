#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import { forgeCommand } from './commands/forge.js';
import { brainstormCommand } from './commands/brainstorm.js';
import { tribunalCommand } from './commands/tribunal.js';
import { leaderboardCommand } from './commands/leaderboard.js';
import { historyCommand } from './commands/history.js';
import { engineCommand } from './commands/engine.js';
import { configCommand } from './commands/config.js';
import { providerCommand } from './commands/provider.js';
import { startRepl } from './repl.js';
import { runOnboarding } from './onboarding.js';
import { loadConfig, loadAllAuthKeys } from '@agon/core';

// Load stored API keys from ~/.agon/auth.json into process.env at startup
loadAllAuthKeys();

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
    leaderboard: leaderboardCommand,
    history: historyCommand,
    engine: engineCommand,
    provider: providerCommand,
    config: configCommand,
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
