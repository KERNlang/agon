import { spawn } from 'node:child_process';
import { defineCommand } from 'citty';
import { fail, info } from '../output.js';

export interface CallCommandOptions {
  workflow: string;
  input?: string;
  team?: boolean;
  engines?: string;
  fitnessCmd?: string;
  rounds?: string;
  tribunalMode?: string;
  members?: string;
  cwd?: string;
  engineTimeout?: string;
  strategy?: string;
  lead?: string;
  finalizeOnScore?: string;
}

export interface BuiltCallCommands {
  cwd: string;
  commands: string[][];
}

function textFlag(flag: string, value: string | undefined): string[] {
  const text = value?.trim();
  return text ? [flag, text] : [];
}

function requireInput(workflow: string, input: string | undefined): string {
  const text = input?.trim();
  if (!text) {
    throw new Error(`agon call ${workflow} requires a prompt/task argument`);
  }
  return text;
}

function exitWithFailure(message: string): never {
  fail(message);
  process.exit(1);
  throw new Error('process.exit returned unexpectedly');
}

export function normalizeCallWorkflow(workflow: string): string {
  return workflow.trim().toLowerCase().replace(/_/g, '-');
}

export function buildCallCommands(opts: CallCommandOptions): BuiltCallCommands {
  const workflow = normalizeCallWorkflow(opts.workflow);
  const cwd = opts.cwd?.trim() || process.cwd();
  const engines = textFlag('--engines', opts.engines);
  const timeout = textFlag('--timeout', opts.engineTimeout);
  const tribunalMode = textFlag('--mode', opts.tribunalMode);
  const commands: string[][] = [];

  if (workflow === 'tribunal' || workflow === 'team-tribunal') {
    const question = requireInput(workflow, opts.input);
    const team = opts.team || workflow === 'team-tribunal';
    commands.push([
      team ? 'team-tribunal' : 'tribunal',
      question,
      ...textFlag('--rounds', opts.rounds),
      ...tribunalMode,
      ...(team ? textFlag('--members', opts.members) : []),
      ...timeout,
      ...engines,
    ]);
  } else if (workflow === 'brainstorm' || workflow === 'team-brainstorm') {
    const question = requireInput(workflow, opts.input);
    const team = opts.team || workflow === 'team-brainstorm';
    commands.push([
      team ? 'team-brainstorm' : 'brainstorm',
      question,
      ...(team ? textFlag('--members', opts.members) : []),
      ...timeout,
      ...engines,
    ]);
  } else if (workflow === 'forge' || workflow === 'team-forge') {
    const task = requireInput(workflow, opts.input);
    const team = opts.team || workflow === 'team-forge';
    commands.push([
      team ? 'team-forge' : 'forge',
      task,
      '--test',
      opts.fitnessCmd?.trim() || 'true',
      '--cwd',
      cwd,
      ...(team ? textFlag('--members', opts.members) : []),
      ...timeout,
      ...engines,
      ...(team ? [] : textFlag('--finalize-on-score', opts.finalizeOnScore)),
    ]);
  } else if (workflow === 'campfire') {
    commands.push([
      'campfire',
      requireInput(workflow, opts.input),
      ...textFlag('--strategy', opts.strategy),
      ...textFlag('--lead', opts.lead),
      ...timeout,
      ...engines,
    ]);
  } else if (workflow === 'review') {
    commands.push(['review', opts.input?.trim() || 'uncommitted', ...timeout, ...engines]);
  } else if (workflow === 'doctor') {
    // Passthrough so external CLIs that standardize on `agon call <workflow>`
    // can reach the top-level doctor. `agon call doctor` -> `agon doctor`,
    // `agon call doctor harness` -> `agon doctor harness`. Forward --timeout
    // and --engines too so `agon call doctor review --engines x --timeout 15`
    // reaches the doctor-review smoke test (they're ignored by other scopes).
    commands.push(['doctor', opts.input?.trim() || 'engines', ...timeout, ...engines]);
  } else if (workflow === 'pipeline') {
    const task = requireInput(workflow, opts.input);
    const fitness = opts.fitnessCmd?.trim() || 'true';
    commands.push(['brainstorm', task, ...timeout, ...engines]);
    commands.push(['forge', task, '--test', fitness, '--cwd', cwd, ...timeout, ...engines]);
    commands.push(['tribunal', `Review the pipeline result for: ${task}`, '--rounds', opts.rounds?.trim() || '1', ...tribunalMode, ...timeout, ...engines]);
  } else {
    throw new Error(`Unknown call workflow: ${opts.workflow}. Use forge, brainstorm, tribunal, campfire, pipeline, review, doctor, or a team-* workflow.`);
  }

  return { cwd, commands };
}

function writeJsonl(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n`);
}

async function runCommand(command: string, args: string[], cwd: string, jsonl: boolean): Promise<number> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    if (jsonl) {
      writeJsonl({ type: 'agon.call.command.start', command: [command, ...args], cwd });
    }

    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        AGON_CALL_DEPTH: String(Number(process.env.AGON_CALL_DEPTH ?? '0') + 1),
        AGON_CWD: cwd,
      },
      stdio: jsonl ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });

    if (jsonl) {
      child.stdout?.on('data', (chunk) => writeJsonl({ type: 'agon.call.stdout', data: String(chunk) }));
      child.stderr?.on('data', (chunk) => writeJsonl({ type: 'agon.call.stderr', data: String(chunk) }));
    }

    child.on('error', (err) => {
      if (jsonl) writeJsonl({ type: 'agon.call.command.error', error: err.message });
      else fail(err.message);
      resolve(1);
    });

    child.on('close', (code, signal) => {
      const exitCode = typeof code === 'number' ? code : 1;
      if (jsonl) {
        writeJsonl({
          type: 'agon.call.command.done',
          exitCode,
          signal,
          durationMs: Date.now() - startedAt,
        });
      }
      resolve(exitCode);
    });
  });
}

export const callCommand = defineCommand({
  meta: {
    name: 'call',
    description: 'Live bridge for external CLIs to run Agon modes',
  },
  args: {
    workflow: {
      type: 'positional',
      description: 'Workflow: forge, brainstorm, tribunal, campfire, pipeline, review, doctor, or team-*',
      required: true,
    },
    input: {
      type: 'positional',
      description: 'Prompt, task, topic, or review target',
      required: false,
    },
    team: {
      type: 'boolean',
      description: 'Use the team variant when available',
      default: false,
    },
    engines: {
      type: 'string',
      alias: 'e',
      description: 'Comma-separated engine list',
    },
    test: {
      type: 'string',
      alias: 't',
      description: 'Fitness test command for forge/pipeline',
    },
    rounds: {
      type: 'string',
      alias: 'r',
      description: 'Tribunal rounds',
    },
    tribunalMode: {
      type: 'string',
      description: 'Tribunal mode: adversarial, synthesis, steelman, socratic, red-team, postmortem',
    },
    members: {
      type: 'string',
      alias: 'm',
      description: 'Team members per side',
    },
    cwd: {
      type: 'string',
      description: 'Working directory',
    },
    timeout: {
      type: 'string',
      description: 'Per-engine timeout in seconds',
    },
    strategy: {
      type: 'string',
      description: 'Campfire strategy: lead-first or all-respond',
    },
    lead: {
      type: 'string',
      description: 'Lead engine for campfire lead-first strategy',
    },
    jsonl: {
      type: 'boolean',
      description: 'Emit machine-readable JSONL lifecycle and output chunks',
      default: false,
    },
    finalizeOnScore: {
      type: 'string',
      description: 'For solo forge: finalize as soon as any engine PASSES with score >= N',
    },
  },
  async run({ args }) {
    let built: BuiltCallCommands;
    try {
      built = buildCallCommands({
        workflow: args.workflow,
        input: args.input,
        team: args.team,
        engines: args.engines,
        fitnessCmd: args.test,
        rounds: args.rounds,
        tribunalMode: args.tribunalMode,
        members: args.members,
        cwd: args.cwd,
        engineTimeout: args.timeout,
        strategy: args.strategy,
        lead: args.lead,
        finalizeOnScore: args.finalizeOnScore,
      });
    } catch (err) {
      exitWithFailure(err instanceof Error ? err.message : String(err));
    }

    const script = process.argv[1];
    if (!script) {
      exitWithFailure('Unable to resolve current Agon CLI entry script.');
    }

    if (!args.jsonl) {
      info(`Agon call: ${built.commands.map((cmd) => cmd[0]).join(' -> ')}`);
    } else {
      writeJsonl({ type: 'agon.call.start', commands: built.commands, cwd: built.cwd });
    }

    for (const commandArgs of built.commands) {
      const exitCode = await runCommand(process.execPath, [script, ...commandArgs], built.cwd, args.jsonl);
      if (exitCode !== 0) {
        if (args.jsonl) writeJsonl({ type: 'agon.call.done', ok: false, exitCode });
        process.exit(exitCode);
      }
    }

    if (args.jsonl) writeJsonl({ type: 'agon.call.done', ok: true, exitCode: 0 });
  },
});
