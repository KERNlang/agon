import { defineCommand } from 'citty';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { EngineRegistry, ensureAgonHome, loadConfig, RUNS_DIR } from '@kernlang/agon-core';
import { resolveBuiltinEnginesDir } from '../generated/lib/engines-dir.js';
import type { ForgeEvent, TeamEvent } from '@kernlang/agon-core';
import { createCliAdapter } from '@kernlang/agon-adapter-cli';
import { runTeamForge } from '@kernlang/agon-forge';
import { header, success, fail, warn, info, table, green, red, bold, dim } from '../output.js';
import { filterDefaultOrchestrationEngines } from '../generated/handlers/engine-filter.js';

export const teamForgeCommand = defineCommand({
  meta: {
    name: 'team-forge',
    description: 'Team competitive forge — teams of engines race to implement a task',
  },
  args: {
    task: {
      type: 'positional',
      description: 'Task description',
      required: true,
    },
    test: {
      type: 'string',
      alias: 't',
      description: 'Fitness test command',
      required: true,
    },
    engines: {
      type: 'string',
      alias: 'e',
      description: 'Comma-separated engine list',
    },
    members: {
      type: 'string',
      alias: 'm',
      description: 'Members per team',
      default: '2',
    },
    cwd: {
      type: 'string',
      description: 'Working directory',
      default: process.cwd(),
    },
    timeout: {
      type: 'string',
      description: 'Engine timeout in seconds',
      default: '300',
    },
  },
  async run({ args }) {
    ensureAgonHome();

    const registry = new EngineRegistry();
    registry.load(resolveBuiltinEnginesDir());

    const adapter = createCliAdapter(registry);

    const forgeDir = join(RUNS_DIR, `team-forge-${Date.now()}`);
    mkdirSync(forgeDir, { recursive: true });

    const engines = args.engines
      ? args.engines.split(',').map((s) => s.trim())
      : filterDefaultOrchestrationEngines(registry.activeIds(loadConfig(args.cwd)));
    const membersPerSide = parseInt(args.members, 10);

    header(`Team Forge: ${args.task}`);
    info(`Fitness: ${args.test}`);
    info(`Members per team: ${membersPerSide}`);
    console.log('');

    const result = await runTeamForge(
      {
        task: args.task,
        fitnessCmd: args.test,
        cwd: args.cwd,
        forgeDir,
        engines,
        membersPerSide,
        timeout: parseInt(args.timeout, 10),
      },
      registry,
      adapter,
      (event: ForgeEvent | TeamEvent) => {
        if (event.type === 'team:compose' && 'data' in event && event.data?.teams) {
          const teams = event.data.teams as any[];
          info(`Team A: ${teams[0]?.members?.map((m: any) => m.engineId).join(', ') ?? '?'}`);
          info(`Team B: ${teams[1]?.members?.map((m: any) => m.engineId).join(', ') ?? '?'}`);
        }
        if (event.type === 'team:member-dispatch' && 'data' in event && (event as any).data?.engineId) {
          info(`  Dispatching ${(event as any).data.engineId}...`);
        }
      },
    );

    // Display results
    console.log('');
    header('Results');

    const teamA = result.teams[0];
    const teamB = result.teams[1];

    for (const team of [teamA, teamB]) {
      const sub = result.submissions[team.teamId];
      const card = result.scorecards[team.teamId];
      const isWinner = result.winnerTeamId === team.teamId;
      const label = isWinner ? green(`${team.teamId} (WINNER)`) : team.teamId;

      console.log('');
      info(`${bold(label)}`);
      if (card) {
        info(`  Score: ${card.score ?? 'N/A'}`);
      }
      if (sub) {
        info(`  Members: ${team.members.map((m: any) => `${m.engineId}(${m.role})`).join(', ')}`);
      }
    }

    console.log('');
    info(dim(`Full output saved: ${forgeDir}`));
  },
});
