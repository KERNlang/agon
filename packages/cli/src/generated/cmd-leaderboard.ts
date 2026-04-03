import { defineCommand } from 'citty';

import { getElo } from '@agon/core';

import { header, table, bold, dim, info } from '../output.js';

export const leaderboardCommand: any = defineCommand({
  meta: {
    name: 'leaderboard',
    description: 'Show ELO leaderboard',
  },
  args: {
    taskClass: {
      type: 'string',
      alias: 'c',
      description: 'Filter by task class (algorithm, refactor, bugfix, test, docs, feature)',
    },
  },
  run({ args }) {
    const elo = getElo();

    if (args.taskClass) {
      header(`Leaderboard: ${args.taskClass}`);
      const classRatings = elo.byTaskClass[args.taskClass] ?? {};
      const rows = Object.entries(classRatings)
        .sort(([, a], [, b]) => (b as any).rating - (a as any).rating)
        .map(([id, r]: [string, any], i: number) => [
          `${i + 1}.`,
          bold(id),
          String(r.rating),
          String(r.wins),
          String(r.losses),
          `${r.wins + r.losses > 0 ? Math.round((r.wins / (r.wins + r.losses)) * 100) : 0}%`,
        ]);

      if (rows.length === 0) {
        info('No matches recorded for this task class');
        return;
      }

      table(['#', 'Engine', 'ELO', 'W', 'L', 'Win%'], rows);
    } else {
      header('Global Leaderboard');
      const rows = Object.entries(elo.global)
        .sort(([, a], [, b]) => (b as any).rating - (a as any).rating)
        .map(([id, r]: [string, any], i: number) => [
          `${i + 1}.`,
          bold(id),
          String(r.rating),
          String(r.wins),
          String(r.losses),
          `${r.wins + r.losses > 0 ? Math.round((r.wins / (r.wins + r.losses)) * 100) : 0}%`,
        ]);

      if (rows.length === 0) {
        info('No matches recorded. Run `agon forge` to start competing!');
        return;
      }

      table(['#', 'Engine', 'ELO', 'W', 'L', 'Win%'], rows);

      // Also show per-class if any
      const classes = Object.keys(elo.byTaskClass);
      if (classes.length > 0) {
        console.log('');
        info(`Task classes with data: ${classes.join(', ')}`);
        info('Use --task-class <class> to see per-class ratings');
      }
    }

    console.log('');
    info(dim(`Last updated: ${elo.lastUpdated}`));
  },
});

