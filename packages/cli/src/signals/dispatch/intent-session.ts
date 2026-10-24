import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPatchApplicationUi, withPatchApplication } from '../../patch-application-host.js';
import { escapeLiteralText } from '../../blocks/literal-text.js';
import { withPlanSession, dispatchPlanSession, createPlanSessionActions, loadCesarPlan, shouldEmitPlanPostDispatch, selectResumablePlan } from '@kernlang/agon-mod-plan';
import type { PlanSessionActions, PlanSessionDispatchResult } from '@kernlang/agon-mod-plan';
import type { SessionJobsInvocationContext } from '@kernlang/agon-mod-jobs';
import { runBrainstormSession } from '../../blocks/brainstorm-session.js';
import { runTribunalSession } from '../../blocks/tribunal-session.js';
import { runConquerSession } from '../../blocks/conquer-session.js';
import { runCampfireSession } from '../../blocks/campfire-session.js';
import { worktreePlanHost } from '../../blocks/worktree-plan-effects.js';

import { resolveWorkingDir, buildImageAttachment, sessionContext, visionSupportNote } from '@kernlang/agon-core';

import { invalidateCwdCache } from '../../handlers/chat.js';

import type { ImageAttachment } from '@kernlang/agon-core';
import type { CommandResult, IntentContribution, Json, ModPlatform, PlanSessionRequest } from '@kernlang/agon-mod-api';

import { assertContributionInput, selectModSettings } from '@kernlang/agon-kernel';
import { assertProcessSurfaceAvailable, modularHostRoot, processSurfaceCatalog, processSurfaceClient } from '../../surface-authority-runtime.js';

import { ENGINE_COLORS } from '../../blocks/output-format.js';

import { handleLeaderboard, handleCesarReport, handleCesarHints, handleHistory, handleEngines, handleDiscover, handleConfig, handlePermissions, handleUse, handleCesar, handleTokens, handleRaw, handleWorkspace, handleChats, handleCp, handleCpLast, handleCommit, handleFlowReport, handleFlowAnalysis, handleRun } from '../../handlers/index.js';

import { handleProvider } from '../../handlers/provider.js';

import { diagnoseEngineDoctorEntry, checkDoctorWorktree, buildHarnessDoctorReport, buildModularDoctorReport } from '../../commands/doctor.js';

import { replayCesarHarnessLogs } from '../../cesar/tool-observability.js';

import { renderTelemetrySnapshot, computeOverallHealth, createEngineVitals } from '../../cesar/telemetry.js';

import type { TelemetrySnapshot } from '../../cesar/telemetry.js';

import type { DispatchCallbacks, DispatchResult } from '../dispatch.js';

import { createPlanExecutionSession } from '../../blocks/plan-execution-effects.js';

import { routeWithCesar } from './cesar-router.js';

import { emitPostDispatch } from './utils.js';

/** Bind terminal effects without supplying another session dispatcher. */
function interactivePlanActions(cb: DispatchCallbacks): PlanSessionActions {
  const execution = createPlanExecutionSession(cb);
  return createPlanSessionActions({
    worktree: () => worktreePlanHost(cb.dispatch, cb.ctx),
    taskSession: {
      setActive: plan => cb.setActivePlan(plan),
      prepare: () => {
        if (!cb.ctx.cesar) cb.ctx.cesar = {
          busy: false, busySince: null, queue: null,
          toolRegistry: null, hasNativeTools: false, lastDispatch: null,
          pendingDelegation: null, reportedConfidence: undefined, reportedConfidenceReasoning: undefined, confidenceSatisfied: false, blockedOnConfidence: null,
          autoNero: false, advisorPending: false, lastEscalation: null,
          mcpFingerprint: undefined, mcpSignalPath: undefined, planDispatch: null, proposedPlan: undefined, sessionMcpServers: [],
        };
        cb.ctx.cesar.planDispatch = cb.dispatch;
      },
      route: value => routeWithCesar(value, [], cb),
      proposed: () => cb.ctx.cesar?.proposedPlan,
      acceptProposal: plan => execution.propose(plan),
    },
    resumeSession: {
      load: loadCesarPlan,
      current: () => selectResumablePlan({ proposedPlan: cb.ctx.cesar?.proposedPlan, activePlan: cb.ctx.activePlan }),
      resume: plan => execution.resume(plan),
      notify: (type, message) => cb.dispatch({ type, message }),
    },
    approvePending: () => execution.approvePending(),
    cancelPending: () => execution.cancelPending(),
    auto: async intent => (await import('./intent-skills.js')).dispatchSkillsUiIntent(intent, '', cb),
  });
}

function finishPlanDispatch(request: PlanSessionRequest, input: string, cb: DispatchCallbacks, result: PlanSessionDispatchResult | null): void {
  if (shouldEmitPlanPostDispatch(request, result)) emitPostDispatch(request, input, cb);
}

async function runInteractivePlanRequest(request: PlanSessionRequest, input: string, cb: DispatchCallbacks) {
  const result = await dispatchPlanSession(request, interactivePlanActions(cb));
  finishPlanDispatch(request, input, cb, result);
  return result;
}

export async function dispatchSessionInfoIntent(intent: any, input: string, cb: DispatchCallbacks): Promise<DispatchResult | null> {
  switch (intent.type) {
    case 'run': await handleRun(intent.input, cb.dispatch, cb.ctx); break;
    case 'chat': {
      if (await routeWithCesar(intent.input ?? '', cb.allImages, cb)) return { handled: true, ranAsJob: true };
      break;
    }
    case 'img': {
      const att = buildImageAttachment(intent.path, resolveWorkingDir());
      if (!att) cb.dispatch({ type: 'error', message: `Image not found: ${intent.path}` });
      else {
        cb.setPendingImages((prev: ImageAttachment[]) => [...prev, att]);
        cb.dispatch({ type: 'success', message: `Attached: ${att.filename}` });
        // Warn at attach time, not after dispatch: the user should know the
        // current brain can't see the image while they can still /cesar away.
        try {
          const cesarId = (cb.ctx.config as any).cesarEngine ?? cb.ctx.config.forgeFixedStarter ?? 'claude';
          const note = visionSupportNote(cb.ctx.registry.get(cesarId));
          if (note) cb.dispatch({ type: 'warning', message: note });
        } catch { /* unknown engine id — dispatch-time status note still covers it */ }
      }
      break;
    }
  
    // ── Info commands ──
    case 'leaderboard': handleLeaderboard(cb.dispatch); break;
    case 'cesar-report': handleCesarReport(cb.dispatch); break;
    case 'cesar-hints': handleCesarHints(intent.input, cb.dispatch, cb.ctx); break;
    case 'history': handleHistory(cb.dispatch, intent.id); break;
    case 'doctor': {
      const scope = String(intent.scope ?? 'engines').trim() || 'engines';
      if (scope === 'harness') {
        const report = buildHarnessDoctorReport(cb.ctx.registry, cb.ctx.config, cb.ctx.cesar);
        cb.dispatch({ type: 'header', title: 'Harness Doctor' });
        cb.dispatch({
          type: 'table',
          headers: report.headers,
          rows: report.rows,
        });
        cb.dispatch({ type: report.ok ? 'success' : 'warning', message: `Summary: ${report.summary}` });
        break;
      }
      if (scope === 'mods') {
        const hostRoot = modularHostRoot();
        const report = await buildModularDoctorReport(hostRoot, process.env.AGON_MODS_ROOT ?? join(dirname(hostRoot), 'mods'));
        cb.dispatch({ type: 'header', title: 'Modular Agon Doctor' });
        cb.dispatch({ type: 'table', headers: report.headers, rows: report.rows });
        cb.dispatch({ type: report.ok ? 'success' : 'warning', message: `Summary: ${report.summary}` });
        break;
      }
      if (scope !== 'engines') {
        cb.dispatch({ type: 'error', message: `Unknown doctor scope: ${scope}` });
        cb.dispatch({ type: 'info', message: 'Available: engines, harness, mods' });
        break;
      }
      const enabledIds = cb.ctx.config.forgeEnabledEngines ?? [];
      const entries = cb.ctx.registry.list()
        .map((engine: any) => diagnoseEngineDoctorEntry(engine, cb.ctx.registry, enabledIds))
        .sort((a: any, b: any) => {
          if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
          return a.id.localeCompare(b.id);
        });
      cb.dispatch({ type: 'header', title: 'Engine Doctor' });
      cb.dispatch({
        type: 'table',
        headers: ['Engine', 'Forge', 'Status', 'Backend', 'Modes', 'Detail'],
        rows: entries.map((entry: any) => [
          entry.id,
          entry.enabled ? 'yes' : 'no',
          entry.status,
          entry.backend,
          entry.modes,
          entry.detail,
        ]),
      });
      const worktree = checkDoctorWorktree(resolveWorkingDir());
      cb.dispatch({ type: worktree.ok ? 'success' : 'warning', message: worktree.ok ? worktree.message : `worktree check failed: ${worktree.message}` });
      const failing = entries.filter((entry: any) => entry.status === 'fail').length;
      const warnings = entries.filter((entry: any) => entry.status === 'warn').length;
      cb.dispatch({ type: 'info', message: `Summary: ${entries.length - failing - warnings} ok, ${warnings} warn, ${failing} fail` });
      break;
    }
    case 'harness-replay': {
      const result = replayCesarHarnessLogs({ turnId: (intent as any).turnId, limit: 8 });
      cb.dispatch({ type: 'engine-block', engineId: 'harness-replay', color: ENGINE_COLORS.cesar ?? 124, content: result.rendered });
      break;
    }
    case 'status': {
      const registry = cb.ctx.registry;
      const ids = registry.listIds();
      // Prefer the live poller read: telemetryVitals (React state) is
      // repaint-deduped and may lag by a signature bucket between commits.
      const liveVitals = cb.ctx.telemetrySnapshot?.() ?? cb.ctx.telemetryVitals;
      const engines = ids.map((id: string) => {
        const v = liveVitals?.get(id);
        if (v) return v;
        return createEngineVitals(id);
      });
      const snap: TelemetrySnapshot = {
        timestamp: Date.now(),
        engines,
        overallHealth: computeOverallHealth(engines),
        activeRuns: 0,
        recentFallbacks: (cb.ctx.recentFallbacks ?? []).slice(-5),
      };
      cb.dispatch({ type: 'info', message: renderTelemetrySnapshot(snap) });
      break;
    }
    case 'engines':
      if ((intent as any).action) await handleEngines(cb.dispatch, cb.ctx, intent as any);
      else cb.setEnginePickerOpen(true);
      break;
    case 'discover': await handleDiscover(cb.dispatch, cb.ctx); break;
    case 'provider': await handleProvider(intent.action, intent.args, cb.dispatch, cb.ctx); break;
    case 'config': handleConfig(intent, cb.dispatch, cb.ctx); break;
    case 'mod': {
      try {
        const { loadModManagementView, runTuiModAction } = await import('../../commands/mod.js');
        if (cb.setModPickerOpen && cb.setModPickerView && !String(intent.args ?? '').trim()) {
          cb.setModPickerView(await loadModManagementView()); cb.setModPickerOpen(true);
        } else cb.dispatch({ type: 'engine-block', engineId: 'mod-manager', color: ENGINE_COLORS.cesar ?? 124,
          content: await runTuiModAction(String(intent.args ?? 'list')) });
      } catch (error) {
        cb.dispatch({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
      break;
    }
    case 'mod-surface-command': {
      try {
        const publicId = `/${String(intent.commandName)}`;
        const record = processSurfaceClient('tui').assertAvailable(publicId);
        const contribution = record.payload as IntentContribution;
        const parsed = typeof contribution.parse === 'function'
          ? await contribution.parse(String(intent.args ?? ''))
          : ({ input: String(intent.args ?? '') } as Json);
        if (parsed === undefined) throw new TypeError(`mod command rejected its input: ${publicId}`);
        const normalized = JSON.parse(JSON.stringify(parsed)) as Json;
        assertContributionInput(contribution.inputSchema, normalized);
        const platform = `${process.platform}-${process.arch === 'x64' ? 'x64' : process.arch}` as ModPlatform;
        if (!['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].includes(platform)) {
          throw new TypeError(`unsupported mod platform: ${platform}`);
        }
        const output = await contribution.run(normalized, {
          invocationId: `tui:${process.pid}:${Date.now()}`,
          cwd: resolveWorkingDir(),
          platform,
          signal: new AbortController().signal,
          config: selectModSettings(cb.ctx.config, record.owner?.id),
        });
        let result: CommandResult = { exitCode: 0 };
        if (output && typeof output === 'object' && Symbol.asyncIterator in output) {
          for await (const event of output) {
            if (event.type === 'text') cb.dispatch({ type: 'info', message: event.text });
            else if (event.type === 'progress') cb.dispatch({ type: 'info', message: event.message });
            else if (event.type === 'result') result = event.result;
          }
        } else {
          result = output as CommandResult;
        }
        if (result.stdout) cb.dispatch({ type: 'info', message: result.stdout });
        if (result.stderr) cb.dispatch({ type: 'warning', message: result.stderr });
        if (result.result !== undefined) cb.dispatch({
          type: 'engine-block',
          engineId: intent.commandName,
          color: ENGINE_COLORS.cesar ?? 124,
          content: typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2),
        });
        if (result.failure) cb.dispatch({ type: 'error', message: `${result.failure.code}: ${result.failure.message}` });
      } catch (error) {
        cb.dispatch({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
      break;
    }
    case 'permissions': handlePermissions(cb.dispatch, intent); break;
    case 'use': handleUse(intent.engineIds, cb.dispatch, cb.ctx, cb.setSessionEngines); break;
    case 'cesar': {
      const cesarTarget = (intent.engineIds ?? []).join(' ').trim();
      if (cesarTarget) {
        handleCesar(cesarTarget, cb.dispatch, cb.ctx);
      } else {
        cb.setCesarPickerOpen(true);
      }
      break;
    }
    case 'tokens': handleTokens(cb.dispatch); break;
    case 'raw': handleRaw(cb.dispatch, intent.index); break;
    case 'models': {
      cb.setModelPickerTargetEngine?.(null);
      cb.setModelPickerInitialFilter?.('');
      cb.setModelPickerTitle?.('Select model');
      cb.setModelPickerLoading(true);
      cb.setModelPickerOpen(true);
      import('@kernlang/agon-core').then(({ fetchModelsRegistry, buildModelEntries, buildCliGroupsImmediate, refreshCliGroup, refreshCliGroupVersion }) => {
        // CLI engines: render cached/static models instantly (each installed
        // probe-capable engine flagged loading), then probe each engine's live
        // /model list in the background and swap its group in as it resolves —
        // no global wait, and a slow/broken probe only spins its own row.
        let cliGroups = buildCliGroupsImmediate();
        cb.setModelPickerCliGroups?.(cliGroups);
        for (const g of cliGroups) {
          if (!g.loading) continue;
          const clearLoading = () => {
            cliGroups = cliGroups.map((x: any) => x.engineId === g.engineId ? { ...x, loading: false } : x);
            cb.setModelPickerCliGroups?.([...cliGroups]);
          };
          refreshCliGroup(g.engineId).then((fresh: any) => {
            if (!fresh) { clearLoading(); return; }
            cliGroups = cliGroups.map((x: any) => x.engineId === fresh.engineId ? fresh : x);
            cb.setModelPickerCliGroups?.([...cliGroups]);
          }).catch(clearLoading);
        }
        // Versions resolve off the main thread too (buildCliGroupsImmediate no
        // longer shells out per engine — that was the picker's open latency), so
        // first paint is instant; swap each engine's version into its header as
        // it resolves. Skip rows the probe loop already owns (refreshCliGroup
        // returns their version) and any version already in the session cache.
        for (const g of cliGroups) {
          if (!g.installed || g.loading || g.version) continue;
          refreshCliGroupVersion(g.engineId).then((v: any) => {
            if (!v) return;
            cliGroups = cliGroups.map((x: any) => x.engineId === g.engineId ? { ...x, version: v } : x);
            cb.setModelPickerCliGroups?.([...cliGroups]);
          }).catch(() => {});
        }
        // API models (models.dev) — independent; clears the global loading state.
        fetchModelsRegistry().then((reg: any) => {
          cb.setModelPickerEntries(buildModelEntries(reg));
          cb.setModelPickerLoading(false);
        }).catch((err: any) => {
          // models.dev failed — but the CLI tab still lists local engines, so
          // keep the picker OPEN (just stop the API spinner) instead of locking
          // the user out of offline/local model selection.
          cb.setModelPickerLoading(false);
          cb.dispatch({ type: 'error', message: `models.dev registry unavailable (CLI engines still selectable): ${err.message}` } as any);
        });
      });
      break;
    }
    case 'workspace': {
      handleWorkspace(intent.action, cb.dispatch, cb.ctx, intent.path);
      // Invalidate caches that depend on cwd — workspace just changed
      invalidateCwdCache();
      sessionContext.invalidate();
      // Refresh workspace-scoped UI state; executable mods remain user-global.
      if (cb.setWorkspacePath) cb.setWorkspacePath(resolveWorkingDir());
      break;
    }
    case 'flow': await handleFlowReport(cb.dispatch, cb.ctx, cb.mode, cb.sessionStartTime); break;
    case 'flows': handleFlowAnalysis(cb.dispatch); break;
    case 'chats': handleChats(cb.dispatch, intent.sessionId); break;
  
    // ── Plan commands ──
    case 'plan': case 'plan-task': case 'plan-resume': case 'plans':
    case 'approve': case 'retry': case 'cancel':
      try {
        const command = intent.type === 'plan-task' || intent.type === 'plan-resume' ? 'plan' : intent.type;
        assertProcessSurfaceAvailable('tui', `/${command}`);
      } catch (error) {
        cb.dispatch({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        break;
      }
      return runInteractivePlanRequest(intent, input, cb);
    case 'apply': {
      // Legacy-shaped intents still execute the selected physical owner. There
      // is no second Apply workflow and no fallback around mod enablement.
      try {
        assertProcessSurfaceAvailable('tui', '/apply');
        const entry = processSurfaceCatalog('tui').find(candidate => candidate.kind === 'intent'
          && candidate.owner.id === 'agon.forge' && candidate.publicId === 'apply');
        const record = entry && processSurfaceClient('tui').project().entries.find(candidate =>
          candidate.owner.id === entry.owner.id && candidate.kind === entry.kind && candidate.id === entry.registryId);
        if (!record) throw new Error('The selected Forge generation has no Apply contribution. Restart Agon.');
        cb.runAsJob('apply', 'apply', async signal => {
          try {
            await runPhysicalTuiContribution(record, { type: 'apply', force: intent.force === true,
              ...(typeof intent.patchPath === 'string' ? { patchPath: intent.patchPath } : {}) }, 'apply', cb, signal);
          } catch (error) {
            cb.dispatch({ type: 'error', message: error instanceof Error ? error.message : String(error) });
          }
        });
        emitPostDispatch(intent, input, cb);
        return { handled: true, ranAsJob: true };
      } catch (error) {
        cb.dispatch({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        break;
      }
    }
    case 'cp': {
      if (intent.last) handleCpLast(cb.ctx.chatSession, cb.dispatch);
      else handleCp(intent.index, cb.dispatch);
      break;
    }
    case 'commit': await handleCommit(intent.input, cb.dispatch, cb.ctx); break;
  
    default: return null;
  }
  // break-path cases land here — mirrors the original switch's shared _emitPost() tail
  emitPostDispatch(intent, input, cb);
  return { handled: true, ranAsJob: false };
}

export async function runPhysicalTuiContribution(
  record: { readonly payload: unknown; readonly owner?: { readonly id: string } },
  parsed: Json,
  commandName: string,
  cb: DispatchCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const contribution = record.payload as IntentContribution;
  const normalized = JSON.parse(JSON.stringify(parsed)) as Json;
  assertContributionInput(contribution.inputSchema, normalized);
  const platform = `${process.platform}-${process.arch === 'x64' ? 'x64' : process.arch}` as ModPlatform;
  if (!['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].includes(platform)) {
    throw new TypeError(`unsupported mod platform: ${platform}`);
  }
  const invocation: SessionJobsInvocationContext = {
    invocationId: `tui:${randomUUID()}`,
    cwd: resolveWorkingDir(),
    platform,
    signal,
    config: selectModSettings(cb.ctx.config, record.owner?.id),
    ...(record.owner?.id === 'agon.jobs' ? {
      sessionJobs: { manager: cb.jobManager, dispatch: cb.dispatch },
    } : {}),
  };
  if (record.owner?.id === 'agon.campfire') {
    await runCampfireSession(normalized as Record<string, unknown>, cb, signal, async (prepared, context) => {
      const output = await contribution.run(prepared as Json, { ...invocation, ...context });
      if (output && typeof output === 'object' && Symbol.asyncIterator in output) {
        throw new TypeError('Campfire returned an unexpected streaming command result.');
      }
      return output as CommandResult;
    }, invocation.cwd);
    return;
  }
  if (record.owner?.id === 'agon.conquer') {
    await runConquerSession(normalized as Record<string, unknown>, cb, signal, async (prepared, context) => {
      const output = await contribution.run(prepared as Json, { ...invocation, ...context });
      if (output && typeof output === 'object' && Symbol.asyncIterator in output) {
        throw new TypeError('Conquer returned an unexpected streaming command result.');
      }
      return output as CommandResult;
    }, invocation.cwd);
    return;
  }
  if (record.owner?.id === 'agon.tribunal') {
    await runTribunalSession(normalized as Record<string, unknown>, cb, signal, async (prepared, context) => {
      const output = await contribution.run(prepared as Json, { ...invocation, ...context });
      if (output && typeof output === 'object' && Symbol.asyncIterator in output) {
        throw new TypeError('Tribunal returned an unexpected streaming command result.');
      }
      return output as CommandResult;
    }, invocation.cwd);
    return;
  }
  if (record.owner?.id === 'agon.brainstorm') {
    await runBrainstormSession(normalized as Record<string, unknown>, cb, signal, async (prepared, context) => {
      const output = await contribution.run(prepared as Json, { ...invocation, ...context });
      if (output && typeof output === 'object' && Symbol.asyncIterator in output) {
        throw new TypeError('Brainstorm returned an unexpected streaming command result.');
      }
      return output as CommandResult;
    });
    return;
  }
  const run = () => withPlanSession(invocation.invocationId, {
    actions: interactivePlanActions(cb),
    onDispatched: (request, result) => finishPlanDispatch(request, '', cb, result),
  }, async () => contribution.run(normalized, invocation));
  const output = record.owner?.id === 'agon.forge' && commandName === 'apply'
    ? await withPatchApplication(invocation.invocationId, createPatchApplicationUi(cb.dispatch, cb.ctx), run)
    : await run();
  let result: CommandResult = { exitCode: 0 };
  if (output && typeof output === 'object' && Symbol.asyncIterator in output) {
    for await (const event of output) {
      if (event.type === 'text') cb.dispatch({ type: 'info', message: event.text });
      else if (event.type === 'progress') cb.dispatch({ type: 'info', message: event.message });
      else if (event.type === 'result') result = event.result;
    }
  } else {
    result = output as CommandResult;
  }
  if (result.stdout) cb.dispatch({ type: 'info', message: result.stdout });
  if (result.stderr) cb.dispatch({ type: 'warning', message: escapeLiteralText(result.stderr) });
  if (result.result !== undefined) cb.dispatch({
    type: 'engine-block',
    engineId: commandName,
    color: ENGINE_COLORS.cesar ?? 124,
    content: typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2),
  });
  if (result.failure) cb.dispatch({ type: 'error', message: `${result.failure.code}: ${result.failure.message}` });
}
