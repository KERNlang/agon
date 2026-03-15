#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import { forgeCommand } from './commands/forge.js';
import { brainstormCommand } from './commands/brainstorm.js';
import { tribunalCommand } from './commands/tribunal.js';
import { leaderboardCommand } from './commands/leaderboard.js';
import { historyCommand } from './commands/history.js';
import { engineCommand } from './commands/engine.js';
import { configCommand } from './commands/config.js';

const main = defineCommand({
  meta: {
    name: 'agon',
    version: '0.1.0',
    description: 'Competitive AI orchestration framework',
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

runMain(main);
