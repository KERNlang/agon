// @kern-source: app-dispatch:5
import { resolveWorkingDir, extractImagesFromInput, buildImageAttachment, undoPatch, resumeChatSession, findSkill, renderSkillPrompt, configSet, startChatSession, currentBranch } from '@agon/core';

// @kern-source: app-dispatch:6
import type { ImageAttachment, ChatSession } from '@agon/core';

// @kern-source: app-dispatch:7
import { detectIntent } from '../intent.js';

// @kern-source: app-dispatch:8
import type { Dispatch, HandlerContext } from '../handlers/types.js';

// @kern-source: app-dispatch:9
import { icons } from '../icons.js';

// @kern-source: app-dispatch:10
import { handleForge, handleChat, handleBrainstorm, handleCampfire, handleTribunal, handleLeaderboard, handleHistory, handleEngines, handleDiscover, handleConfig, handleUse, handleCesar, handleTokens, handleModels, handleWorkspace, handleChats, handlePlanShow, handlePlansList, handleApprove, handleRetry, handleCancel, handleApplyPatch, handleCp, handleCommit, handleFlowReport, handleFlowAnalysis, handleBuild, handleRun } from '../handlers/index.js';

// @kern-source: app-dispatch:11
import { handleTeamTribunal } from '../generated/handlers-team-tribunal.js';

// @kern-source: app-dispatch:12
import { handleTeamForge } from '../generated/handlers-team-forge.js';

// @kern-source: app-dispatch:13
import { handleTeamBrainstorm } from '../generated/handlers-team-brainstorm.js';

// @kern-source: app-dispatch:14
import { handleCesarBrain, parseSuggestion, CESAR_SYSTEM_PROMPT } from '../handlers/cesar-brain.js';

// @kern-source: app-dispatch:15
import { handlePipeline } from '../handlers/pipeline.js';

// @kern-source: app-dispatch:16
import { handleProvider } from '../handlers/provider.js';

// @kern-source: app-dispatch:18
export interface DispatchCallbacks {
  dispatch: Dispatch;
  ctx: HandlerContext;
  runAsJob: (type:string, label:string, fn:()=>Promise<void>) => void;
  setMode: (mode:'chat'|'campfire'|'brainstorm'|'tribunal') => void;
  setPendingImages: (fn:(prev:ImageAttachment[])=>ImageAttachment[]) => void;
  setSessionEngines: (engines:string[]|null) => void;
  setEnginePickerOpen: (open:boolean) => void;
  setModelPickerOpen: (open:boolean) => void;
  setModelPickerEntries: (entries:any[]) => void;
  setModelPickerLoading: (loading:boolean) => void;
  setCesarPickerOpen: (open:boolean) => void;
  setChatSession: (session:ChatSession) => void;
  setLastUndoToken: (token:string|null) => void;
  askQuestion: (prompt:string) => Promise<string>;
  exit: () => void;
  allImages: ImageAttachment[];
  allSlashCommands: any[];
  dynamicSkills: any[];
  mode: string;
  lastUndoToken: string|null;
  sessionStartTime: number;
  jobManager: any;
  explorationMode: boolean;
  setExplorationMode: (mode: boolean) => void;
  neroMode: boolean;
  setNeroMode: (mode: boolean) => void;
}

// @kern-source: app-dispatch:46
export interface DispatchResult {
  handled: boolean;
  ranAsJob: boolean;
}

// @kern-source: app-dispatch:50
export function handleModeSwitch(intentType: string, topic: string|undefined, question: string|undefined, cb: DispatchCallbacks): boolean {
  if (intentType === 'campfire' && !topic) {
    cb.setMode('campfire');
    cb.dispatch({ type: 'success', message: 'Switched to campfire mode — just talk, all engines think together' });
    return true;
  }
  if (intentType === 'brainstorm' && !question) {
    cb.setMode('brainstorm');
    cb.dispatch({ type: 'success', message: 'Switched to brainstorm mode — engines bid on your questions' });
    return true;
  }
  if (intentType === 'tribunal' && !question) {
    cb.setMode('tribunal');
    cb.dispatch({ type: 'success', message: 'Switched to tribunal mode — engines debate your questions' });
    return true;
  }
  if (intentType === 'chat') {
    if (cb.mode !== 'chat') {
      cb.setMode('chat');
      cb.dispatch({ type: 'success', message: 'Switched to chat mode' });
    }
    return false; // May have input to process
  }
  return false;
}

// @kern-source: app-dispatch:78
export async function routeWithCesar(input: string, images: ImageAttachment[], cb: DispatchCallbacks): Promise<boolean> {
  cb.setPendingImages(() => []);
  try {
    const result = await handleCesarBrain(input, cb.dispatch, cb.ctx, images);
    if (result.delegated && result.action) {
      const label = input.slice(0, 40);
      const hardened = result.hardened ?? false;
      const tMode = result.tribunalMode;
      // P2 fix: normalize team prefix — brain may return action='forge' + team=true
      let routeAction = result.action;
      if (result.team && !routeAction.startsWith('team-')) routeAction = `team-${routeAction}`;
      // P1 fix: enrich input with user-added context from delegation prompt
      const taskInput = result.reasoning && result.reasoning.includes('User context:')
        ? `${input}\n\n${result.reasoning.slice(result.reasoning.indexOf('User context:'))}`
        : input;
      cb.dispatch({ type: 'info', message: `Cesar → ${routeAction}${hardened ? ' (hardened)' : ''}${tMode ? ` [${tMode}]` : ''}` });
      switch (routeAction) {
        case 'build':
          cb.runAsJob('build', label, () => handleBuild(taskInput, cb.dispatch, cb.ctx));
          return true;
        case 'forge':
          cb.runAsJob('forge', label, () => handleForge(taskInput, null, cb.dispatch, cb.ctx, undefined, hardened));
          return true;
        case 'team-forge': {
          const tfFitness = await cb.askQuestion('What command tests this?');
          if (!tfFitness.trim()) { cb.dispatch({ type: 'warning', message: 'Team-forge needs a test command.' }); break; }
          cb.runAsJob('team-forge', label, () => handleTeamForge(taskInput, tfFitness.trim(), cb.dispatch, cb.ctx, undefined));
          return true;
        }
        case 'brainstorm':
          cb.runAsJob('brainstorm', label, () => handleBrainstorm(taskInput, cb.dispatch, cb.ctx));
          return true;
        case 'team-brainstorm':
          cb.runAsJob('team-brainstorm', label, () => handleTeamBrainstorm(taskInput, cb.dispatch, cb.ctx));
          return true;
        case 'tribunal':
          cb.runAsJob('tribunal', label, () => handleTribunal(taskInput, cb.dispatch, cb.ctx, tMode));
          return true;
        case 'team-tribunal':
          cb.runAsJob('team-tribunal', label, () => handleTeamTribunal(taskInput, cb.dispatch, cb.ctx, tMode));
          return true;
        case 'campfire':
          cb.runAsJob('campfire', label, () => handleCampfire(taskInput, cb.dispatch, cb.ctx));
          return true;
        case 'pipeline':
          cb.runAsJob('pipeline', label, () => handlePipeline(taskInput, cb.dispatch, cb.ctx));
          return true;
      }
    }
    if (result.responded) return false;
  } catch (e) { console.warn(`[agon] dispatch: Cesar brain threw: ${e instanceof Error ? e.message : String(e)}`); }
  
  // If brain handler queued the message (responded=true), don't fall back
  // The queue auto-drains when the current turn finishes
  
  // Check if a delegation was pending from the crashed session (with 60s TTL)
  const crashDel = (cb.ctx as any)._pendingDelegation;
  if (crashDel) {
    delete (cb.ctx as any)._pendingDelegation;
    // TTL: discard stale delegations older than 60 seconds
    if (crashDel.createdAt && Date.now() - crashDel.createdAt > 60000) {
      cb.dispatch({ type: 'warning', message: 'Stale delegation discarded (>60s old)' });
    } else {
      // Confirm with user before dispatching recovered delegation
      let action = crashDel.team ? `team-${crashDel.action}` : crashDel.action;
      const confirmLabel = crashDel.hardened ? `${action} (hardened)` : action;
      const answer = await cb.askQuestion(`Recovered delegation: ${confirmLabel}${crashDel.tribunalMode ? ` [${crashDel.tribunalMode}]` : ''} — run it?`);
      if (answer === 'y' || answer === '1') {
        const label = input.slice(0, 40);
        cb.dispatch({ type: 'info', message: `Cesar → ${action} (recovered)` });
        switch (action) {
          case 'forge': cb.runAsJob('forge', label, () => handleForge(input, null, cb.dispatch, cb.ctx, undefined, crashDel.hardened ?? false)); return true;
          case 'brainstorm': cb.runAsJob('brainstorm', label, () => handleBrainstorm(input, cb.dispatch, cb.ctx)); return true;
          case 'tribunal': cb.runAsJob('tribunal', label, () => handleTribunal(input, cb.dispatch, cb.ctx, crashDel.tribunalMode)); return true;
          case 'campfire': cb.runAsJob('campfire', label, () => handleCampfire(input, cb.dispatch, cb.ctx)); return true;
          case 'pipeline': cb.runAsJob('pipeline', label, () => handlePipeline(input, cb.dispatch, cb.ctx)); return true;
          case 'team-forge': { const tf = await cb.askQuestion('What command tests this?'); if (tf.trim()) { cb.runAsJob('team-forge', label, () => handleTeamForge(input, tf.trim(), cb.dispatch, cb.ctx, undefined)); return true; } break; }
          case 'team-brainstorm': cb.runAsJob('team-brainstorm', label, () => handleTeamBrainstorm(input, cb.dispatch, cb.ctx)); return true;
          case 'team-tribunal': cb.runAsJob('team-tribunal', label, () => handleTeamTribunal(input, cb.dispatch, cb.ctx, crashDel.tribunalMode)); return true;
        }
      }
    }
  }
  
  // Cesar truly didn't respond — try fresh CLI dispatch
  const cesarConfig = cb.ctx.config;
  const cesarId = (cesarConfig as any).cesarEngine ?? 'claude';
  try {
    const cesarEngine = cb.ctx.registry.get(cesarId);
    const { join } = await import('node:path');
    const { mkdirSync } = await import('node:fs');
    const { resolveWorkingDir, RUNS_DIR, appendMessage } = await import('@agon/core');
    const outDir = join(RUNS_DIR, `cesar-fallback-${Date.now()}`);
    mkdirSync(outDir, { recursive: true });
    cb.dispatch({ type: 'warning', message: `Cesar session unavailable — retrying ${cesarId} with fresh dispatch…` });
    const freshResult = await cb.ctx.adapter.dispatch({
      engine: cesarEngine,
      prompt: input,
      cwd: resolveWorkingDir(),
      mode: 'exec' as any,
      timeout: (cesarConfig as any).timeout ?? 120,
      outputDir: outDir,
      systemPrompt: CESAR_SYSTEM_PROMPT,
    });
    if (freshResult.stdout.trim()) {
      const freshText = freshResult.stdout.trim().replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
      appendMessage(cb.ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
      appendMessage(cb.ctx.chatSession, { role: 'engine', engineId: cesarId, content: freshText, timestamp: new Date().toISOString() });
  
      // Parse fallback response for delegation — same logic as handleCesarBrain
      const fallbackSuggestion = parseSuggestion(freshText);
      if (fallbackSuggestion.action) {
        if (fallbackSuggestion.rest) cb.dispatch({ type: 'engine-block', engineId: cesarId, color: 81, content: fallbackSuggestion.rest });
        const confirmLabel = fallbackSuggestion.hardened ? `${fallbackSuggestion.action} (hardened)` : fallbackSuggestion.action;
        const answer = await cb.askQuestion(`Cesar suggests: ${confirmLabel}${fallbackSuggestion.tribunalMode ? ` [${fallbackSuggestion.tribunalMode}]` : ''}`);
        // askQuestion returns the answer as a string; check for 'y' or the key value
        if (answer === 'y' || answer === '1') {
          const label = input.slice(0, 40);
          // parseSuggestion already includes team- prefix in action (e.g. 'team-forge')
          const action = fallbackSuggestion.action;
          cb.dispatch({ type: 'info', message: `Cesar → ${action}` });
          switch (action) {
            case 'forge': cb.runAsJob('forge', label, () => handleForge(input, null, cb.dispatch, cb.ctx, undefined, fallbackSuggestion.hardened ?? false)); return true;
            case 'brainstorm': cb.runAsJob('brainstorm', label, () => handleBrainstorm(input, cb.dispatch, cb.ctx)); return true;
            case 'tribunal': cb.runAsJob('tribunal', label, () => handleTribunal(input, cb.dispatch, cb.ctx, fallbackSuggestion.tribunalMode)); return true;
            case 'campfire': cb.runAsJob('campfire', label, () => handleCampfire(input, cb.dispatch, cb.ctx)); return true;
            case 'pipeline': cb.runAsJob('pipeline', label, () => handlePipeline(input, cb.dispatch, cb.ctx)); return true;
            case 'team-forge': { const tf = await cb.askQuestion('What command tests this?'); if (tf.trim()) { cb.runAsJob('team-forge', label, () => handleTeamForge(input, tf.trim(), cb.dispatch, cb.ctx, undefined)); return true; } break; }
            case 'team-brainstorm': cb.runAsJob('team-brainstorm', label, () => handleTeamBrainstorm(input, cb.dispatch, cb.ctx)); return true;
            case 'team-tribunal': cb.runAsJob('team-tribunal', label, () => handleTeamTribunal(input, cb.dispatch, cb.ctx, fallbackSuggestion.tribunalMode)); return true;
          }
        }
        return false;
      }
  
      // No delegation — show as plain response
      cb.dispatch({ type: 'engine-block', engineId: cesarId, color: 81, content: freshText });
      return false;
    }
  } catch (e) { console.warn(`[agon] dispatch: Cesar fallback failed: ${e instanceof Error ? e.message : String(e)}`); }
  
  // Cesar completely unavailable — pick next best engine as acting Cesar with full context
  const available = cb.ctx.registry.availableIds();
  const actingCesar = available.find((id: string) => id !== cesarId) ?? cesarId;
  cb.dispatch({ type: 'warning', message: `Cesar (${cesarId}) unavailable — ${actingCesar} stepping in as acting Cesar` });
  
  // Build context so acting Cesar can lead
  const recentMessages = cb.ctx.chatSession?.messages?.slice(-10) ?? [];
  const historyContext = recentMessages
    .map((m: any) => `${m.role === 'user' ? 'User' : (m.engineId ?? 'engine')}: ${m.content}`)
    .join('\n\n');
  const actingPrompt = `You are stepping in as acting Cesar (lead AI) for Agon AI because ${cesarId} is temporarily unavailable. You have full authority to answer, delegate, and lead.\n\n${historyContext ? `## RECENT CONVERSATION\n${historyContext}\n\n` : ''}## USER MESSAGE\n${input}`;
  
  try {
    const { resolveWorkingDir, RUNS_DIR, appendMessage } = await import('@agon/core');
    const { join } = await import('node:path');
    const { mkdirSync } = await import('node:fs');
    const actingEngine = cb.ctx.registry.get(actingCesar);
    const outDir = join(RUNS_DIR, `acting-cesar-${Date.now()}`);
    mkdirSync(outDir, { recursive: true });
    const actingResult = await cb.ctx.adapter.dispatch({
      engine: actingEngine,
      prompt: actingPrompt,
      cwd: resolveWorkingDir(),
      mode: 'exec' as any,
      timeout: (cesarConfig as any).timeout ?? 120,
      outputDir: outDir,
      systemPrompt: CESAR_SYSTEM_PROMPT,
    });
    if (actingResult.stdout.trim()) {
      const actingText = actingResult.stdout.trim().replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
      cb.dispatch({ type: 'engine-block', engineId: actingCesar, color: 208, content: actingText });
      appendMessage(cb.ctx.chatSession, { role: 'user', content: input, timestamp: new Date().toISOString() });
      appendMessage(cb.ctx.chatSession, { role: 'engine', engineId: actingCesar, content: `[acting-cesar] ${actingText}`, timestamp: new Date().toISOString() });
      return false;
    }
  } catch (e) { console.warn(`[agon] dispatch: acting Cesar failed: ${e instanceof Error ? e.message : String(e)}`); }
  
  cb.dispatch({ type: 'error', message: 'All engines unavailable. Check /engines.' });
  return false;
}

// @kern-source: app-dispatch:262
export async function dispatchIntent(intent: any, input: string, cb: DispatchCallbacks): Promise<DispatchResult> {
  switch (intent.type) {
    // ── Job-dispatched commands (return immediately, don't hit finally) ──
    case 'forge': {
      const forgeStart = Date.now();
      cb.runAsJob('forge', intent.task?.slice(0, 40) ?? 'forge', async () => {
        await handleForge(intent.task, intent.fitnessCmd, cb.dispatch, cb.ctx, undefined, intent.hardened);
      });
      return { handled: true, ranAsJob: true };
    }
    case 'brainstorm':
      cb.runAsJob('brainstorm', intent.question?.slice(0, 40) ?? 'brainstorm', () => handleBrainstorm(intent.question, cb.dispatch, cb.ctx));
      return { handled: true, ranAsJob: true };
    case 'tribunal':
      cb.runAsJob('tribunal', intent.question?.slice(0, 40) ?? 'tribunal', () => handleTribunal(intent.question, cb.dispatch, cb.ctx, intent.tribunalMode));
      return { handled: true, ranAsJob: true };
    case 'campfire':
      cb.runAsJob('campfire', intent.topic?.slice(0, 40) ?? 'campfire', () => handleCampfire(intent.topic, cb.dispatch, cb.ctx));
      return { handled: true, ranAsJob: true };
    case 'team-tribunal':
      cb.runAsJob('team-tribunal', intent.question?.slice(0, 40) ?? 'team-tribunal', () => handleTeamTribunal(intent.question, cb.dispatch, cb.ctx, intent.tribunalMode, intent.membersPerSide));
      return { handled: true, ranAsJob: true };
    case 'team-forge':
      cb.runAsJob('team-forge', intent.task?.slice(0, 40) ?? 'team-forge', () => handleTeamForge(intent.task, intent.fitnessCmd, cb.dispatch, cb.ctx, intent.membersPerSide));
      return { handled: true, ranAsJob: true };
    case 'team-brainstorm':
      cb.runAsJob('team-brainstorm', intent.question?.slice(0, 40) ?? 'team-brainstorm', () => handleTeamBrainstorm(intent.question, cb.dispatch, cb.ctx, intent.membersPerSide));
      return { handled: true, ranAsJob: true };
    case 'build':
      cb.runAsJob('build', intent.input?.slice(0, 40) ?? 'build', () => handleBuild(intent.input, cb.dispatch, cb.ctx));
      return { handled: true, ranAsJob: true };
    case 'pipeline':
      cb.runAsJob('pipeline', intent.task?.slice(0, 40) ?? 'pipeline', () => handlePipeline(intent.task, cb.dispatch, cb.ctx, intent.fitnessCmd ?? undefined));
      return { handled: true, ranAsJob: true };
  
    // ── Inline commands ──
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
      }
      break;
    }
  
    // ── Info commands ──
    case 'leaderboard': handleLeaderboard(cb.dispatch); break;
    case 'history': handleHistory(cb.dispatch, intent.id); break;
    case 'engines': cb.setEnginePickerOpen(true); break;
    case 'discover': await handleDiscover(cb.dispatch, cb.ctx); break;
    case 'provider': await handleProvider(intent.action, intent.args, cb.dispatch, cb.ctx); break;
      case 'config': handleConfig(intent, cb.dispatch, cb.ctx); break;
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
    case 'models': {
      cb.setModelPickerLoading(true);
      cb.setModelPickerOpen(true);
      import('@agon/core').then(({ fetchModelsRegistry, buildModelEntries }) => {
        fetchModelsRegistry().then((reg: any) => {
          cb.setModelPickerEntries(buildModelEntries(reg));
          cb.setModelPickerLoading(false);
        }).catch((err: any) => {
          cb.setModelPickerOpen(false);
          cb.setModelPickerLoading(false);
          cb.dispatch({ type: 'error', message: `Failed to fetch models: ${err.message}` } as any);
        });
      });
      break;
    }
    case 'workspace': handleWorkspace(intent.action, cb.dispatch, cb.ctx, intent.path); break;
    case 'flow': await handleFlowReport(cb.dispatch, cb.ctx, cb.mode, cb.sessionStartTime); break;
    case 'flows': handleFlowAnalysis(cb.dispatch); break;
    case 'chats': handleChats(cb.dispatch, intent.sessionId); break;
  
    // ── Plan commands ──
    case 'plan': await handlePlanShow(cb.dispatch, cb.ctx, intent.planId); break;
    case 'plans': handlePlansList(cb.dispatch); break;
    case 'approve': await handleApprove(cb.dispatch, cb.ctx); break;
    case 'retry': await handleRetry(cb.dispatch, cb.ctx); break;
    case 'cancel': handleCancel(cb.dispatch, cb.ctx); break;
    case 'apply': await handleApplyPatch(cb.dispatch, cb.ctx, intent.patchPath, intent.force); break;
    case 'cp': handleCp(intent.index, cb.dispatch); break;
    case 'commit': await handleCommit(intent.input, cb.dispatch, cb.ctx); break;
  
    case 'undo': {
      if (!cb.lastUndoToken) {
        cb.dispatch({ type: 'warning', message: 'Nothing to undo. Apply a forge patch first.' });
        break;
      }
      const undoResult = undoPatch(resolveWorkingDir(), cb.lastUndoToken);
      if (undoResult.ok) {
        cb.dispatch({ type: 'success', message: 'Patch reverted successfully.' });
        cb.setLastUndoToken(null);
      } else {
        cb.dispatch({ type: 'error', message: undoResult.error ?? 'Undo failed' });
      }
      break;
    }
  
    case 'chats-resume': {
      const sid = intent.sessionId;
      if (!sid) { cb.dispatch({ type: 'error', message: 'Usage: /chats resume <session-id>' }); break; }
      const resumed = resumeChatSession(sid);
      if (resumed) {
        cb.setChatSession(resumed);
        cb.dispatch({ type: 'success', message: `Resumed session: ${resumed.id}` });
      } else {
        cb.dispatch({ type: 'error', message: `Session not found: ${sid}` });
      }
      break;
    }
  
    // ── Job commands ──
    case 'jobs': {
      const allJobs = (cb as any).jobManager?.list?.() ?? [];
      if (allJobs.length === 0) {
        cb.dispatch({ type: 'info', message: 'No jobs.' });
      } else {
        cb.dispatch({ type: 'header', title: 'Jobs' });
        const rows = allJobs.map((j: any) => [j.id, j.type, j.state, j.label.slice(0, 40), j.startedAt.slice(11, 19)]);
        cb.dispatch({ type: 'table', headers: ['ID', 'Type', 'State', 'Label', 'Started'], rows });
      }
      break;
    }
    case 'focus': {
      const focusId = (intent as any).jobId;
      if (!focusId) { cb.dispatch({ type: 'info', message: 'Usage: /focus <job-id>' }); break; }
      const job = (cb as any).jobManager?.get?.(focusId);
      if (!job) { cb.dispatch({ type: 'error', message: `Job not found: ${focusId}` }); break; }
      cb.dispatch({ type: 'info', message: `Job ${job.id}: ${job.type} — ${job.state} — ${job.label}` });
      if (job.error) cb.dispatch({ type: 'error', message: job.error });
      break;
    }
  
    // ── Suggest commands (conversational escalation) ──
    case 'suggest-brainstorm': {
      const si = intent as any;
      const answer = await cb.askQuestion('Brainstorm with all engines? (y/n)');
      if (answer.toLowerCase().startsWith('y')) {
        cb.runAsJob('brainstorm', si.question?.slice(0, 40) ?? 'brainstorm', () => handleBrainstorm(si.question ?? si.input, cb.dispatch, cb.ctx));
        return { handled: true, ranAsJob: true };
      }
      await handleChat(si.input, cb.dispatch, cb.ctx, cb.allImages);
      break;
    }
    case 'suggest-tribunal': {
      const si = intent as any;
      const answer = await cb.askQuestion('Debate with all engines? (y/n)');
      if (answer.toLowerCase().startsWith('y')) {
        cb.runAsJob('tribunal', si.question?.slice(0, 40) ?? 'tribunal', () => handleTribunal(si.question ?? si.input, cb.dispatch, cb.ctx));
        return { handled: true, ranAsJob: true };
      }
      await handleChat(si.input, cb.dispatch, cb.ctx, cb.allImages);
      break;
    }
    case 'suggest-forge': {
      const si = intent as any;
      const answer = await cb.askQuestion('Forge — engines compete to build? (y/n)');
      if (answer.toLowerCase().startsWith('y')) {
        cb.runAsJob('forge', si.task?.slice(0, 40) ?? 'forge', () => handleForge(si.task ?? si.input, si.fitnessCmd, cb.dispatch, cb.ctx));
        return { handled: true, ranAsJob: true };
      }
      await handleChat(si.input, cb.dispatch, cb.ctx, cb.allImages);
      break;
    }
  
    // ── Exploration mode toggle ──
    case 'explore': {
      const newMode = !cb.explorationMode;
      cb.setExplorationMode(newMode);
      cb.ctx.setExplorationMode(newMode);
      if (cb.ctx.cesarSession) {
        cb.ctx.cesarSession.close();
        cb.ctx.setCesarSession(null);
        cb.dispatch({ type: 'info', message: `Cesar session reset for ${newMode ? 'exploration' : 'agent'} mode` });
      }
      if (newMode) {
        cb.dispatch({ type: 'success', message: 'Exploration mode ON — read-only, write tools blocked. Use /explore again to disable.' });
      } else {
        cb.dispatch({ type: 'success', message: 'Exploration mode OFF — full agent mode restored.' });
      }
      break;
    }
  
    // ── Nero mode toggle ──
    case 'nero': {
      const newNero = !cb.neroMode;
      cb.setNeroMode(newNero);
      (cb.ctx as any).neroMode = newNero;
      // Reset Cesar session so the new system prompt takes effect
      if (cb.ctx.cesarSession) {
        cb.ctx.cesarSession.close();
        cb.ctx.setCesarSession(null);
        cb.dispatch({ type: 'info', message: 'Cesar session reset for Nero mode change' });
      }
      if (newNero) {
        cb.dispatch({ type: 'success', message: `${icons().nero} Nero mode ON — Cesar will challenge your ideas before implementing. Use /nero again to disable.` });
      } else {
        cb.dispatch({ type: 'success', message: 'Nero mode OFF — Cesar back to normal.' });
      }
      break;
    }
  
    // ── UI commands ──
    case 'slash-list': cb.dispatch({ type: 'text', content: cb.allSlashCommands.map((c: any) => `${c.cmd.padEnd(16)} ${c.desc}`).join('\n') }); break;
    case 'clear': {
      // Option 3: Save context before clearing, kill brain, reset everything
      const oldChatId = cb.ctx.chatSession?.id ?? null;
  
      // 1. Kill Cesar's brain subprocess
      if (cb.ctx.cesarSession) {
        cb.ctx.cesarSession.close();
        cb.ctx.setCesarSession(null);
      }
  
      // 2. Clear visual output (blocks, streaming, clipboard)
      cb.dispatch({ type: 'clear' });
  
      // 3. Start fresh chat session (old one is already persisted to ~/.agon/chats/)
      const clearCwd = resolveWorkingDir();
      let clearBranch = 'unknown';
      try { clearBranch = currentBranch(clearCwd); } catch {}
      cb.setChatSession(startChatSession({ cwd: clearCwd, branch: clearBranch }));
  
      // 4. Reset mode back to chat
      cb.setMode('chat');
  
      // 5. Confirm with saved session reference
      const clearMsg = oldChatId
        ? `Session cleared. Previous chat saved as ${oldChatId} — use /chats resume ${oldChatId} to recover.`
        : 'Session cleared.';
      cb.dispatch({ type: 'success', message: clearMsg });
      break;
    }
    case 'help': cb.dispatch({ type: 'text', content: cb.allSlashCommands.map((c: any) => `${c.cmd.padEnd(16)} ${c.desc}`).join('\n') }); break;
    case 'exit': cb.exit(); return { handled: true, ranAsJob: true };
  
    // ── Cesar-routed intents ──
    case 'auto':
    case 'unknown': {
      // Check dynamic skills for unknown slash commands
      const trimmed = (intent.input ?? '').trim();
      if (intent.type === 'unknown' && trimmed.startsWith('/')) {
        const spaceIdx = trimmed.indexOf(' ');
        const trigger = spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed;
        const skillArg = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1).trim() : '';
        const skill = findSkill(trigger, cb.dynamicSkills);
        if (skill) {
          const skillPrompt = renderSkillPrompt(skill, skillArg);
          cb.setPendingImages(() => []);
          await handleChat(skillPrompt, cb.dispatch, cb.ctx, cb.allImages);
          break;
        }
      }
      if (await routeWithCesar(intent.input ?? input, cb.allImages, cb)) return { handled: true, ranAsJob: true };
      break;
    }
  
    default:
      cb.dispatch({ type: 'warning', message: `Unknown command: ${intent.type}` });
  }
  
  return { handled: true, ranAsJob: false };
}
