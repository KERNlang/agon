#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import { forgeCommand } from './commands/forge.js';
import { brainstormCommand } from './commands/brainstorm.js';
import { tribunalCommand } from './commands/tribunal.js';
import { leaderboardCommand } from './commands/leaderboard.js';
import { historyCommand } from './commands/history.js';
import { engineCommand } from './commands/engine.js';
import { configCommand } from './commands/config.js';
import { startRepl } from './repl.js';
import { runOnboarding } from './onboarding.js';
import { loadConfig } from '@agon/core';

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
    config: configCommand,
  },
});

// Interactive REPL only when: no args at all AND stdin is a TTY
const noArgs = process.argv.length <= 2;
const isTty = process.stdin.isTTY === true;
const isSetup = process.argv[2] === 'setup';

if (isSetup && isTty) {
  // agon setup — re-run onboarding
  runOnboarding().then(() => startRepl());
} else if (noArgs && isTty) {
  // First run → onboarding, then REPL
  const config = loadConfig();
  if (!config.onboarded) {
    runOnboarding().then(() => startRepl());
  } else {
    startRepl();
  }
} else {
  runMain(main);
}
