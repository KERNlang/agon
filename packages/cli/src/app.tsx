import React, { useState, useCallback, useEffect, useRef } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import type { Plan, ChatSession, Skill, PersistentSession } from '@agon/core';
import {
  EngineRegistry,
  ensureAgonHome,
  loadConfig,
  loadSkills,
  findSkill,
  renderSkillPrompt,
  ensureCurrentWorkspace,
  startChatSession,
  resumeChatSession,
  currentBranch,
  getElo,
  getActiveWorkspace,
  configSet,
  RUNS_DIR,
  extractImagesFromInput,
  buildImageAttachment,
  tracker,
  parsePatch,
  patchSummary,
  applyPatchWithUndo,
  undoPatch,
  resolveWorkingDir,
} from '@agon/core';
import type { ImageAttachment } from '@agon/core';
import { createCliAdapter } from '@agon/adapter-cli';
import type { EngineAdapter } from '@agon/core';
import { detectIntent, SLASH_COMMANDS } from './intent.js';
import { JobManager } from './generated/job-manager.js';
import type { Job } from './generated/job-manager.js';
import { ENGINE_COLORS } from './output.js';
import { parseMarkdownBlocks, cleanEngineOutput } from './markdown.js';
import type { OutputEvent, HandlerContext, EngineProgress } from './handlers/types.js';
import {
  handleForge, handleChat, handleBrainstorm, handleCampfire, handleTribunal,
  handleLeaderboard, handleHistory, handleEngines, handleDiscover,
  handleConfig, handleUse, handleCesar, handleTokens, handleModels, handleWorkspace, handleChats,
  handlePlanShow, handlePlansList, handleApprove, handleRetry, handleCancel,
  handleApplyPatch, handleCp, handleCommit,
  handleFlowReport, handleFlowAnalysis, autoLogFlow,
  handleBuild, handleRun,
} from './handlers/index.js';
import { routeViaCesar } from './handlers/cesar.js';
import { handleCesarBrain } from './handlers/cesar-brain.js';
import { handlePipeline } from './handlers/pipeline.js';
import { handleProvider } from './handlers/provider.js';
import { codeBlockBuffer } from './code-buffer.js';
import { getGhostCompletion } from './ghost-text.js';
import { copyToClipboard, applyPatchToTree } from '@agon/core';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// ── State Types (KERN-generated from kern/app-state.kern) ────────────
import type { ReplStateState as ReplState } from './generated/app-state.js';
import {
  startCommandReplState,
  finishReplState,
  cancelReplState,
} from './generated/app-state.js';

import type { OutputBlock, ReviewEvent } from './components.js';
import {
  SpinnerBlock, EngineProgressView, StatusLine, StatusBar,
  OutputBlockView, SlashPicker, EnginePicker, ReviewBlock, BackgroundJobRail,
  RenderedSegments, contentWidth, engineColor,
} from './components.js';

/* Extracted components, helpers, constants → see ./components.tsx */

// ── Main App ─────────────────────────────────────────────────────────

// Module-level refs so SIGINT handler can cancel ALL running operations
const _activeAborts = new Set<AbortController>();
let _cancelCallback: (() => void) | null = null;
let _cesarSessionRef: PersistentSession | null = null;

function App() {
  const { exit } = useApp();
  const [replState, setReplState] = useState<ReplState>('idle');
  const [outputBlocks, setOutputBlocks] = useState<OutputBlock[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [inputQueue, setInputQueue] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [mode, setMode] = useState<'chat' | 'campfire' | 'brainstorm' | 'tribunal'>('chat');
  const [sessionStartTime] = useState(() => Date.now());
  const [liveSpinner, setLiveSpinner] = useState<{ message: string; color?: number; engineId?: string } | null>(null);
  const [liveProgress, setLiveProgress] = useState<EngineProgress[] | null>(null);
  const [slashPickerOpen, setSlashPickerOpen] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const [questionState, setQuestionState] = useState<{ prompt: string; resolve: (answer: string) => void } | null>(null);
  const [questionAnswer, setQuestionAnswer] = useState('');
  const [enginePickerOpen, setEnginePickerOpen] = useState(false);
  const [streamingText, setStreamingText] = useState<{ engineId: string; content: string } | null>(null);
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [reviewEvent, setReviewEvent] = useState<ReviewEvent | null>(null);
  const [jobManager] = useState(() => new JobManager());
  const [jobList, setJobList] = useState<Job[]>([]);
  const [lastUndoToken, setLastUndoToken] = useState<string | null>(null);
  const chatStartTimeRef = useRef<number>(0);

  // Module-level state (mutable refs via closures)
  // Load persisted engine selection from config — null means "all available"
  const [sessionEngines, setSessionEngines] = useState<string[] | null>(() => {
    const cfg = loadConfig();
    const saved = cfg.forgeEnabledEngines;
    return saved && saved.length > 0 ? saved : null;
  });
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const currentPlanRef = useRef<Plan | null>(currentPlan);
  currentPlanRef.current = currentPlan;
  const [chatSession, setChatSession] = useState<ChatSession>(() => {
    const initCwd = resolveWorkingDir();
    let branch = 'unknown';
    try { branch = currentBranch(initCwd); } catch {}
    return startChatSession({ cwd: initCwd, branch });
  });
  const [activeAbort, _setActiveAbort] = useState<AbortController | null>(null);
  const setActiveAbort = useCallback((abort: AbortController | null) => {
    // Track all active aborts for concurrent job cancellation
    if (abort) _activeAborts.add(abort);
    _setActiveAbort(abort);
  }, []);
  const [cesarSession, _setCesarSessionRaw] = useState<PersistentSession | null>(null);
  const setCesarSession = useCallback((session: PersistentSession | null) => {
    _cesarSessionRef = session;
    _setCesarSessionRaw(session);
  }, []);
  const [registry] = useState<EngineRegistry>(() => {
    const reg = new EngineRegistry();
    const enginesDir = join(dirname(fileURLToPath(import.meta.url)), '../../../engines');
    reg.load(enginesDir);
    return reg;
  });
  const [adapter] = useState<EngineAdapter>(() => createCliAdapter(registry));
  const [dynamicSkills] = useState<Skill[]>(() => loadSkills());

  // Merge dynamic skills into slash commands for picker + ghost text
  const allSlashCommands = React.useMemo(() => {
    const skillCmds = dynamicSkills.map((s) => ({ cmd: s.trigger, desc: s.description || s.name }));
    return [...SLASH_COMMANDS, ...skillCmds];
  }, [dynamicSkills]);

  // Bridge: apply KERN state machine transition (entity API) to React useState
  const transition = (fn: (entity: { state: ReplState }) => { state: ReplState }) => {
    setReplState(prev => fn({ state: prev }).state);
  };

  // ── Bracketed paste mode ──
  const pasteBufferRef = useRef<string | null>(null);
  const isPastingRef = useRef(false);
  const justPastedRef = useRef(false);

  useEffect(() => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return;

    // Enable bracketed paste mode
    process.stdout.write('\x1b[?2004h');

    const onData = (data: Buffer) => {
      const str = data.toString();

      if (str.includes('\x1b[200~')) {
        // Paste start marker
        isPastingRef.current = true;
        const afterMarker = str.split('\x1b[200~').slice(1).join('');
        pasteBufferRef.current = afterMarker.replace(/\x1b\[201~/g, '');
        if (str.includes('\x1b[201~')) {
          // Paste ended in same chunk — collapse to single line, cap length
          isPastingRef.current = false;
          let content = (pasteBufferRef.current ?? '').replace(/\n/g, ' ').trim();
          if (content.length > 2000) content = content.slice(0, 2000) + '...';
          pasteBufferRef.current = null;
          justPastedRef.current = true;
          setTimeout(() => { justPastedRef.current = false; }, 100);
          if (content) {
            setInputValue((prev) => prev + content);
          }
        }
        return;
      }

      if (isPastingRef.current) {
        if (str.includes('\x1b[201~')) {
          // Paste end marker — collapse to single line, cap length
          const beforeMarker = str.split('\x1b[201~')[0];
          let content = ((pasteBufferRef.current ?? '') + beforeMarker).replace(/\n/g, ' ').trim();
          if (content.length > 2000) content = content.slice(0, 2000) + '...';
          isPastingRef.current = false;
          pasteBufferRef.current = null;
          justPastedRef.current = true;
          setTimeout(() => { justPastedRef.current = false; }, 100);
          if (content) {
            setInputValue((prev) => prev + content);
          }
        } else {
          pasteBufferRef.current = (pasteBufferRef.current ?? '') + str;
        }
        return;
      }
    };

    stdin.on('data', onData);

    return () => {
      // Disable bracketed paste mode
      process.stdout.write('\x1b[?2004l');
      stdin.off('data', onData);
    };
  }, []);

  // ── Render dashboard on mount (stays in history) ──
  useEffect(() => {
    const available = registry.availableIds();
    const config = loadConfig();
    const elo = getElo();
    const defaultEngine = config.forgeFixedStarter ?? available[0] ?? 'none';
    const activeWs = getActiveWorkspace();
    const totalMatches = Object.values(elo.global).reduce((sum, r) => sum + r.wins + r.losses, 0);
    const sorted = Object.entries(elo.global).sort(([, a], [, b]) => b.rating - a.rating);
    const enabled = sessionEngines ?? available;

    let runCount = 0;
    try { runCount = readdirSync(RUNS_DIR).filter((f) => f.endsWith('.json')).length; } catch { /* no runs */ }

    setOutputBlocks([{
      id: 0,
      event: {
        type: 'dashboard' as const,
        available,
        enabled,
        defaultEngine,
        eloTop: sorted.length > 0 ? { id: sorted[0][0], rating: sorted[0][1].rating } : undefined,
        totalForges: Math.floor(totalMatches / 2),
        workspace: activeWs ? { name: activeWs.name, path: activeWs.path, isKern: activeWs.isKern } : undefined,
        runCount,
      },
    }]);
  }, []); // Run once on mount

  // ── Dispatch: handlers call this, UI reacts ──
  const dispatch = useCallback((event: OutputEvent) => {
    switch (event.type) {
      case 'spinner-start': {
        chatStartTimeRef.current = Date.now();
        // Extract engine ID from config for chat mode display
        const cesarId = loadConfig().cesarEngine ?? loadConfig().forgeFixedStarter ?? 'claude';
        setLiveSpinner({ message: event.message, color: event.color, engineId: cesarId });
        break;
      }
      case 'spinner-stop':
        setLiveSpinner(null);
        if (event.message) {
          setOutputBlocks((prev) => [...prev, { id: Date.now(), event: { type: 'success', message: event.message! } }]);
        }
        break;
      case 'spinner-update':
        setLiveSpinner((prev) => prev ? { ...prev, message: event.message } : null);
        break;
      case 'progress-update':
        setLiveProgress(event.engines);
        break;
      case 'progress-clear':
        setLiveProgress(null);
        break;
      case 'streaming-chunk':
        // Accumulate into a single growing stream block
        setStreamingText((prev) => {
          if (prev && prev.engineId === event.engineId) {
            return { engineId: event.engineId, content: prev.content + event.chunk };
          }
          return { engineId: event.engineId, content: event.chunk };
        });
        break;
      case 'streaming-end':
        // Explicitly flush streaming buffer to output blocks
        setStreamingText((prev) => {
          if (prev) {
            const color = ENGINE_COLORS[prev.engineId] ?? 245;
            // Record code blocks for /cp
            const cleaned = cleanEngineOutput(prev.content);
            const segments = parseMarkdownBlocks(cleaned);
            codeBlockBuffer.recordFromSegments(segments);
            setOutputBlocks((blocks) => {
              const updated = [...blocks, {
                id: Date.now(),
                event: { type: 'engine-block' as const, engineId: prev.engineId, color, content: prev.content },
              }];
              // In chat mode, append response-meta with timing info
              if (mode === 'chat' && chatStartTimeRef.current > 0) {
                updated.push({
                  id: Date.now() + 1,
                  event: { type: 'response-meta' as const, engineId: prev.engineId, elapsed: Date.now() - chatStartTimeRef.current },
                });
              }
              return updated;
            });
          }
          return null;
        });
        break;
      case 'clear':
        setOutputBlocks([]);
        setStreamingText(null);
        break;
      case 'patch-review':
        setReviewEvent({ winnerId: event.winnerId, patchPath: event.patchPath, patchContent: event.patchContent });
        break;
      case 'question':
        setQuestionState({ prompt: event.prompt, resolve: event.resolve });
        break;
      default:
        // Record code blocks for /cp from engine-block events
        if (event.type === 'engine-block') {
          const cleaned = cleanEngineOutput(event.content);
          const segments = parseMarkdownBlocks(cleaned);
          codeBlockBuffer.recordFromSegments(segments);
        }
        // If we were streaming, flush to output blocks first
        if (event.type === 'text' || event.type === 'engine-block' || event.type === 'separator') {
          setStreamingText((prev) => {
            if (prev) {
              const color = ENGINE_COLORS[prev.engineId] ?? 245;
              setOutputBlocks((blocks) => [...blocks, {
                id: Date.now() - 1,
                event: { type: 'engine-block', engineId: prev.engineId, color, content: prev.content },
              }]);
            }
            return null;
          });
        }
        setOutputBlocks((prev) => {
          const updated = [...prev, { id: Date.now() + Math.random(), event }];
          // In chat mode, append response-meta after engine-block events
          if (mode === 'chat' && event.type === 'engine-block' && chatStartTimeRef.current > 0) {
            updated.push({
              id: Date.now() + 0.5,
              event: { type: 'response-meta' as const, engineId: event.engineId, elapsed: Date.now() - chatStartTimeRef.current },
            });
          }
          return updated;
        });
    }
  }, []);

  // ── Ask question (used by handlers for user prompts) ──
  const askQuestion = useCallback((prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      dispatch({ type: 'question', prompt, resolve });
    });
  }, [dispatch]);

  // ── Active engines helper ──
  const activeEngines = useCallback((): string[] => {
    const available = registry.availableIds();
    if (!sessionEngines) return available;
    return sessionEngines.filter((id) => available.includes(id));
  }, [registry, sessionEngines]);

  // ── Build handler context ──
  // Use a getter for currentPlan so long-running handlers always see latest state
  const buildContext = useCallback((): HandlerContext => ({
    registry,
    adapter,
    activeEngines,
    config: loadConfig(),
    chatSession,
    get currentPlan() { return currentPlanRef.current; },
    setCurrentPlan,
    setActiveAbort,
    askQuestion,
    cesarSession,
    setCesarSession,
  }), [registry, adapter, activeEngines, chatSession, askQuestion, cesarSession]);

  // ── Input change + slash picker trigger ──
  const handleInputChange = useCallback((value: string) => {
    // Strip bracketed paste escape sequences and Tab chars
    const cleaned = value.replace(/\x1b\[20[01]~/g, '').replace(/\[200~/g, '').replace(/\[201~/g, '').replace(/\t/g, '');
    setInputValue(cleaned);
  }, []);

  // ── Process queued input when engine finishes ──
  useEffect(() => {
    if (replState === 'idle' && inputQueue.length > 0) {
      const next = inputQueue[0];
      setInputQueue((prev) => prev.slice(1));
      // Use setTimeout to avoid React state update conflicts
      setTimeout(() => handleSubmit(next), 50);
    }
  }, [replState, inputQueue.length]);

  // ── Handle input submission ──
  const handleSubmit = useCallback(async (value: string) => {
    const input = value.replace(/\x1b\[20[01]~/g, '').replace(/\[200~/g, '').replace(/\[201~/g, '').trim();
    if (!input) return;

    setInputValue('');
    setInputHistory((prev) => [...prev, input]);
    setHistoryIndex(-1);

    // Queue input while busy (like Claude Code's queued commands)
    if (replState !== 'idle' && !jobManager.running().length) {
      setInputQueue((prev) => [...prev, input]);
      dispatch({ type: 'info', message: `Queued: ${input.length > 50 ? input.slice(0, 50) + '…' : input}` });
      return;
    }

    transition(startCommandReplState);
    dispatch({ type: 'separator' });
    dispatch({ type: 'user-message', content: input });

    // Extract images from input (drag-and-drop paths, inline paths)
    const { text: cleanInput, images: detectedImages } = extractImagesFromInput(input, resolveWorkingDir());
    const allImages = [...pendingImages, ...detectedImages];

    let intent = detectIntent(cleanInput || input);

    // Mode switching — /campfire, /brainstorm, /tribunal, /chat switch modes
    // If the command has no argument, just switch mode and show confirmation
    if (intent.type === 'campfire' && !intent.topic) {
      setMode('campfire');
      dispatch({ type: 'success', message: 'Switched to campfire mode — just talk, all engines think together' });
      transition(finishReplState);
      return;
    }
    if (intent.type === 'brainstorm' && !intent.question) {
      setMode('brainstorm');
      dispatch({ type: 'success', message: 'Switched to brainstorm mode — engines bid on your questions' });
      transition(finishReplState);
      return;
    }
    if (intent.type === 'tribunal' && !intent.question) {
      setMode('tribunal');
      dispatch({ type: 'success', message: 'Switched to tribunal mode — engines debate your questions' });
      transition(finishReplState);
      return;
    }
    if (intent.type === 'chat') {
      if (mode !== 'chat') {
        setMode('chat');
        dispatch({ type: 'success', message: 'Switched to chat mode' });
      }
      // If there's actual input, process it
      if (!intent.input?.trim()) {
        transition(finishReplState);
        return;
      }
    }

    // In a non-chat mode, route plain text to the mode's handler
    if (intent.type === 'unknown' && mode !== 'chat') {
      switch (mode) {
        case 'campfire': intent = { type: 'campfire', topic: input }; break;
        case 'brainstorm': intent = { type: 'brainstorm', question: input }; break;
        case 'tribunal': intent = { type: 'tribunal', question: input }; break;
      }
    }


    const ctx = buildContext();

    // Debug: verify registry is defined
    if (!ctx.registry) {
      dispatch({ type: 'error', message: `BUG: ctx.registry is undefined. Available: ${typeof registry}` });
      transition(finishReplState);
      return;
    }

    // Helper: run a long-running command as a tracked job
    const runAsJob = (type: string, label: string, fn: () => Promise<void>) => {
      const job = jobManager.create(type, label);
      setJobList([...jobManager.list()]);
      // Run in background — don't await, return input to idle immediately
      transition(finishReplState);
      fn().then(() => {
        jobManager.complete(job.id);
        setJobList([...jobManager.list()]);
      }).catch((err) => {
        jobManager.fail(job.id, err instanceof Error ? err.message : String(err));
        setJobList([...jobManager.list()]);
        dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    };

    // Unified Cesar brain routing — deduplicates chat/auto/unknown delegation
    // Returns true if a background job was dispatched (caller should `return`)
    const routeWithCesar = async (input: string, images: ImageAttachment[]): Promise<boolean> => {
      setPendingImages([]);
      try {
        const result = await handleCesarBrain(input, dispatch, ctx, images);
        if (result.delegated && result.action) {
          dispatch({ type: 'info', message: `Cesar delegates → ${result.action}` });
          switch (result.action) {
            case 'build': runAsJob('build', input.slice(0, 40), () => handleBuild(input, dispatch, ctx)); return true;
            case 'forge': runAsJob('forge', input.slice(0, 40), () => handleForge(input, null, dispatch, ctx)); return true;
            case 'brainstorm': runAsJob('brainstorm', input.slice(0, 40), () => handleBrainstorm(input, dispatch, ctx)); return true;
            case 'tribunal': runAsJob('tribunal', input.slice(0, 40), () => handleTribunal(input, dispatch, ctx)); return true;
          }
        }
        if (result.responded) return false; // Cesar handled directly, no fallback needed
      } catch { /* fall through */ }
      await handleChat(input, dispatch, ctx, images);
      return false;
    };

    try {
      switch (intent.type) {
        case 'forge': {
          const forgeStart = Date.now();
          runAsJob('forge', intent.task?.slice(0, 40) ?? 'forge', async () => {
            await handleForge(intent.task, intent.fitnessCmd, dispatch, ctx);
            autoLogFlow(ctx, 'forge', forgeStart, 'completed', { forgeId: ctx.currentPlan?.id, winnerEngine: ctx.currentPlan?.steps?.find((s: any) => s.result.artifacts?.some((a: any) => a.type === 'patch'))?.result.artifacts?.find((a: any) => a.type === 'patch')?.engineId });
          });
          return; // Don't hit finally — job manages state
        }
        case 'brainstorm': {
          runAsJob('brainstorm', intent.question?.slice(0, 40) ?? 'brainstorm', () => handleBrainstorm(intent.question, dispatch, ctx));
          return;
        }
        case 'tribunal': {
          runAsJob('tribunal', intent.question?.slice(0, 40) ?? 'tribunal', () => handleTribunal(intent.question, dispatch, ctx, (intent as any).tribunalMode));
          return;
        }
        case 'campfire': {
          runAsJob('campfire', intent.topic?.slice(0, 40) ?? 'campfire', () => handleCampfire(intent.topic, dispatch, ctx));
          return;
        }
        case 'img': {
          const att = buildImageAttachment(intent.path, resolveWorkingDir());
          if (!att) dispatch({ type: 'error', message: `Image not found: ${intent.path}` });
          else {
            setPendingImages(prev => [...prev, att]);
            dispatch({ type: 'success', message: `Attached: ${att.filename}` });
          }
          break;
        }
        case 'build': {
          runAsJob('build', intent.input?.slice(0, 40) ?? 'build', () => handleBuild(intent.input, dispatch, ctx));
          return;
        }
        case 'pipeline': {
          runAsJob('pipeline', intent.task?.slice(0, 40) ?? 'pipeline', () =>
            handlePipeline(intent.task, dispatch, ctx, intent.fitnessCmd ?? undefined));
          return;
        }
        case 'run': await handleRun(intent.input, dispatch, ctx); break;
        case 'chat': {
          if (await routeWithCesar(intent.input ?? '', allImages)) return;
          break;
        }
        case 'leaderboard': handleLeaderboard(dispatch); break;
        case 'history': handleHistory(dispatch, intent.id); break;
        case 'engines': await handleEngines(dispatch, ctx); break;
        case 'discover': await handleDiscover(dispatch, ctx); break;
        case 'provider': await handleProvider(intent.action, intent.args, dispatch, ctx); break;
        case 'config': handleConfig(intent, dispatch); break;
        case 'use': handleUse(intent.engineIds, dispatch, ctx, setSessionEngines); break;
        case 'cesar': handleCesar(intent.engineIds?.[0] ?? '', dispatch, ctx); break;
        case 'tokens': handleTokens(dispatch); break;
        case 'models': setEnginePickerOpen(true); break;
        case 'slash-list': dispatch({ type: 'text', content: allSlashCommands.map((c) => `${c.cmd.padEnd(16)} ${c.desc}`).join('\n') }); break;
        case 'workspace': handleWorkspace(intent.action, dispatch, ctx, intent.path); break;
        case 'flow': await handleFlowReport(dispatch, ctx, mode, sessionStartTime); break;
        case 'flows': handleFlowAnalysis(dispatch); break;
        case 'chats': handleChats(dispatch, intent.sessionId); break;
        case 'chats-resume' as string: {
          const sid = (intent as any).sessionId as string | undefined;
          if (!sid) {
            dispatch({ type: 'error', message: 'Usage: /chats resume <session-id>' });
            break;
          }
          const resumed = resumeChatSession(sid);
          if (resumed) {
            setChatSession(resumed);
            dispatch({ type: 'success', message: `Resumed session: ${resumed.id}` });
            dispatch({ type: 'info', message: `${resumed.messages.length} messages, started ${resumed.startedAt.slice(0, 10)}` });
            if (resumed.cwd) dispatch({ type: 'info', message: `Workspace: ${resumed.cwd}` });
          } else {
            dispatch({ type: 'error', message: `Session not found: ${sid}` });
          }
          break;
        }
        case 'plan': handlePlanShow(dispatch, ctx, intent.planId); break;
        case 'plans': handlePlansList(dispatch); break;
        case 'approve': await handleApprove(dispatch, ctx); break;
        case 'retry': await handleRetry(dispatch, ctx); break;
        case 'cancel': handleCancel(dispatch, ctx); break;
        case 'apply': await handleApplyPatch(dispatch, ctx, intent.patchPath, intent.force); break;
        case 'cp': handleCp(intent.index, dispatch); break;
        case 'commit' as string: await handleCommit((intent as any).input, dispatch, ctx); break;
        case 'undo' as string: {
          if (!lastUndoToken) {
            dispatch({ type: 'warning', message: 'Nothing to undo. Apply a forge patch first.' });
            break;
          }
          const undoResult = undoPatch(resolveWorkingDir(), lastUndoToken);
          if (undoResult.ok) {
            dispatch({ type: 'success', message: 'Patch reverted successfully.' });
            setLastUndoToken(null);
          } else {
            dispatch({ type: 'error', message: undoResult.error ?? 'Undo failed' });
          }
          break;
        }
        case 'jobs' as string: {
          const allJobs = jobManager.list();
          if (allJobs.length === 0) {
            dispatch({ type: 'info', message: 'No jobs.' });
          } else {
            dispatch({ type: 'header', title: 'Jobs' });
            const rows = allJobs.map((j: Job) => [
              j.id,
              j.type,
              j.state,
              j.label.slice(0, 40),
              j.startedAt.slice(11, 19),
            ]);
            dispatch({ type: 'table', headers: ['ID', 'Type', 'State', 'Label', 'Started'], rows });
          }
          break;
        }
        case 'focus' as string: {
          const focusId = (intent as any).jobId;
          if (!focusId) {
            dispatch({ type: 'info', message: 'Usage: /focus <job-id>' });
            break;
          }
          const job = jobManager.get(focusId);
          if (!job) {
            dispatch({ type: 'error', message: `Job not found: ${focusId}` });
          } else {
            dispatch({ type: 'info', message: `Job ${job.id}: ${job.type} — ${job.state} — ${job.label}` });
            if (job.error) dispatch({ type: 'error', message: job.error });
          }
          break;
        }
        case 'clear': dispatch({ type: 'clear' }); codeBlockBuffer.clear(); dispatch({ type: 'info', message: 'Chat history cleared.' }); break;
        case 'help': dispatch({ type: 'text', content: allSlashCommands.map((c) => `${c.cmd.padEnd(16)} ${c.desc}`).join('\n') }); break;
        case 'exit': exit(); return;
        case 'suggest-brainstorm' as string: {
          // Conversational trigger — ask before escalating
          const si = intent as any;
          const answer = await askQuestion('Brainstorm with all engines? (y/n)');
          if (answer.toLowerCase().startsWith('y')) {
            runAsJob('brainstorm', si.question?.slice(0, 40) ?? 'brainstorm', () =>
              handleBrainstorm(si.question ?? si.input, dispatch, ctx));
            return;
          }
          await handleChat(si.input, dispatch, ctx, allImages);
          break;
        }
        case 'suggest-tribunal' as string: {
          const si = intent as any;
          const answer = await askQuestion('Debate with all engines? (y/n)');
          if (answer.toLowerCase().startsWith('y')) {
            runAsJob('tribunal', si.question?.slice(0, 40) ?? 'tribunal', () =>
              handleTribunal(si.question ?? si.input, dispatch, ctx));
            return;
          }
          await handleChat(si.input, dispatch, ctx, allImages);
          break;
        }
        case 'suggest-forge' as string: {
          const si = intent as any;
          const answer = await askQuestion('Forge — engines compete to build? (y/n)');
          if (answer.toLowerCase().startsWith('y')) {
            runAsJob('forge', si.task?.slice(0, 40) ?? 'forge', async () => {
              await handleForge(si.task ?? si.input, si.fitnessCmd, dispatch, ctx);
            });
            return;
          }
          await handleChat(si.input, dispatch, ctx, allImages);
          break;
        }
        case 'auto': {
          if (await routeWithCesar(intent.input ?? '', allImages)) return;
          break;
        }
        case 'unknown': {
          // Check dynamic skills first
          const trimmedInput = (intent.input ?? '').trim();
          if (trimmedInput.startsWith('/')) {
            const spaceIdx = trimmedInput.indexOf(' ');
            const trigger = spaceIdx > 0 ? trimmedInput.slice(0, spaceIdx) : trimmedInput;
            const skillArg = spaceIdx > 0 ? trimmedInput.slice(spaceIdx + 1).trim() : '';
            const skill = findSkill(trigger, dynamicSkills);
            if (skill) {
              const skillPrompt = renderSkillPrompt(skill, skillArg);
              setPendingImages([]);
              await handleChat(skillPrompt, dispatch, ctx, allImages);
              break;
            }
          }
          if (await routeWithCesar(intent.input ?? '', allImages)) return;
          break;
        }
      }
    } catch (err) {
      dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      // Guard: runAsJob cases already transitioned to idle before finally runs
      setReplState(prev => {
        if (prev === 'idle') return prev;
        return finishReplState({ state: prev }).state;
      });
    }
  }, [replState, dispatch, buildContext, slashPickerOpen, exit, mode, pendingImages, jobManager]);

  // ── Handle review action ──
  const handleReviewAction = useCallback((action: 'apply' | 'edit' | 'reject' | 'copy') => {
    if (!reviewEvent) return;
    switch (action) {
      case 'apply': {
        // Show structured summary before applying
        const files = parsePatch(reviewEvent.patchContent);
        const summary = patchSummary(files);
        dispatch({ type: 'info', message: summary });

        const result = applyPatchWithUndo(resolveWorkingDir(), reviewEvent.patchContent);
        if (result.ok) {
          dispatch({ type: 'success', message: `Patch applied from ${reviewEvent.winnerId}` });
          if (result.undoToken) {
            setLastUndoToken(result.undoToken);
            dispatch({ type: 'info', message: `Undo available: /undo` });
          }
        } else {
          dispatch({ type: 'error', message: `Apply failed: ${result.error ?? 'unknown error'}` });
        }
        break;
      }
      case 'edit':
        try {
          const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
          spawnSync(editor, [reviewEvent.patchPath], { stdio: 'inherit' });
          dispatch({ type: 'info', message: `Opened ${reviewEvent.patchPath} in ${editor}` });
        } catch (err) {
          dispatch({ type: 'error', message: `Editor failed: ${err instanceof Error ? err.message : String(err)}` });
        }
        break;
      case 'reject':
        dispatch({ type: 'info', message: 'Patch rejected.' });
        break;
      case 'copy':
        try {
          copyToClipboard(reviewEvent.patchContent);
          dispatch({ type: 'success', message: 'Patch copied to clipboard' });
        } catch (err) {
          dispatch({ type: 'error', message: `Copy failed: ${err instanceof Error ? err.message : String(err)}` });
        }
        break;
    }
    setReviewEvent(null);
  }, [reviewEvent, dispatch]);

  // ── Handle slash picker selection ──
  const handleSlashSelect = useCallback((cmd: string) => {
    setSlashPickerOpen(false);
    setInputValue(cmd + ' ');
    setInputKey((k) => k + 1); // Force TextInput remount → cursor at end
  }, []);

  // ── Handle question answer ──
  const handleQuestionAnswer = useCallback((answer: string) => {
    if (questionState) {
      questionState.resolve(answer);
      setQuestionState(null);
      setQuestionAnswer('');
    }
  }, [questionState]);

  // Register cancel callback for SIGINT handler
  _cancelCallback = useCallback(() => {
    for (const abort of _activeAborts) abort.abort();
    _activeAborts.clear();
    setActiveAbort(null);
    setLiveSpinner(null);
    setLiveProgress(null);
    setStreamingText(null);
    // SIGINT can fire from any state — guard the transition
    setReplState(prev => {
      if (prev === 'idle') return prev;
      return finishReplState({ state: prev }).state;
    });
  }, [setActiveAbort]);

  // ── History navigation + global keys ──
  useInput((input, key) => {
    // Open slash picker when typing "/" on empty input (not during paste)
    if (input === '/' && !inputValue && !slashPickerOpen && !enginePickerOpen && !questionState && !justPastedRef.current && !isPastingRef.current) {
      setSlashPickerOpen(true);
      return;
    }
    // Tab key accepts ghost text completion
    if ((key.tab || input === '\t') && !slashPickerOpen && !enginePickerOpen && !questionState && !reviewEvent) {
      const ghost = getGhostCompletion(inputValue, allSlashCommands, registry.availableIds());
      if (ghost) {
        setInputValue(inputValue + ghost + ' ');
        setInputKey((k) => k + 1);
        return;
      }
    }
    // Guard: don't process arrow keys when a modal overlay is active
    if (!enginePickerOpen && !questionState) {
      if (key.upArrow && inputHistory.length > 0 && !slashPickerOpen) {
        const newIndex = historyIndex === -1 ? inputHistory.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setInputValue(inputHistory[newIndex]);
      }
      if (key.downArrow && historyIndex >= 0 && !slashPickerOpen) {
        const newIndex = historyIndex + 1;
        if (newIndex >= inputHistory.length) {
          setHistoryIndex(-1);
          setInputValue('');
        } else {
          setHistoryIndex(newIndex);
          setInputValue(inputHistory[newIndex]);
        }
      }
    }
    // Ctrl+C to cancel running command or exit (always active)
    // With exitOnCtrlC: false, Ink passes this to useInput
    if (input === '\x03' || (key.ctrl && input === 'c')) {
      // Clear any pending question prompt first
      if (questionState) {
        questionState.resolve('');
        setQuestionState(null);
        setQuestionAnswer('');
      }
      if (replState !== 'idle' && activeAbort) {
        activeAbort.abort();
        setActiveAbort(null);
        setLiveSpinner(null);
        setLiveProgress(null);
        setStreamingText(null);
        dispatch({ type: 'warning', message: 'Cancelled.' });
        transition(cancelReplState);
      } else if (replState !== 'idle') {
        // Busy/streaming/questioning but no abort controller — force back to idle
        setLiveSpinner(null);
        setLiveProgress(null);
        setStreamingText(null);
        dispatch({ type: 'warning', message: 'Interrupted.' });
        transition(cancelReplState);
      } else {
        exit();
      }
    }
  });

  return (
    <Box flexDirection="column">
      {/* Breadcrumb bar — hidden in conversational chat mode */}
      {mode !== 'chat' && (
        <Box paddingX={1}>
          <Text dimColor>{'\ud83d\udcc2 '}{resolveWorkingDir().split('/').pop()}</Text>
          <Text dimColor>{' \u2502 '}</Text>
          <Text color={mode === 'campfire' ? '#f97316' : mode === 'brainstorm' ? '#22d3ee' : '#a78bfa'}>
            {mode}
          </Text>
          <Text dimColor>{' \u2502 '}</Text>
          <Text dimColor>{registry.availableIds().length}{' engines'}</Text>
          {replState !== 'idle' && (
            <>
              <Text dimColor>{' \u2502 '}</Text>
              <Text color="yellow">{replState}</Text>
            </>
          )}
        </Box>
      )}

      {/* Background job rail */}
      <BackgroundJobRail jobs={jobList.filter((j: Job) => j.state === 'running')} />

      {/* Output area */}
      <Box flexDirection="column">
        {outputBlocks.map((block) => (
          <OutputBlockView key={block.id} event={block.event} mode={mode} />
        ))}
        {liveSpinner && (
          mode === 'chat'
            ? <StatusLine startTime={chatStartTimeRef.current || Date.now()} engineId={liveSpinner.engineId} color={liveSpinner.color} />
            : <SpinnerBlock message={liveSpinner.message} color={liveSpinner.color} />
        )}
        {streamingText && (() => {
          const c = engineColor(streamingText.engineId);
          const cleaned = cleanEngineOutput(streamingText.content);
          if (mode === 'chat') {
            const wrapWidth = contentWidth(6);
            const segments = parseMarkdownBlocks(cleaned);
            return (
              <Box flexDirection="column" marginY={1} paddingLeft={2}>
                <Text><Text color={c} bold>{'● '}{streamingText.engineId}</Text></Text>
                <RenderedSegments segments={segments} borderColor={c} wrapWidth={wrapWidth} />
              </Box>
            );
          }
          const wrapWidth = contentWidth(8);
          const segments = parseMarkdownBlocks(cleaned);
          return (
            <Box flexDirection="column" marginY={1} paddingLeft={2}>
              <Text color={c} bold>{'┌── '}{streamingText.engineId}</Text>
              <Text color={c}>{'│'}</Text>
              <RenderedSegments segments={segments} borderColor={c} wrapWidth={wrapWidth} />
            </Box>
          );
        })()}
        {liveProgress && <EngineProgressView engines={liveProgress} />}
      </Box>

      {/* Patch review overlay */}
      {reviewEvent && (
        <ReviewBlock event={reviewEvent} onAction={handleReviewAction} />
      )}

      {/* Engine picker (interactive /models) */}
      {enginePickerOpen && (
        <EnginePicker
          available={registry.availableIds()}
          initialSelected={sessionEngines ?? registry.availableIds()}
          onConfirm={(selected) => {
            setEnginePickerOpen(false);
            setSessionEngines(selected);
            configSet('forgeEnabledEngines', selected);
            dispatch({ type: 'success', message: `Active engines: ${selected.join(', ')}` });
            dispatch({ type: 'info', message: 'Saved — persists across sessions' });
          }}
          onCancel={() => {
            setEnginePickerOpen(false);
          }}
        />
      )}

      {/* Input area + Status bar (status BELOW input, like Claude Code) */}
      {!enginePickerOpen && (
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          {slashPickerOpen && (
            <SlashPicker
              commands={allSlashCommands}
              onSelect={handleSlashSelect}
              onCancel={() => setSlashPickerOpen(false)}
            />
          )}
          {pendingImages.length > 0 && (
            <Box>
              <Text color="#22d3ee">{'📎 '}</Text>
              {pendingImages.map((img, i) => (
                <Text key={i} dimColor>{img.filename}{i < pendingImages.length - 1 ? ', ' : ''}</Text>
              ))}
            </Box>
          )}
          {/* Queued commands indicator */}
          {inputQueue.length > 0 && (
            <Box>
              <Text dimColor>{'⏳ '}{inputQueue.length} queued{inputQueue.length === 1 ? '' : ''}: </Text>
              <Text dimColor italic>{inputQueue[0].length > 40 ? inputQueue[0].slice(0, 40) + '…' : inputQueue[0]}</Text>
            </Box>
          )}
          {questionState ? (
            <Box>
              <Text bold color="yellow">{questionState.prompt} </Text>
              <TextInput value={questionAnswer} onChange={setQuestionAnswer} onSubmit={handleQuestionAnswer} />
            </Box>
          ) : (
            <Box borderStyle={mode === 'chat' ? 'round' : 'single'}
                 borderColor={mode === 'chat' ? '#585858' : 'gray'}
                 borderLeft={mode !== 'chat'} borderRight={mode !== 'chat'}
                 borderTop borderBottom
                 paddingX={1} width="100%">
              {mode !== 'chat' && (
                <Text>
                  <Text color={mode === 'campfire' ? '#f97316' : mode === 'brainstorm' ? '#22d3ee' : '#a78bfa'} bold>
                    {mode === 'campfire' ? '🔥' : mode === 'brainstorm' ? '💡' : '⚖'}
                    {' '}{mode}
                  </Text>
                  <Text dimColor>{' │ '}</Text>
                </Text>
              )}
              <Text color={mode === 'chat' ? '#585858' : '#fbbf24'}>{mode === 'chat' ? '> ' : '❯ '}</Text>
              <Box flexGrow={1}>
              <TextInput
                key={inputKey}
                value={inputValue}
                onChange={handleInputChange}
                onSubmit={handleSubmit}
                placeholder={replState === 'idle'
                  ? mode === 'chat' ? ''
                  : mode === 'campfire' ? 'What should we think about?'
                  : mode === 'brainstorm' ? 'What question for the engines?'
                  : 'What should they debate?'
                  : ''}
              />
              {(() => {
                const ghost = getGhostCompletion(inputValue, allSlashCommands, registry.availableIds());
                return ghost ? <Text dimColor>{ghost}</Text> : null;
              })()}
              </Box>
            </Box>
          )}
          {/* Status bar BELOW input (like Claude Code's PromptInputFooter) */}
          {mode === 'chat' && <StatusBar config={loadConfig()} chatSession={chatSession} />}
        </Box>
      )}
    </Box>
  );
}

// ── Entry point ──────────────────────────────────────────────────────

export async function startRepl(): Promise<void> {
  ensureAgonHome();
  ensureCurrentWorkspace(process.cwd());

  // Ctrl+C handler at process level — ink-text-input swallows Ctrl+C
  // so useInput never sees it. This is the primary cancel mechanism.
  process.on('SIGINT', () => {
    if (_activeAborts.size > 0) {
      for (const abort of _activeAborts) abort.abort();
      _activeAborts.clear();
      if (_cancelCallback) _cancelCallback();
    } else {
      // Idle — close persistent sessions before exit
      if (_cesarSessionRef) {
        try { _cesarSessionRef.close(); } catch { /* best-effort */ }
        _cesarSessionRef = null;
      }
      process.exit(0);
    }
  });

  render(<App />, { exitOnCtrlC: false });
}
