import { defineCommand, runMain } from 'citty';
import { forgeCommand } from './commands/forge.js';
import { brainstormCommand } from './commands/brainstorm.js';
import { leaderboardCommand } from './commands/leaderboard.js';
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
    leaderboard: leaderboardCommand,
    engine: engineCommand,
    config: configCommand,
  },
});

runMain(main);
