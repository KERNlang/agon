import { defineCommand } from 'citty';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { EngineRegistry, ensureAgonHome, RUNS_DIR } from '@agon/core';
import { resolveBuiltinEnginesDir } from '../generated/lib/engines-dir.js';
import type { ForgeEvent, TeamEvent } from '@agon/core';
import { createCliAdapter } from '@agon/adapter-cli';
import { runTeamTribunal } from '@agon/forge';
import type { TribunalMode } from '@agon/forge';
import { header, success, fail, info, bold, dim, green } from '../output.js';

export const teamTribunalCommand = defineCommand({
  meta: {
    name: 'team-tribunal',
    description: 'Team tribunal — teams of engines argue different sides of a question',
  },
  args: {
    question: {
      type: 'positional',
      description: 'Question to debate',
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
    rounds: {
      type: 'string',
      alias: 'r',
      description: 'Number of debate rounds',
      default: '2',
    },
    mode: {
      type: 'string',
      description: 'Tribunal mode (adversarial, synthesis, steelman, socratic, red-team, postmortem)',
      default: 'adversarial',
    },
    timeout: {
      type: 'string',
      description: 'Timeout per engine in seconds',
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
    const rounds = parseInt(args.rounds, 10);
    const mode = args.mode as TribunalMode;

    const outputDir = join(RUNS_DIR, `team-tribunal-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });

    header(`Team Tribunal: ${args.question}`);
    info(`Members per team: ${membersPerSide}`);
    info(`Rounds: ${rounds}`);
    info(`Mode: ${mode}`);
    console.log('');

    const result = await runTeamTribunal({
      question: args.question,
      engines,
      membersPerSide,
      rounds,
      mode,
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
        const text = typeof sub.finalOutput === 'string' ? sub.finalOutput : JSON.stringify(sub.finalOutput);
        console.log(text.slice(0, 500));
        if (text.length > 500) console.log(dim('...(truncated)'));
      }
    }

    console.log('');
    info(dim(`Full output saved: ${outputDir}`));
  },
});
