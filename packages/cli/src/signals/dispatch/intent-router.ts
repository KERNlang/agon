import { resolveWorkingDir } from '@kernlang/agon-core';
import type { RegistryRecord } from '@kernlang/agon-kernel';

import type { DispatchCallbacks, DispatchResult } from '../dispatch.js';

import { dispatchPlanNaturalInput } from '@kernlang/agon-mod-plan';
import { createPlanExecutionSession } from '../../blocks/plan-execution-effects.js';

import { emitPostDispatch } from './utils.js';

import { dispatchOrchestrationIntent } from './intent-orchestration.js';

import { dispatchSessionInfoIntent, runPhysicalTuiContribution } from './intent-session.js';

import { assertProcessSurfaceAvailable, captureProcessSurfaceAuthority, processSurfaceClient } from '../../surface-authority-runtime.js';

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
  
  const execution = createPlanExecutionSession(cb);
  if (await dispatchPlanNaturalInput(input, {
    snapshot: () => ({ proposedPlan: cb.ctx.cesar?.proposedPlan, activePlan: cb.ctx.activePlan }),
    assertAvailable: action => assertProcessSurfaceAvailable('tui', action),
    approve: () => execution.approvePending(),
    resume: plan => execution.resume(plan),
    notify: (type, message) => cb.dispatch({ type, message }),
  })) {
    emitPostDispatch(intent, input, cb);
    return { handled: true, ranAsJob: false };
  }

  if (intent._modSurface) {
    const marker = intent._modSurface as { publicId: string; registryId: string; kind: string; value: unknown };
    let record: RegistryRecord | undefined;
    let assertSelected: () => void;
    try {
      assertSelected = captureProcessSurfaceAuthority();
      record = processSurfaceClient('tui').project().entries.find((candidate) =>
        candidate.id === marker.registryId && candidate.kind === marker.kind);
    } catch (error) {
      cb.dispatch({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      emitPostDispatch(intent, input, cb);
      return { handled: true, ranAsJob: false };
    }
    if (!record) {
      cb.dispatch({ type: 'error', message: `generated TUI contribution is unavailable: ${marker.publicId}/${marker.registryId}` });
      emitPostDispatch(intent, input, cb);
      return { handled: true, ranAsJob: false };
    }
    if (record.owner.id === 'agon.think' || record.owner.id === 'agon.synthesis'
      || (record.owner.id === 'agon.council' && marker.publicId === 'council')) {
      // Generated and legacy-shaped intents share their workflow job boundary.
      const type = record.owner.id === 'agon.think' ? 'think'
        : record.owner.id === 'agon.synthesis' ? 'synthesis' : 'council';
      const result = await dispatchOrchestrationIntent({ ...(marker.value as object), type }, input, cb);
      emitPostDispatch(intent, input, cb);
      return result!;
    }
    const label = marker.publicId.slice(0, 40);
    if (record.owner.id === 'agon.jobs') {
      try {
        await runPhysicalTuiContribution(record, marker.value as any, marker.publicId, cb, new AbortController().signal);
      } catch (error) {
        cb.dispatch({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
      emitPostDispatch(intent, input, cb);
      return { handled: true, ranAsJob: false };
    }
    cb.runAsJob(marker.publicId, label, async (signal) => {
      try {
        assertSelected();
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
