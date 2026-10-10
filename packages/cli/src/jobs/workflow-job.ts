import {
  createDaemonWorkflowRuntime,
  emitChunks,
  runWorkflowCommand,
} from '@kernlang/agon-mod-jobs';
export { emitChunks, runWorkflowCommand };
export { daemonWorkflowKinds, positiveRuntimeInteger, assertWorkingDirectory, SAFE_WORKFLOW_KINDS, PAYLOAD_FIELDS, STRING_PAYLOAD_FIELDS } from '@kernlang/agon-mod-jobs';
export type { DaemonWorkflowKind, DaemonWorkflowPlan, DaemonWorkflowRuntimeOptions } from '@kernlang/agon-mod-jobs';

import { resolve } from 'node:path';
import { DEFAULT_AGON_CONFIG, loadConfig } from '@kernlang/agon-core';
import type { AgonConfig, JobExecutor, JobTaskContext } from '@kernlang/agon-core';
import { buildCallCommands, validateCallEngineRoster } from '../commands/call.js';

export interface ResolvedDaemonWorkflowJob {
  label: string;
  executor: JobExecutor;
}

const workflowRuntime = createDaemonWorkflowRuntime({
  defaults: DEFAULT_AGON_CONFIG,
  buildCommands: buildCallCommands,
  validateEngineRoster: validateCallEngineRoster,
});
export const { buildDaemonWorkflowPlan, validateDaemonWorkflowEngines, createDaemonWorkflowExecutor } = workflowRuntime;

export function daemonJobConfig(cwd: string): Pick<Required<AgonConfig>,'jobEventLimit'|'jobRetentionLimit'|'jobMaxConcurrency'|'jobLabelMaxChars'|'jobOutputChunkChars'|'jobCancelGraceMs'|'jobShutdownTimeoutMs'|'daemonFrameMaxBytes'> {
  const config = { ...DEFAULT_AGON_CONFIG, ...loadConfig(cwd) } as Required<AgonConfig>;
  return {
    jobEventLimit: config.jobEventLimit,
    jobRetentionLimit: config.jobRetentionLimit,
    jobMaxConcurrency: config.jobMaxConcurrency,
    jobLabelMaxChars: config.jobLabelMaxChars,
    jobOutputChunkChars: config.jobOutputChunkChars,
    jobCancelGraceMs: config.jobCancelGraceMs,
    jobShutdownTimeoutMs: config.jobShutdownTimeoutMs,
    daemonFrameMaxBytes: config.daemonFrameMaxBytes,
  };
}

export function resolveDaemonWorkflowJob(kind: string, payload: Record<string,unknown>): ResolvedDaemonWorkflowJob {
  const requestedCwd = typeof payload.cwd === 'string' && payload.cwd.trim() ? payload.cwd : process.cwd();
  const config = daemonJobConfig(requestedCwd);
  const plan = buildDaemonWorkflowPlan(kind, payload, config.jobLabelMaxChars);
  validateDaemonWorkflowEngines(plan);
  // Deterministic cross-process integration seam. The daemon survival test
  // already sets this for prompt turns; preserve all allowlist/payload/engine
  // validation, then avoid a real engine dispatch after that boundary.
  if (process.env.AGON_DAEMON_ECHO === '1') {
    return {
      label: plan.label,
      executor: {
        async run(ctx: JobTaskContext): Promise<unknown> {
          ctx.emit('stdout', { text: `echo job: ${plan.label}\n` });
          return { ok: true, kind: plan.kind, label: plan.label };
        },
      },
    };
  }
  const script = process.argv[1] ? resolve(process.argv[1]) : '';
  if (!script) throw new Error('Unable to resolve the Agon CLI entry script');
  return {
    label: plan.label,
    executor: createDaemonWorkflowExecutor(plan, {
      script,
      outputChunkChars: config.jobOutputChunkChars,
      cancelGraceMs: config.jobCancelGraceMs,
    }),
  };
}
