import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { JobExecutor, JobTaskContext } from './job-service.js';
import { runWorkflowCommand } from './workflow-process.js';

export type DaemonWorkflowKind = 'brainstorm' | 'team-brainstorm' | 'tribunal' | 'team-tribunal' | 'campfire' | 'think' | 'nero' | 'council' | 'research' | 'synthesis' | 'review' | 'doctor' | 'forge' | 'team-forge' | 'pipeline';

export interface DaemonWorkflowPlan {
  kind: DaemonWorkflowKind;
  label: string;
  cwd: string;
  commands: string[][];
}

export interface DaemonWorkflowRuntimeOptions {
  script: string;
  outputChunkChars?: number;
  cancelGraceMs?: number;
}

export interface DaemonWorkflowHost {
  readonly defaults: {
    readonly jobLabelMaxChars: number;
    readonly jobOutputChunkChars: number;
    readonly jobCancelGraceMs: number;
  };
  buildCommands(options: { workflow: string; [key: string]: string | undefined }): { cwd: string; commands: string[][] };
  validateEngineRoster(engines: string | undefined, cwd: string): void;
}

export const SAFE_WORKFLOW_KINDS: readonly DaemonWorkflowKind[] = ['brainstorm','team-brainstorm','tribunal','team-tribunal','campfire','think','nero','council','research','synthesis','review','doctor','forge','team-forge','pipeline'] as const;
export const PAYLOAD_FIELDS: readonly string[] = ['input','engines','rounds','swaps','tribunalMode','tribunalProtocol','members','cwd','engineTimeout','strategy','lead','finalizeOnScore','steps','branches','critic','reasoning','focus','confidence','roles','chairman','count','engine','autoApprove'] as const;
export const STRING_PAYLOAD_FIELDS: readonly string[] = ['input','engines','rounds','swaps','tribunalMode','tribunalProtocol','members','cwd','engineTimeout','strategy','lead','finalizeOnScore','steps','branches','critic','reasoning','focus','confidence','roles','chairman','count','engine'] as const;

export function daemonWorkflowKinds(): DaemonWorkflowKind[] {
  return [...SAFE_WORKFLOW_KINDS];
}

export function positiveRuntimeInteger(value: number | undefined, fallback: number, label: string): number {
  const candidate = value ?? fallback;
  if (!Number.isFinite(candidate) || candidate < 1) throw new Error(`${label} must be a positive integer`);
  return Math.floor(candidate);
}

export function assertWorkingDirectory(cwd: string): string {
  const absolute = resolve(cwd);
  try {
    if (!statSync(absolute).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error(`Daemon job working directory does not exist: ${absolute}`);
  }
  return absolute;
}

/** The host supplies configuration and the existing workflow command compiler. */
export function createDaemonWorkflowRuntime(host: DaemonWorkflowHost) {
  function buildDaemonWorkflowPlan(kind: string, payload: Record<string, unknown>, labelMaxChars?: number): DaemonWorkflowPlan {
    const normalizedKind = String(kind ?? '').trim().toLowerCase().replace(/_/g, '-');
    if (!SAFE_WORKFLOW_KINDS.includes(normalizedKind as DaemonWorkflowKind)) {
      throw new Error(`Workflow "${normalizedKind || kind}" is not available as a daemon job`);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Daemon job payload must be an object');
    }
    for (const key of Object.keys(payload)) {
      if (!PAYLOAD_FIELDS.includes(key)) throw new Error(`Unsupported job payload field: ${key}`);
    }
    if (payload.autoApprove !== undefined) {
      if (typeof payload.autoApprove !== 'boolean') throw new Error('autoApprove must be a boolean');
      if (payload.autoApprove) throw new Error('autoApprove is not permitted for daemon jobs');
    }
    const options: { workflow: string; [key: string]: string | undefined } = { workflow: normalizedKind };
    for (const key of STRING_PAYLOAD_FIELDS) {
      const value = payload[key];
      if (value === undefined) continue;
      if (typeof value !== 'string') throw new Error(`${key} must be a string`);
      options[key] = value;
    }
    const cwd = assertWorkingDirectory(typeof payload.cwd === 'string' && payload.cwd.trim() ? payload.cwd : process.cwd());
    options.cwd = cwd;
    const built = host.buildCommands(options);
    const maxLabel = positiveRuntimeInteger(labelMaxChars, host.defaults.jobLabelMaxChars, 'jobLabelMaxChars');
    const input = typeof payload.input === 'string' ? payload.input.trim() : '';
    const label = (input || normalizedKind).slice(0, maxLabel);
    return { kind: normalizedKind as DaemonWorkflowKind, label, cwd: built.cwd, commands: built.commands };
  }

  function validateDaemonWorkflowEngines(plan: DaemonWorkflowPlan): void {
    for (const command of plan.commands) {
      for (const flag of ['--engines', '--engine']) {
        const index = command.indexOf(flag);
        if (index >= 0) host.validateEngineRoster(command[index + 1], plan.cwd);
      }
    }
  }

  function createDaemonWorkflowExecutor(plan: DaemonWorkflowPlan, options: DaemonWorkflowRuntimeOptions): JobExecutor {
    const script = String(options.script ?? '').trim();
    if (!script) throw new Error('Unable to resolve the Agon CLI entry script');
    const outputChunkChars = positiveRuntimeInteger(options.outputChunkChars, host.defaults.jobOutputChunkChars, 'jobOutputChunkChars');
    const cancelGraceMs = positiveRuntimeInteger(options.cancelGraceMs, host.defaults.jobCancelGraceMs, 'jobCancelGraceMs');
    return {
      async run(ctx: JobTaskContext): Promise<unknown> {
        const phases: Array<{ command: string; exitCode: number }> = [];
        for (const args of plan.commands) {
          if (ctx.signal.aborted) throw new Error('Cancelled');
          ctx.emit('command-started', { command: args[0], args });
          const exitCode = await runWorkflowCommand(ctx, script, args, plan.cwd, outputChunkChars, cancelGraceMs);
          phases.push({ command: args[0] ?? '', exitCode });
          if (exitCode !== 0) throw new Error(`${args[0] ?? 'workflow'} exited with code ${exitCode}`);
        }
        return { ok: true, phases };
      },
    };
  }

  return { buildDaemonWorkflowPlan, validateDaemonWorkflowEngines, createDaemonWorkflowExecutor };
}
