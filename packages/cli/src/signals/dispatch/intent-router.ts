import { resolveWorkingDir } from '@kernlang/agon-core';

import type { DispatchCallbacks, DispatchResult } from '../dispatch.js';

import { findResumableCesarPlan, shouldApprovePendingCesarPlanInput, isCesarPlanResumeInput, isCesarPlanStatusInput, formatCesarPlanRuntimeStatus } from './plan-queries.js';

import { resumeCesarPlan, approvePendingCesarPlan } from './plan-execution.js';

import { emitPostDispatch } from './utils.js';

import { dispatchOrchestrationIntent } from './intent-orchestration.js';

import { dispatchSessionInfoIntent, runPhysicalTuiContribution } from './intent-session.js';

import { processSurfaceClient } from '../../surface-authority-runtime.js';

import { dispatchMetaIntent } from './intent-meta.js';

import { dispatchInitIntent } from './intent-init.js';

import { dispatchSkillsUiIntent } from './intent-skills.js';

/**
 * Route a parsed intent. Preamble (events/plan-guards/registry) then a chain of domain sub-dispatchers; null = unmatched, any object = terminal.
 */
export async function dispatchIntent(intent: any, input: string, cb: DispatchCallbacks): Promise<DispatchResult> {
  // ── Emit pre:dispatch event ──
  if (cb.eventBus) {
    await cb.eventBus.emit('pre:dispatch', { input, intentType: intent.type, cwd: resolveWorkingDir() });
  }
  
  if (shouldApprovePendingCesarPlanInput(input, cb.ctx)) {
    if (await approvePendingCesarPlan(cb)) {
      emitPostDispatch(intent, input, cb);
      return { handled: true, ranAsJob: false };
    }
  }
  const resumablePlan = findResumableCesarPlan(cb.ctx);
  if (resumablePlan && isCesarPlanResumeInput(input)) {
    await resumeCesarPlan(resumablePlan, cb);
    emitPostDispatch(intent, input, cb);
    return { handled: true, ranAsJob: false };
  }
  if (resumablePlan && isCesarPlanStatusInput(input)) {
    cb.dispatch({ type: 'info', message: formatCesarPlanRuntimeStatus(resumablePlan) });
    emitPostDispatch(intent, input, cb);
    return { handled: true, ranAsJob: false };
  }

  if (intent._modSurface) {
    const marker = intent._modSurface as { publicId: string; registryId: string; kind: string; value: unknown };
    const record = processSurfaceClient('tui').project().entries.find((candidate) =>
      candidate.id === marker.registryId && candidate.kind === marker.kind);
    if (!record) {
      cb.dispatch({ type: 'error', message: `generated TUI contribution is unavailable: ${marker.publicId}/${marker.registryId}` });
      emitPostDispatch(intent, input, cb);
      return { handled: true, ranAsJob: false };
    }
    const label = marker.publicId.slice(0, 40);
    cb.runAsJob(marker.publicId, label, async (signal) => {
      try {
        await runPhysicalTuiContribution(record, marker.value as any, marker.publicId, cb, signal);
      } catch (error) {
        cb.dispatch({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    });
    emitPostDispatch(intent, input, cb);
    return { handled: true, ranAsJob: true };
  }
  
  const _r = (await dispatchOrchestrationIntent(intent, input, cb))
    ?? (await dispatchSessionInfoIntent(intent, input, cb))
    ?? (await dispatchMetaIntent(intent, input, cb))
    ?? (await dispatchInitIntent(intent, input, cb))
    ?? (await dispatchSkillsUiIntent(intent, input, cb));
  if (_r) return _r;   // sub-dispatcher already fired emitPostDispatch on its break-path
  
  cb.dispatch({ type: 'warning', message: `Unknown command: ${intent.type}` });
  emitPostDispatch(intent, input, cb);
  return { handled: true, ranAsJob: false };
}
