import { defineCommand } from 'citty';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { EngineRegistry, ensureAgonHome, loadConfig, RUNS_DIR } from '@kernlang/agon-core';
import { resolveBuiltinEnginesDir } from '../lib/engines-dir.js';
import type { ForgeEvent, TeamEvent, TeamSpec } from '@kernlang/agon-core';
import { createCliAdapter } from '@kernlang/agon-adapter-cli';
import { runTeamForge } from '@kernlang/agon-forge';
import { header, info, warn, green, bold, dim } from '../blocks/output-format.js';
import { filterDefaultOrchestrationEngines } from '../handlers/engine-filter.js';

/** One rendered result row for a team that took part in the match. */
export interface TeamForgeResultRow {
  teamId: string;
  isWinner: boolean;
  /** null when the match carries no scorecard for this team. */
  score: string | null;
  /** null when this team never submitted (its members are then unknown). */
  members: string | null;
}

export interface TeamForgeResultView {
  rows: TeamForgeResultRow[];
  /** Non-null when fewer than the expected two teams reported. */
  warning: string | null;
}

/** The loose shape this renderer needs — a real TeamMatchResult satisfies it. */
export interface TeamForgeResultInput {
  teams?: readonly (TeamSpec | undefined)[];
  submissions?: Record<string, unknown>;
  scorecards?: Record<string, { score?: number } | undefined>;
  winnerTeamId?: string | null;
}

/**
 * Build the "Results" rows for a finished team-forge match.
 *
 * `TeamMatchResult.teams` is TYPED as a 2-tuple, but that is a promise only the
 * happy path keeps: a run aborted mid-compose, a result rehydrated from a
 * `result.json` bundle (which persists `teams: []` on the error path), or any
 * future producer can hand back fewer than two teams. The old code indexed
 * `teams[0]`/`teams[1]` and dereferenced `team.teamId`, so one missing team
 * turned into a TypeError that ALSO destroyed the half of the match that did
 * complete. Render whatever exists and say what is missing instead.
 */
export function buildTeamForgeResultView(result: TeamForgeResultInput): TeamForgeResultView {
  const rawTeams: readonly (TeamSpec | undefined)[] = result.teams ?? [];
  const teams = rawTeams.filter((team): team is TeamSpec => !!team && typeof team.teamId === 'string');

  const rows = teams.map((team): TeamForgeResultRow => {
    const sub = result.submissions?.[team.teamId];
    const card = result.scorecards?.[team.teamId];
    return {
      teamId: team.teamId,
      isWinner: !!result.winnerTeamId && result.winnerTeamId === team.teamId,
      score: card ? String(card.score ?? 'N/A') : null,
      members: sub ? (team.members ?? []).map((m) => `${m.engineId}(${m.role})`).join(', ') : null,
    };
  });

  let warning: string | null = null;
  if (rows.length === 0) {
    warning = 'No team results to show — the match reported no teams (engine failures or an aborted run).';
  } else if (rows.length < 2) {
    warning = `Only ${rows.length} of 2 teams reported — showing the partial match.`;
  }

  return { rows, warning };
}

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

    const view = buildTeamForgeResultView(result);
    if (view.warning) {
      warn(view.warning);
    }

    for (const row of view.rows) {
      const label = row.isWinner ? green(`${row.teamId} (WINNER)`) : row.teamId;

      console.log('');
      info(`${bold(label)}`);
      if (row.score !== null) {
        info(`  Score: ${row.score}`);
      }
      if (row.members !== null) {
        info(`  Members: ${row.members}`);
      }
    }

    console.log('');
    info(dim(`Full output saved: ${forgeDir}`));
  },
});
