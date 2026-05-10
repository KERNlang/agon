import { defineCommand } from 'citty';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { EngineRegistry, ensureAgonHome, RUNS_DIR } from '@agon/core';
import { resolveBuiltinEnginesDir } from '../lib/engines-dir.js';
import type { ForgeEvent, TeamEvent } from '@agon/core';
import { createCliAdapter } from '@agon/adapter-cli';
import { runTeamBrainstorm } from '@agon/forge';
import { header, success, info, table, green, bold, dim } from '../output.js';

export const teamBrainstormCommand = defineCommand({
  meta: {
    name: 'team-brainstorm',
    description: 'Team brainstorm — teams of engines collaborate on a question',
  },
  args: {
    question: {
      type: 'positional',
      description: 'Question to brainstorm',
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
    timeout: {
      type: 'string',
      description: 'Timeout in seconds',
      default: '300',
    },
  },
  async run({ args }) {
    ensureAgonHome();

    const registry = new EngineRegistry();
    registry.load(resolveBuiltinEnginesDir());

    const adapter = createCliAdapter(registry);
    const engines = args.engines?.split(',').map((s) => s.trim());
    const membersPerSide = parseInt(args.members, 10);

    const outputDir = join(RUNS_DIR, `team-brainstorm-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });

    header(`Team Brainstorm: ${args.question}`);
    info(`Members per team: ${membersPerSide}`);
    console.log('');

    const result = await runTeamBrainstorm({
      question: args.question,
      engines,
      membersPerSide,
      registry,
      adapter,
      timeout: parseInt(args.timeout, 10),
      outputDir,
      onEvent: (event: ForgeEvent | TeamEvent) => {
        if (event.type === 'team:compose' && 'data' in event && event.data?.teams) {
          const teams = event.data.teams as any[];
          info(`Team A: ${teams[0]?.members?.map((m: any) => m.engineId).join(', ') ?? '?'}`);
          info(`Team B: ${teams[1]?.members?.map((m: any) => m.engineId).join(', ') ?? '?'}`);
        }
      },
    });

    // Display results
    for (const team of result.teams) {
      const sub = result.submissions[team.teamId];
      const isWinner = result.winnerTeamId === team.teamId;
      console.log('');
      header(`${isWinner ? green(`★ ${team.teamId} (WINNER)`) : bold(team.teamId)}`);
      if (sub?.finalOutput) {
        console.log(sub.finalOutput);
      }
    }

    console.log('');
    info(dim(`Full output saved: ${outputDir}`));
  },
});
