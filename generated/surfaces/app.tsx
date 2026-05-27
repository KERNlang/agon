// @kern-source: app:4
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';

// @kern-source: app:5
import { Box, Text, Static, render } from 'ink';

// @kern-source: app:6
import { ScrollBox, AlternateScreen } from '@kernlang/terminal/runtime';

// @kern-source: app:7
import { EngineRegistry, loadConfig, ensureAgonHome, ensureCurrentWorkspace, startChatSession, seedChatSessionFromThread, loadOrCreateActiveThread, getRatings, getActiveWorkspace, RUNS_DIR, extractImagesFromInput, resolveWorkingDir, currentBranch, configSet, createCesarMemory, modelEntryToEngineDef, appendMessage, getAgonHome, tracker, planCostEstimator, cancelCesarPlan, saveCesarPlan, listCesarPlans, loadCesarPlan, cesarPlanJsonPath } from '@agon/core';

// @kern-source: app:8
import { resolveBuiltinEnginesDir } from '../lib/engines-dir.js';

// @kern-source: app:9
import type { Plan, ChatSession, Skill, PersistentSession, ImageAttachment } from '@agon/core';

// @kern-source: app:10
import type { EngineProgress } from '../../handlers/types.js';

// @kern-source: app:11
import { createCliAdapter } from '@agon/adapter-cli';

// @kern-source: app:12
import type { EngineAdapter } from '@agon/core';

// @kern-source: app:13
import { detectIntent, SLASH_COMMANDS } from '../signals/intent.js';

// @kern-source: app:14
import { CommandRegistry, registerBuiltinCommands, initExtensions, EventBus, bridgeShellHooks } from '@agon/core';

// @kern-source: app:15
import { JobManager } from '../signals/job-manager.js';

// @kern-source: app:16
import type { Job } from '../signals/job-manager.js';

// @kern-source: app:17
import { ENGINE_COLORS, shortToolPath, isCesarTelemetryLine, formatConfidenceToolLabel } from '../blocks/output-format.js';

// @kern-source: app:18
import { icons } from '../signals/icons.js';

// @kern-source: app:19
import { cleanEngineOutput, parseMarkdownBlocks, truncateCodeLine } from '../blocks/markdown.js';

// @kern-source: app:20
import { extractPatchText, parsePatchPreview } from '../blocks/engine-helpers.js';

// @kern-source: app:21
import type { OutputEvent, HandlerContext } from '../../handlers/types.js';

// @kern-source: app:22
import { codeBlockBuffer } from '../../code-buffer.js';

// @kern-source: app:23
import { startCommandReplState, finishReplState, cancelReplState } from '../signals/app-state.js';

// @kern-source: app:24
import type { ReplStateState } from '../signals/app-state.js';

// @kern-source: app:25
import { createPauseState, renderPauseMenu, movePauseCursor, selectPauseAction, dismissPauseState } from '../cesar/pause-state.js';

// @kern-source: app:26
import type { PauseState } from '../cesar/pause-state.js';

// @kern-source: app:27
import type { Scoreboard } from '../cesar/scoreboard.js';

// @kern-source: app:28
import type { ModeRationale } from '../cesar/mode-rationale.js';

// @kern-source: app:29
import { processPasteContent, expandPastePlaceholders, recordPastePlaceholder } from '../signals/paste-handler.js';

// @kern-source: app:30
import { dispatchIntent, handleModeSwitch, isCesarPlanApprovalInput } from '../signals/dispatch.js';

// @kern-source: app:31
import type { DispatchCallbacks } from '../signals/dispatch.js';

// @kern-source: app:32
import { createTelemetryPoller, TelemetryPoller } from '../cesar/telemetry-poller.js';

// @kern-source: app:33
import type { EngineVitals } from '../cesar/telemetry.js';

// @kern-source: app:34
import { handleOutputEvent, clearPermissionQueue, clearThinkingBuffer } from '../signals/output.js';

// @kern-source: app:35
import type { OutputActions, OutputState, AgentProgressSnapshot, StreamingEntry } from '../signals/output.js';

// @kern-source: app:36
import { appendInputHistory, cleanInputValue, cleanSubmitValue, findInputChange, hasBtwSideChannelTarget, navigateHistory, parseAutoModeCommand, resolveEscapeAction, shouldQueuePlanModeOnTab } from '../signals/app-input.js';

// @kern-source: app:37
import { resolveKeyboardInput } from '../signals/keyboard.js';

// @kern-source: app:38
import { makeBlockArchivePath, appendBlockWithCap } from '../signals/block-archive.js';

// @kern-source: app:39
import { handleReviewAction } from '../blocks/review.js';

// @kern-source: app:40
import { DashboardView, OutputBlockView } from '../blocks/engine.js';

// @kern-source: app:41
import { PlanProposalView } from '../blocks/plan-view.js';

// @kern-source: app:42
import { TodoList } from '../blocks/todo-list.js';

// @kern-source: app:43
import type { Todo } from '../signals/todos.js';

// @kern-source: app:44
import { clearTodos } from '../signals/todos.js';

// @kern-source: app:45
import { saveCesarConversationSnapshot } from '../cesar/session.js';

// @kern-source: app:46
import { SpinnerBlock, StatusBar, CesarStatusStrip, BackgroundJobRail, StatusDashboard, ExecutionRailPanel } from '../../generated/surfaces/status.js';

// @kern-source: app:47
import { EnginePicker, ModelPicker, ReviewBlock, CesarPicker } from '../../generated/blocks/controls.js';

// @kern-source: app:48
import { ComposerView } from '../../generated/blocks/composer.js';

// @kern-source: app:49
import { AgentProgressView } from '../../generated/surfaces/agent.js';

// @kern-source: app:50
import { contentWidth, withContentWidthOverride, color256toHex, engineColor, CODE_RAIL, CODE_RAIL_COLOR, MAX_CODE_LINES } from '../../generated/blocks/rendering.js';

// @kern-source: app:51
import { LOGO_LINES, VERSION, BRAND } from '../../generated/blocks/engine.js';

// @kern-source: app:52
import { ChromeBar, StreamingView, ToolDetailBlock, TranscriptRowView } from './app-views.js';

// @kern-source: app:53
import { recordToolCall, listFiles, getFileTrackerVersion, clearFileTracker } from '../signals/file-tracker.js';

// @kern-source: app:54
import { FileRail } from '../blocks/file-rail.js';

// @kern-source: app:55
import type { OutputBlock } from '../../generated/blocks/engine.js';

// @kern-source: app:56
import type { ReviewEvent } from '../../generated/blocks/controls.js';

// @kern-source: app:57
import { join, dirname } from 'node:path';

// @kern-source: app:58
import { fileURLToPath } from 'node:url';

// @kern-source: app:59
import { readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync } from 'node:fs';

// @kern-source: app:60
import { tmpdir, totalmem, cpus } from 'node:os';

// @kern-source: app:61
import { spawnSync } from 'node:child_process';

// @kern-source: app:62
import { sessionResultStore } from '../models/session-results.js';

// @kern-source: app:63
import { formatSessionResults, formatChatTranscript } from '../blocks/results-formatter.js';

// @kern-source: app:64
import { loadSkills } from '@agon/core';

// @kern-source: app:65
import { isTerminalFocusReport } from '../../input-utils.js';

// @kern-source: app:66
import { useStableInput } from '../../stable-input.js';

// @kern-source: app:67
import { parseProseToRichLines } from '../blocks/rich-text.js';

// @kern-source: app:68
import { COMPOSER_HISTORY_LIMIT, probeEngineVitals, toolDetailViewportRows, findLatestToolDetailEvent, findLatestToolEvent, buildExecutionRailStats, loadComposerInputHistory, saveComposerInputHistory, findLatestFailedToolEvent, buildFailedToolRetryDraft, buildToolDetailView, createInitialRegistry, drainStdinBuffer, normalizeTextSelection, estimateVisibleBlockBudget, estimateBottomChromeExtraRows, summarizeBtwTranscriptEvent, buildDashboardBlock, estimatePinnedLiveRows, coalesceToolCallBlocks, effectiveNativeArchiveBlockCount, historyBlocksForTranscript, nativeTranscriptBlocksForStatic, nativeArchiveBlockCount, appendTranscriptBlock, normalizeTerminalMode, fileRailWidthForTerminal, fileRailMaxRowsForTerminal, buildTranscriptRows } from './app-helpers.js';

// @kern-source: app:70
// ── Module: AppHelperExports ──

export { COMPOSER_HISTORY_LIMIT, isMutatingToolCall, probeEngineVitals, parseToolCallPayload, toolPreviewWindow, toolCallSupportsDetailView, detailViewerSupportsEvent, toolDetailViewportRows, findLatestToolDetailEvent, findLatestToolEvent, buildExecutionRailStats, composerHistoryPath, loadComposerInputHistory, saveComposerInputHistory, findLatestFailedToolEvent, buildFailedToolRetryDraft, buildToolDetailView, createInitialRegistry, drainStdinBuffer, maxScrollOffsetForRowCount, nextWheelAnimationStep, clampNumber, charDisplayWidth, stringDisplayWidth, displayColumnToStringIndex, normalizeRowSelection, normalizeTextSelection, richLineToPlainText, transcriptRowToPlainText, transcriptRowTextStartColumn, resolveTranscriptColumnFromMouse, transcriptRowsToPlainText, resolveTranscriptRowFromMouse, estimateVisibleBlockBudget, estimateWrappedRowCount, estimateQuestionReservedRows, estimateBottomChromeExtraRows, summarizeBtwTranscriptEvent, buildDashboardBlock, estimatePinnedLiveRows, estimateWrappedRows, estimateToolCallRows, estimateOutputEventRows, buildDisplayItems, isToolCallLikeBlock, coalesceToolCallBlocks, effectiveNativeArchiveBlockCount, estimateDisplayItemRows, historyBlocksForTranscript, nativeTranscriptBlocksForStatic, nativeArchiveBlockCount, isDuplicateEngineBlock, appendTranscriptBlock, normalizeTerminalMode, fileRailWidthForTerminal, fileRailMaxRowsForTerminal, buildTerminalReplaySnapshot, parseMarkdownToRows, buildToolCallRows, buildCollapsedToolGroupRows, buildTranscriptRows } from './app-helpers.js';

// @kern-source: app:74
export const _activeAborts: Set<AbortController> = new Set<AbortController>();

// @kern-source: app:76
export const _cancelCallback: { fn: (() => void) | null } = { fn: null };

// @kern-source: app:78
export const _cesarSessionRef: { session: PersistentSession | null } = { session: null };

// @kern-source: app:80
export const _lastSigintAt: { value: number } = { value: 0 };

// @kern-source: app:82
export const _pauseState: { value: PauseState | null } = { value: null };

// @kern-source: app:84

export function App({  }: {  }) {
  const [replState, setReplState] = useState<ReplStateState>('idle');
  const [outputBlocks, setOutputBlocks] = useState<OutputBlock[]>(() => { const cfg = loadConfig(); const saved = cfg.engineActivationMode === 'explicit' ? cfg.forgeEnabledEngines : null; return [buildDashboardBlock(saved)]; });
  const [inputValue, setInputValue] = useState<string>('');
  const [inputHistory, setInputHistory] = useState<string[]>(loadComposerInputHistory());
  const [inputQueue, setInputQueue] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [mode, setMode] = useState<'chat'|'campfire'|'brainstorm'|'tribunal'>('chat');
  const [sessionStartTime, setSessionStartTime] = useState<number>(Date.now());
  const [liveSpinner, setLiveSpinner] = useState<any>(null);
  const [liveProgress, setLiveProgress] = useState<EngineProgress[]|null>(null);
  const [slashPickerOpen, setSlashPickerOpen] = useState<boolean>(false);
  const [questionState, setQuestionState] = useState<any>(null);
  const [questionAnswer, setQuestionAnswer] = useState<string>('');
  const [btwPanel, setBtwPanel] = useState<any|null>(null);
  const [enginePickerOpen, setEnginePickerOpen] = useState<boolean>(false);
  const [modelPickerOpen, setModelPickerOpen] = useState<boolean>(false);
  const [modelPickerEntries, setModelPickerEntries] = useState<any[]>([]);
  const [modelPickerLoading, setModelPickerLoading] = useState<boolean>(false);
  const [modelPickerInitialFilter, setModelPickerInitialFilter] = useState<string>('');
  const [modelPickerTitle, setModelPickerTitle] = useState<string>('Select model');
  const [modelPickerTargetEngine, setModelPickerTargetEngine] = useState<string|null>(null);
  const [modelPickerCliGroups, setModelPickerCliGroups] = useState<any[]>([]);
  const [cesarPickerOpen, setCesarPickerOpen] = useState<boolean>(false);
  const [streamingText, setStreamingText] = useState<Record<string,StreamingEntry>>({});
  const [liveToolStreams, setLiveToolStreams] = useState<Record<string,any>>({});
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [reviewEvent, setReviewEvent] = useState<ReviewEvent|null>(null);
  const [pendingPlanProposal, setPendingPlanProposal] = useState<OutputEvent|null>(null);
  const [lastReviewResult, setLastReviewResult] = useState<{ engineId: string; target: string; label: string; diff: string; reviewOutput: string; timestamp: number } | null>(null);
  const [toolDetailEvent, setToolDetailEvent] = useState<any|null>(null);
  const [jobManager, setJobManager] = useState<any>(() => new JobManager());
  const [jobList, setJobList] = useState<Job[]>([]);
  const [lastUndoToken, setLastUndoToken] = useState<string|null>(null);
  const [sessionEngines, setSessionEngines] = useState<string[]|null>(() => { const cfg = loadConfig(); return cfg.engineActivationMode === 'explicit' ? cfg.forgeEnabledEngines : null; });
  const [currentPlan, setCurrentPlan] = useState<Plan|null>(null);
  const [activePlan, setActivePlan] = useState<any>(null);
  const [chatSession, setChatSession] = useState<ChatSession>(() => { const cwd = resolveWorkingDir(); let branch = 'unknown'; try { branch = currentBranch(cwd); } catch { /* git not available or not a repo */ } const session = startChatSession({ cwd, branch }); if (process.env.AGON_CONTINUE === '1') { try { seedChatSessionFromThread(session, loadOrCreateActiveThread(cwd)); } catch { /* best-effort: a fresh session is fine if no prior thread exists */ } } return session; });
  const [activeAbort, setActiveAbort] = useState<AbortController|null>(null);
  const [cesarSession, setCesarSession] = useState<PersistentSession|null>(null);
  const [explorationMode, setExplorationMode] = useState<boolean>(false);
  const [neroMode, setNeroMode] = useState<boolean>(false);
  const [toolOutputExpanded, setToolOutputExpanded] = useState<boolean>(false);
  const [thinkingExpanded, setThinkingExpanded] = useState<boolean>(true);
  const [cesarConfidence, setCesarConfidence] = useState<number|null>(null);
  const [liveScoreboard, setLiveScoreboard] = useState<Scoreboard|null>(null);
  const [liveRationale, setLiveRationale] = useState<ModeRationale|null>(null);
  const [agentProgress, setAgentProgress] = useState<Record<string,AgentProgressSnapshot>>({});
  const [todos, setTodos] = useState<Todo[]>([]);
  const [planModeQueued, setPlanModeQueued] = useState<boolean>(false);
  const [autoModeQueued, setAutoModeQueued] = useState<boolean>(() => loadConfig().cesarAutoMode === true);
  const [cesarMemory, setCesarMemory] = useState<any>(() => createCesarMemory());
  const [sessionMcpServers, setSessionMcpServers] = useState<Array<Record<string,unknown>>>([]);
  const [telemetryVitals, setTelemetryVitals] = useState<Map<string,any>>(() => new Map());
  const [recentFallbacks, setRecentFallbacks] = useState<{from:string,to:string,reason:string,at:number}[]>([]);
  const [statusDashboardOpen, setStatusDashboardOpen] = useState<boolean>(false);
  const [statusDashboardFilter, setStatusDashboardFilter] = useState<'all'|'problem'>('all');
  const [registry, setRegistry] = useState<EngineRegistry>(createInitialRegistry());
  const [adapter, setAdapter] = useState<EngineAdapter>(createCliAdapter(registry));
  const [dynamicSkills, setDynamicSkills] = useState<Skill[]>(() => loadSkills(resolveWorkingDir()));
  const [commandRegistry, setCommandRegistry] = useState<any>(() => (() => { const reg = new CommandRegistry(); registerBuiltinCommands(reg); return reg; })());
  const [eventBus, setEventBus] = useState<any>(() => (() => { const bus = new EventBus(); const cfg = loadConfig(); if (cfg.hooks) bridgeShellHooks(bus, cfg.hooks); return bus; })());
  const [extensionSkills, setExtensionSkills] = useState<Skill[]>([]);
  const [extensionPromptFragments, setExtensionPromptFragments] = useState<string[]>([]);
  const [loadedExtensions, setLoadedExtensions] = useState<any[]>([]);
  const [workspacePath, setWorkspacePath] = useState<string>(resolveWorkingDir());
  const [termWidth, setTermWidth] = useState<number>(process.stdout.columns || 100);
  const [termHeight, setTermHeight] = useState<number>(process.stdout.rows || 24);
  const [nativeStaticEpoch, setNativeStaticEpoch] = useState<number>(0);
  const [nativeArchiveCount, setNativeArchiveCount] = useState<number>(0);
  const [fileRailOpen, setFileRailOpen] = useState<boolean>(false);
  const [executionRailOpen, setExecutionRailOpen] = useState<boolean>(false);
  const [fileRailVersion, setFileRailVersion] = useState<number>(0);
  const [fileRailSelectedIdx, setFileRailSelectedIdx] = useState<number>(0);
  const [fileRailExpandedPath, setFileRailExpandedPath] = useState<string|null>(null);
  const [mouseSelection, setMouseSelection] = useState<{ anchorRow: number | null; anchorCol: number | null; focusRow: number | null; focusCol: number | null; active: boolean; moved: boolean }>({ anchorRow: null, anchorCol: null, focusRow: null, focusCol: null, active: false, moved: false });
  const [registryVersion, setRegistryVersion] = useState<number>(0);
  const [configVersion, setConfigVersion] = useState<number>(0);
  const activeEnginePidsRef = useRef<Map<string,number>>(new Map());
  const telemetryPollerRef = useRef<any>(null);
  const chatStartTimeRef = useRef<number>(0);
  const currentPlanRef = useRef<Plan|null>(null);
  const activePlanRef = useRef<any>(null);
  const activePlanClearTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  const planWatcherTimerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const planWatcherDebounceTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  const planWatcherStatMtimeRef = useRef<number>(0);
  const lastActivePlanSigRef = useRef<string>('');
  const streamingTextRef = useRef<Record<string,StreamingEntry>>({});
  const liveToolStreamsRef = useRef<Record<string,any>>({});
  const agentProgressRef = useRef<Record<string,AgentProgressSnapshot>>({});
  const lastReviewResultRef = useRef<{ engineId: string; target: string; label: string; diff: string; reviewOutput: string; timestamp: number } | null>(null);
  const modeRef = useRef<'chat'|'campfire'|'brainstorm'|'tribunal'>('chat');
  const inputEpochRef = useRef<number>(0);
  const inputValueRef = useRef<string>('');
  const ctrlKeyHandledRef = useRef<boolean>(false);
  const pendingPasteTransformRef = useRef<boolean>(false);
  const pasteHashesRef = useRef<Map<string,string>>(new Map());
  const activeAbortRef = useRef<AbortController|null>(null);
  const activeTurnRef = useRef<{ input:string; engineId:string; retried:boolean }|null>(null);
  const lastActivityTimeRef = useRef<number>(Date.now());
  const blockArchivePathRef = useRef<string>(makeBlockArchivePath(Date.now()));
  const nestedCtrlShortcutRef = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const displayRowCountRef = useRef<number>(0);
  const mouseInputBufferRef = useRef<string>('');
  const wheelDeltaRef = useRef<number>(0);
  const wheelFlushTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  const mouseSelectionRef = useRef<{ anchorRow: number | null; anchorCol: number | null; focusRow: number | null; focusCol: number | null; active: boolean; moved: boolean }>({ anchorRow: null, anchorCol: null, focusRow: null, focusCol: null, active: false, moved: false });
  const lastTerminalInputAtRef = useRef<number>(Date.now());
  const scrollBoxRef = useRef<any>(null);
  const nativeTranscriptBlockCountRef = useRef<number>(0);

  const allSlashCommands = useMemo(() => {
    const builtinCmds = SLASH_COMMANDS;
    const registryCmds = commandRegistry.listForHelp();
    const skillCmds = [...dynamicSkills, ...extensionSkills].map((s: {trigger:string,description?:string,name:string}) => Object.assign({}, { cmd: s.trigger, desc: s.description || s.name }));
    // Dedupe across builtins, registry-provided commands, and dynamic skills.
    const mergedBase = [...builtinCmds, ...registryCmds].filter((cmd: any, index: number, all: any[]) => all.findIndex((other: any) => other.cmd === cmd.cmd) === index);
    const seen = new Set(mergedBase.map((c: any) => c.cmd));
    const uniqueSkills = skillCmds.filter((s: any) => !seen.has(s.cmd));
    return [...mergedBase, ...uniqueSkills];
  }, [dynamicSkills, extensionSkills, commandRegistry]);

  const availableEngines = useMemo(() => {
          const hidden = new Set((loadConfig() as any).hiddenEngines ?? []);
          return registry.availableIds().filter((id: string) => !hidden.has(id));
  }, [registry, registryVersion, configVersion]);

  const config = useMemo(() => {
    return loadConfig();
  }, [configVersion]);

  const terminalMode = useMemo(() => {
    return normalizeTerminalMode((config as any).terminalMode);
  }, [config]);

  const nativeTranscriptBlocks = useMemo(() => {
    return nativeTranscriptBlocksForStatic(outputBlocks);
  }, [outputBlocks]);

  const statusCwd = useMemo(() => {
          return workspacePath.replace(process.env.HOME ?? '', '~');
  }, [workspacePath]);

  const statusBranch = useMemo(() => {
    try {
      return currentBranch(workspacePath);
    } catch (e) {
      return '';
    }
  }, [workspacePath]);

  const statusStats = useMemo(() => {
    const stats = tracker.getStats();
    const cesarId = (config as any).cesarEngine ?? config.forgeFixedStarter ?? 'claude';
    return { cesarId: cesarId, chatMessageCount: chatSession.messages.length, totalTokens: stats.totalTokens, totalCostUsd: stats.totalCostUsd };
  }, [outputBlocks,chatSession,replState,config]);

  const runningJobs = useMemo(() => {
    return jobList.filter((j: Job) => j.state === 'running');
  }, [jobList]);

  const activeStream = useMemo(() => {
    const entries = Object.values(streamingText);
    if (entries.length === 0) {
      return null;
    }
    let latest: StreamingEntry | null = null;
    for (const e of entries) {
      if (!latest || e.startedAt > latest.startedAt) {
        latest = e;
      }
    }
    return latest;
  }, [streamingText]);

  const streamSnippet = useMemo(() => {
    if (!activeStream || !activeStream.content) {
      return null;
    }
    const cleaned = cleanEngineOutput(activeStream.content);
    const lines = cleaned.split('\n').filter((l: string) => l.trim());
    if (lines.length === 0) {
      return null;
    }
    return { engineId: activeStream.engineId, line: lines[lines.length - 1].trim() };
  }, [activeStream]);

  const latestToolEvent = useMemo(() => {
    return findLatestToolEvent(outputBlocks);
  }, [outputBlocks]);

  const executionRailStats = useMemo(() => {
    return buildExecutionRailStats(outputBlocks, listFiles(), inputQueue.length);
  }, [outputBlocks,fileRailVersion,inputQueue]);

  const overlayReservedRows = useMemo(() => {
    if (toolDetailEvent) {
      return toolDetailViewportRows(termHeight) + 5;
    }
    if (btwPanel) {
      return 9;
    }
    return (enginePickerOpen || modelPickerOpen || cesarPickerOpen || !(!reviewEvent)) ? 4 : 0;
  }, [enginePickerOpen, modelPickerOpen, cesarPickerOpen, reviewEvent, toolDetailEvent, btwPanel, termHeight]);

  const bottomChromeReservedRows = useMemo(() => {
    return estimateBottomChromeExtraRows(mode, questionState, termWidth, pendingImages.length, inputQueue.length, !(!liveSpinner));
  }, [mode,questionState,termWidth,pendingImages,inputQueue,liveSpinner]);

  const overlayActive = useMemo(() => {
    return enginePickerOpen || modelPickerOpen || cesarPickerOpen || !(!reviewEvent) || !(!toolDetailEvent);
  }, [enginePickerOpen, modelPickerOpen, cesarPickerOpen, reviewEvent, toolDetailEvent]);

  const toolDetailView = useMemo(() => {
    return toolDetailEvent ? buildToolDetailView(toolDetailEvent) : null;
  }, [toolDetailEvent, termWidth]);

  const startupOnly = useMemo(() => {
    return outputBlocks.length === 1 && outputBlocks[0]?.event?.type === 'dashboard' && !activeStream && !liveProgress && Object.keys(liveToolStreams).length === 0 && Object.keys(agentProgress).length === 0;
  }, [outputBlocks,activeStream,liveProgress,agentProgress,liveToolStreams]);

  const historyBlocks = useMemo(() => {
    return historyBlocksForTranscript(outputBlocks);
  }, [outputBlocks]);

  const displayBlocks = useMemo(() => {
    return startupOnly ? outputBlocks : historyBlocks;
  }, [startupOnly,outputBlocks,historyBlocks]);

  const livePaneVisible = useMemo(() => {
    if (startupOnly) {
      return false;
    }
    return !(!activeStream) || !(!liveProgress) || Object.keys(liveToolStreams).length > 0 || Object.keys(agentProgress).length > 0;
  }, [activeStream, liveProgress, liveToolStreams, agentProgress, startupOnly]);

  const currentVisibleRowBudget = useMemo(() => {
    const pinnedLiveRows = livePaneVisible ? estimatePinnedLiveRows(mode, !(!activeStream), !(!liveProgress), Object.keys(agentProgress).length, Object.keys(liveToolStreams).length) : 0;
    const viewportRows = Math.max(1, termHeight - pinnedLiveRows);
    return estimateVisibleBlockBudget(viewportRows, mode, overlayReservedRows + bottomChromeReservedRows);
  }, [termHeight, mode, overlayReservedRows, bottomChromeReservedRows, livePaneVisible, activeStream, liveProgress, liveToolStreams, agentProgress]);

  const nativeArchiveTarget = useMemo(() => {
    return nativeArchiveBlockCount(nativeTranscriptBlocks, mode, currentVisibleRowBudget, toolOutputExpanded, thinkingExpanded);
  }, [nativeTranscriptBlocks,mode,currentVisibleRowBudget,toolOutputExpanded,thinkingExpanded]);

  const effectiveNativeArchiveCount = useMemo(() => {
    const baseArchiveCount = (nativeTranscriptBlocks.length < nativeTranscriptBlockCountRef.current) ? 0 : nativeArchiveCount;
    return effectiveNativeArchiveBlockCount(nativeTranscriptBlocks, baseArchiveCount, nativeArchiveTarget, toolOutputExpanded);
  }, [nativeArchiveCount,nativeArchiveTarget,nativeTranscriptBlocks,toolOutputExpanded]);

  const nativeArchiveBlocks = useMemo(() => {
    return coalesceToolCallBlocks(nativeTranscriptBlocks.slice(0, effectiveNativeArchiveCount));
  }, [nativeTranscriptBlocks,effectiveNativeArchiveCount]);

  const nativeLiveBlocks = useMemo(() => {
    return nativeTranscriptBlocks.slice(effectiveNativeArchiveCount);
  }, [nativeTranscriptBlocks,effectiveNativeArchiveCount]);

  const displayRows = useMemo(() => {
    return buildTranscriptRows(displayBlocks, mode, toolOutputExpanded, thinkingExpanded);
  }, [displayBlocks, mode, toolOutputExpanded, thinkingExpanded]);

  const nativeLiveRows = useMemo(() => {
    return buildTranscriptRows(nativeLiveBlocks, mode, toolOutputExpanded, thinkingExpanded);
  }, [nativeLiveBlocks,mode,toolOutputExpanded,thinkingExpanded]);

  const totalDisplayRows = useMemo(() => {
    return displayRows.length;
  }, [displayRows]);

  const selectedRowRange = useMemo(() => {
    const range = normalizeTextSelection(mouseSelection.anchorRow, mouseSelection.anchorCol, mouseSelection.focusRow, mouseSelection.focusCol);
    return range ? { start: range.startRow, end: range.endRow } : null;
  }, [mouseSelection]);

  const selectedTextRange = useMemo(() => {
    return normalizeTextSelection(mouseSelection.anchorRow, mouseSelection.anchorCol, mouseSelection.focusRow, mouseSelection.focusCol);
  }, [mouseSelection]);

  const startupFitsViewport = useMemo(() => {
    return startupOnly && totalDisplayRows <= currentVisibleRowBudget;
  }, [startupOnly, totalDisplayRows, currentVisibleRowBudget]);

  const startupUseDashboardView = useMemo(() => {
    return startupFitsViewport && termWidth >= 100;
  }, [startupFitsViewport, termWidth]);

  const outputActions = useMemo(() => {
          return {
            setLiveSpinner,
            setLiveProgress,
            setStreamingText: (updater: Record<string,StreamingEntry> | ((prev: Record<string,StreamingEntry>) => Record<string,StreamingEntry>)) => {
              const prev = streamingTextRef.current;
              const next = typeof updater === 'function' ? (updater as (p: Record<string,StreamingEntry>) => Record<string,StreamingEntry>)(prev) : updater;
              streamingTextRef.current = next;
              setStreamingText(next);
            },
            setLiveToolStreams: (updater: Record<string,any> | ((prev: Record<string,any>) => Record<string,any>)) => {
              const prev = liveToolStreamsRef.current;
              const next = typeof updater === 'function' ? (updater as (p: Record<string,any>) => Record<string,any>)(prev) : updater;
              liveToolStreamsRef.current = next;
              setLiveToolStreams(next);
            },
            addBlock: (event: any) => {
              setOutputBlocks((prev: any) => appendTranscriptBlock(prev, event, blockArchivePathRef.current));
            },
            replaceBlocksOfType: (eventType: string, event: any) => {
              setOutputBlocks((prev: any) => {
                const filtered = prev.filter((b: any) => b.event.type !== eventType);
                return appendTranscriptBlock(filtered, event, blockArchivePathRef.current);
              });
            },
            clearBlocks: () => setOutputBlocks([]),
            setPendingPlanProposal: (val: OutputEvent | null) => setPendingPlanProposal(val),
            setReviewEvent,
            setQuestionState,
            setChatStartTime: (val: number) => { chatStartTimeRef.current = val; },
            flushStream: () => {
              // Flush every in-flight engine's stream to the transcript. Multi-agent
              // teams may have N concurrent streams when flush is requested (e.g.,
              // permission-ask interrupts mid-stream).
              const prev = streamingTextRef.current;
              for (const eid of Object.keys(prev)) {
                const entry = prev[eid];
                if (!entry) continue;
                const color = ENGINE_COLORS[entry.engineId] ?? 124;
                setOutputBlocks((blocks: any) => appendTranscriptBlock(blocks, { type: 'engine-block', engineId: entry.engineId, color, content: entry.content } as any, blockArchivePathRef.current));
              }
              streamingTextRef.current = {};
              setStreamingText({});
              liveToolStreamsRef.current = {};
              setLiveToolStreams({});
            },
            getEngineColor: (engineId: string) => ENGINE_COLORS[engineId] ?? 124,
            setCesarConfidence,
            setLiveScoreboard: (val: Scoreboard | null) => setLiveScoreboard(val),
            setLiveRationale: (val: ModeRationale | null) => setLiveRationale(val),
            setAgentProgress: (updater: Record<string,AgentProgressSnapshot> | ((prev: Record<string,AgentProgressSnapshot>) => Record<string,AgentProgressSnapshot>)) => {
              const prev = agentProgressRef.current;
              const next = typeof updater === 'function' ? (updater as (p: Record<string,AgentProgressSnapshot>) => Record<string,AgentProgressSnapshot>)(prev) : updater;
              agentProgressRef.current = next;
              setAgentProgress(next);
            },
            clearAgentProgressByTeam: (teamId: string) => {
              const prev = agentProgressRef.current;
              const next: Record<string, AgentProgressSnapshot> = {};
              for (const eid of Object.keys(prev)) {
                const entry = prev[eid];
                if (entry && entry.teamId !== teamId) next[eid] = entry;
              }
              agentProgressRef.current = next;
              setAgentProgress(next);
            },
            setTodos: (updater: Todo[] | ((prev: Todo[]) => Todo[])) => setTodos(updater as any),
          };
  }, []);

  const transition = useCallback((fn:any) => {
          setReplState((prev: any) => {
            try { return fn({ state: prev }).state; }
            catch { return prev; }
          });
  }, []);

  const trackAbort = useCallback((abort:AbortController|null) => {
    if (activeAbortRef.current) {
      _activeAborts.delete(activeAbortRef.current);
    }
    activeAbortRef.current = abort;
    if (abort) {
      _activeAborts.add(abort);
    }
    setActiveAbort(abort);
  }, []);

  const setCesarSessionWrapped = useCallback((session:PersistentSession|null) => {
    const previous = _cesarSessionRef.session;
    if (previous && previous !== session && (config as any).sessionContinuity === true) {
      saveCesarConversationSnapshot(previous, chatSession);
    }
    _cesarSessionRef.session = session;
    setCesarSession(session);
  }, [chatSession,config]);

  const activeEngines = useCallback(() => {
          if (!sessionEngines) return registry.activeIds(config as any);
          return registry.activeIds({ ...(config as any), engineActivationMode: 'explicit', forgeEnabledEngines: sessionEngines } as any);
  }, [registry,sessionEngines,config]);

  const setPersistentAutoMode = useCallback((enabled:boolean) => {
    configSet('cesarAutoMode' as any, enabled as any);
    configSet('cesarAutoModePrompted' as any, true as any);
    setAutoModeQueued(enabled);
    setConfigVersion((v: number) => v + 1);
  }, []);

  const setActivePlanWrapped = useCallback((plan:any) => {
          if (activePlanClearTimerRef.current) {
            clearTimeout(activePlanClearTimerRef.current);
            activePlanClearTimerRef.current = null;
          }
          activePlanRef.current = plan;
          const state = String(plan?.state ?? '');
          const steps = Array.isArray(plan?.steps) ? plan.steps : [];
          // Cheap signature of UI-visible plan state. If unchanged, skip the
          // React setState — plan-watcher writes a fresh object every tick during
          // execution, but step-state and plan-state often haven't shifted, and
          // a setActivePlan call here cascades into ChromeBar/ExecutionRail/
          // CesarStatusStrip re-renders despite identical content. Refs still
          // get the new object so callers reading fresh fields via the ref see
          // the latest data.
          const sig = plan
            ? `${String(plan.id ?? '')}|${state}|${String(plan.currentStepId ?? '')}|${steps.map((s: any) => `${String(s?.id ?? '')}:${String(s?.state ?? '')}`).join(',')}`
            : '';
          if (sig !== lastActivePlanSigRef.current) {
            lastActivePlanSigRef.current = sig;
            setActivePlan(plan);
          }
          const allStepsComplete = steps.length > 0 && steps.every((step: any) => ['done', 'skipped'].includes(String(step?.state ?? ''))) && !steps.some((step: any) => String(step?.state ?? '') === 'failed');
          const shouldRetire = state === 'done' || state === 'cancelled' || state === 'paused' || allStepsComplete;
          if (plan && shouldRetire) {
            const planId = String(plan.id ?? '');
            const retireMs = state === 'paused' ? 45000 : 12000;
            activePlanClearTimerRef.current = setTimeout(() => {
              const current = activePlanRef.current;
              if (current && String(current.id ?? '') === planId) {
                activePlanRef.current = null;
                lastActivePlanSigRef.current = '';
                setActivePlan(null);
              }
              activePlanClearTimerRef.current = null;
            }, retireMs);
          }
  }, []);

  const dispatch = useCallback((event:OutputEvent) => {
    const et = (event as any).type;
    if (et === 'streaming-chunk' || et === 'thinking-chunk' || et === 'progress-update' || et === 'tool-call' || et === 'spinner-start' || et === 'spinner-update') {
      lastActivityTimeRef.current = Date.now();
    }
    // Feed FileTracker: only tool-call events with file-touching tools
    // actually populate it (others are no-ops inside the tracker).
    if (et === 'tool-call') {
      const tc = event as any;
      recordToolCall(tc.tool, tc.input, tc.status);
      setFileRailVersion(getFileTrackerVersion());
    }
    if (et === 'engine-pid') {
      const engineId = String((event as any).engineId ?? '').trim();
      const pid = Number((event as any).pid ?? 0);
      if (engineId && Number.isFinite(pid) && pid > 0) {
        activeEnginePidsRef.current.set(engineId, pid);
      }
    }
    if (et === 'engine-pid-clear') {
      const engineId = String((event as any).engineId ?? '').trim();
      if (engineId) {
        activeEnginePidsRef.current.delete(engineId);
      }
    }
    const state: OutputState = { liveSpinner: null, liveProgress: null, streamingText: streamingTextRef.current ?? {}, liveToolStreams: liveToolStreamsRef.current ?? {}, agentProgress: agentProgressRef.current ?? {}, todos: todos };
    handleOutputEvent(event, state, outputActions, mode, chatStartTimeRef.current);
  }, [mode]);

  const askQuestion = useCallback((prompt:string) => {
          return new Promise<string>((resolve) => { dispatch({ type: 'question', prompt, resolve } as any); });
  }, [dispatch]);

  const interruptActiveRun = useCallback((message:string, clearChat:boolean) => {
    const abort = activeAbortRef.current;
    if (abort) {
      abort.abort();
    }
    trackAbort(null);
    setLiveSpinner(null);
    setLiveProgress(null);
    // Commit any in-flight streams before wiping. In main-buffer mode the
    // partial text has already been written to the terminal; dropping it
    // from React state without flushing causes logUpdate.eraseLines to
    // wipe visible output the user was just reading.
    outputActions.flushStream();
    clearPermissionQueue();
    clearThinkingBuffer();
    setQuestionState(null);
    setQuestionAnswer('');
    setPendingPlanProposal(null);
    setSlashPickerOpen(false);
    setEnginePickerOpen(false);
    setModelPickerOpen(false);
    setCesarPickerOpen(false);
    setReviewEvent(null);
    const pendingPlan = activePlanRef.current;
    if (pendingPlan && ['planning', 'awaiting_approval'].includes(String(pendingPlan.state ?? ''))) {
      try {
        saveCesarPlan(cancelCesarPlan(pendingPlan));
      } catch (_err) {
      }
      activePlanRef.current = null;
      setActivePlan(null);
    }
    if (replState !== 'idle') {
      if (message) {
        dispatch({ type: 'warning', message: message } as any);
      }
      setReplState((prev: any) => (prev === 'idle') ? prev : cancelReplState({ state: prev }).state);
    }
    if (clearChat) {
      dispatch({ type: 'clear' } as any);
    }
  }, [replState,dispatch,trackAbort,outputActions]);

  const buildContext = useCallback(() => {
          return {
            registry, adapter, activeEngines,
            get inputEpoch() { return inputEpochRef.current; },
            config: loadConfig(), chatSession,
            get currentPlan() { return currentPlanRef.current; },
            get lastReviewResult() { return lastReviewResultRef.current; },
            set lastReviewResult(value: any) {
              lastReviewResultRef.current = value;
              setLastReviewResult(value);
            },
            setCurrentPlan, setActiveAbort: trackAbort,
            askQuestion, cesarSession, setCesarSession: setCesarSessionWrapped,
            explorationMode, setExplorationMode,
            neroMode, setNeroMode,
            cesarMemory,
            get activePlan() { return activePlanRef.current; }, setActivePlan: setActivePlanWrapped,
            extensionPromptFragments,
            sessionMcpServers, setSessionMcpServers,
            telemetryVitals,
            recentFallbacks,
          };
  }, [registry,adapter,activeEngines,chatSession,askQuestion,cesarSession,explorationMode,neroMode,extensionPromptFragments,sessionMcpServers,telemetryVitals,recentFallbacks,setActivePlanWrapped]);

  const handlePasteInput = useCallback((raw:string) => {
    const result = processPasteContent(String(raw ?? ''));
    if (result.type === 'empty') {
      return '';
    }
    if (result.type === 'stored') {
      recordPastePlaceholder(pasteHashesRef.current, result.placeholder, result.fullHash);
    }
    const replacement = (result.type === 'stored') ? result.placeholder : result.content;
    pendingPasteTransformRef.current = replacement.length > 0;
    return replacement;
  }, []);

  const handleInputChange = useCallback((value:string) => {
    // Swallow input while a choice question is active — the keyboard handler
    // resolves the choice on a single keypress.
    if (questionState && questionState.choices) {
      return;
    }
    // Reject value changes caused by Ctrl+key shortcuts (the input hooks already handled them,
    // but TextInput still fires onChange with the raw character)
    if (ctrlKeyHandledRef.current) {
      ctrlKeyHandledRef.current = false;
      return;
    }
    const nextValue = cleanInputValue(value);
    const prevValue = inputValueRef.current;
    const change = findInputChange(prevValue, nextValue);
    const cameFromPasteTransform = pendingPasteTransformRef.current;
    if (cameFromPasteTransform) {
      pendingPasteTransformRef.current = false;
    }
    // "/" typed into empty input → open slash picker, swallow the character
    if (!prevValue && nextValue === '/' && !slashPickerOpen && !enginePickerOpen && !modelPickerOpen && !questionState && !cameFromPasteTransform) {
      if (planModeQueued) {
        setPlanModeQueued(false);
      }
      setSlashPickerOpen(true);
      return;
    }
    // When slash picker is open, don't update inputValue — picker manages its own filter
    if (slashPickerOpen) {
      return;
    }
    const looksLikePaste = value !== nextValue || change.inserted.length > 1;
    if (cameFromPasteTransform || !looksLikePaste || !change.inserted) {
      inputValueRef.current = nextValue;
      setInputValue(nextValue);
      return;
    }
    const result = processPasteContent(change.inserted);
    if (result.type === 'empty') {
      inputValueRef.current = nextValue;
      setInputValue(nextValue);
      return;
    }
    if (result.type === 'stored') {
      recordPastePlaceholder(pasteHashesRef.current, result.placeholder, result.fullHash);
    }
    const replacement = (result.type === 'stored') ? result.placeholder : result.content;
    const updatedValue = nextValue.slice(0, change.start) + replacement + nextValue.slice(change.start + change.inserted.length);
    inputValueRef.current = updatedValue;
    setInputValue(updatedValue);
  }, [slashPickerOpen,enginePickerOpen,modelPickerOpen,questionState,planModeQueued,autoModeQueued]);

  const handleSubmit = useCallback(async (value:string) => {
          inputEpochRef.current += 1;
          let input = cleanSubmitValue(value);
          if (!input) return;
          // Bare "/" → open slash picker flyout, don't dump text list
          if (input === '/') {
            if (planModeQueued) setPlanModeQueued(false);
            setSlashPickerOpen(true);
            return;
          }
          input = expandPastePlaceholders(input, pasteHashesRef.current);
          pasteHashesRef.current.clear();
          pendingPasteTransformRef.current = false;
          inputValueRef.current = '';
          setInputValue('');
          setInputHistory((prev: string[]) => {
            const next = appendInputHistory(prev, input, COMPOSER_HISTORY_LIMIT);
            saveComposerInputHistory(next);
            return next;
          });
          setHistoryIndex(-1);
    
          const autoControl = parseAutoModeCommand(input);
          if (autoControl) {
            if (autoControl === 'status') {
              dispatch({ type: 'info', message: autoModeQueued ? 'AUTO is ON by default — plain tasks may self-escalate through Cesar.' : 'AUTO is OFF by default.' } as any);
              return;
            }
            const nextAutoModeQueued = autoControl === 'toggle' ? !autoModeQueued : autoControl === 'on';
            setPlanModeQueued(false);
            setPersistentAutoMode(nextAutoModeQueued);
            dispatch({
              type: 'info',
              message: nextAutoModeQueued
                ? 'AUTO ON by default. Plain tasks may self-escalate through Cesar. Use /auto off or Ctrl+A to disable.'
                : 'AUTO OFF by default.',
            } as any);
            return;
          }
    
          if (!input.startsWith('/') && activePlanRef.current?.state === 'awaiting_approval' && isCesarPlanApprovalInput(input)) {
            input = '/approve';
          }
    
          // /btw <question> — side-channel question during active dispatch
          const btwLower = input.trim().toLowerCase();
          if (btwLower === '/btw') {
            dispatch({ type: 'info', message: 'Usage: /btw <question> — ask something while engines work.' } as any);
            return;
          }
          if (btwLower.startsWith('/btw ')) {
            const btwQuestion = input.trim().slice(5).trim();
            const activeWorkForBtw = hasBtwSideChannelTarget({
              replState,
              activePlanState: activePlanRef.current?.state ?? null,
              runningJobCount: jobManager.running().length,
            });
            if (btwQuestion && activeWorkForBtw) {
              // Fire side-dispatch into its own panel — don't interrupt main task
              const ctx = buildContext();
              const cesarId = (ctx.config as any).cesarEngine ?? ctx.config.forgeFixedStarter ?? 'claude';
              let engineDef: any;
              try { engineDef = ctx.registry.get(cesarId); } catch { /* cesar engine not registered */ }
    
              if (!engineDef) {
                dispatch({ type: 'error', message: `btw: engine ${cesarId} not available` } as any);
                return;
              }
    
              // Build context from streaming output (pick the most recent in-flight stream)
              let streamCtx = '';
              const streamEntries = Object.values(streamingTextRef.current ?? {});
              if (streamEntries.length > 0) {
                let latest: StreamingEntry | null = null;
                for (const e of streamEntries) {
                  if (!latest || e.startedAt > latest.startedAt) latest = e;
                }
                if (latest && latest.content) {
                  const lines = latest.content.split('\n').filter((l: string) => l.trim());
                  streamCtx = lines.slice(-10).join('\n');
                }
              }
    
              const transcriptCtx = outputBlocks
                .slice(-16)
                .map((block: any) => summarizeBtwTranscriptEvent(block?.event))
                .filter(Boolean)
                .slice(-8)
                .join('\n');
              const runningCtx = [
                `Mode: ${mode}`,
                `UI state: ${replState}`,
                activePlanRef.current?.state ? `Plan state: ${activePlanRef.current.state}` : '',
                jobManager.running().length > 0 ? `Running background jobs: ${jobManager.running().map((job: any) => job.label ?? job.id).join(', ')}` : '',
              ].filter(Boolean).join('\n');
              const contextPreview = [streamCtx, transcriptCtx].filter(Boolean).join('\n').slice(-900);
    
              const prompt = `You are answering a /btw side question while Agon continues another task in the main window.
    
    Side question:
    ${btwQuestion}
    
    Current runtime context:
    ${runningCtx || '(none)'}
    
    ${streamCtx ? 'Recent live output from the running task:\n' + streamCtx + '\n\n' : ''}${transcriptCtx ? 'Recent transcript context:\n' + transcriptCtx + '\n\n' : ''}Answer the side question directly and briefly. Do not take over, cancel, or modify the main task.`;
    
              const btwOutputDir = join(RUNS_DIR, `btw-${Date.now()}`);
              const btwId = `btw-${Date.now()}`;
              setBtwPanel({
                id: btwId,
                question: btwQuestion,
                engineId: cesarId,
                status: 'running',
                answer: '',
                error: '',
                contextPreview,
                startedAt: Date.now(),
              });
              try { mkdirSync(btwOutputDir, { recursive: true }); } catch { /* dir already exists or parent missing */ }
              ctx.adapter.dispatch({
                engine: engineDef,
                prompt,
                cwd: resolveWorkingDir(),
                mode: 'exec' as any,
                timeout: 60,
                outputDir: btwOutputDir,
              }).then((result: any) => {
                const answer = (result.stdout || '').trim();
                if (answer) {
                  setBtwPanel((prev: any) => prev?.id === btwId ? { ...prev, status: 'done', answer } : prev);
                } else {
                  setBtwPanel((prev: any) => prev?.id === btwId ? { ...prev, status: 'empty', error: 'No response' } : prev);
                }
              }).catch((err: any) => {
                setBtwPanel((prev: any) => prev?.id === btwId ? { ...prev, status: 'error', error: err instanceof Error ? err.message : String(err) } : prev);
              });
              return;
            }
            if (!btwQuestion) {
              dispatch({ type: 'info', message: 'Usage: /btw <question>' } as any);
              return;
            }
            dispatch({ type: 'info', message: 'No active work for /btw. Ask normally without the /btw prefix.' } as any);
            return;
          }
          const isPlanAwaitingControl = activePlanRef.current?.state === 'awaiting_approval'
            && (input === '/approve' || input === '/cancel');
          if (replState !== 'idle' && !jobManager.running().length && !isPlanAwaitingControl) {
            setInputQueue((prev: string[]) => [...prev, input]);
            dispatch({ type: 'info', message: `Queued: ${input.length > 50 ? input.slice(0, 50) + '\u2026' : input}` } as any);
            return;
          }
          if (planModeQueued && input.trim() && !input.startsWith('/')) {
            setPlanModeQueued(false);
            handleSubmit(`/plan ${input}`);
            return;
          }
          const autoModeForTurn = autoModeQueued && input.trim() && !input.startsWith('/');
          if (planModeQueued) setPlanModeQueued(false);
          transition(startCommandReplState);
          dispatch({ type: 'separator' } as any);
          dispatch({ type: 'user-message', content: input } as any);
          const { text: cleanInput, images: detectedImages } = extractImagesFromInput(input, resolveWorkingDir());
          const allImages = [...pendingImages, ...detectedImages];
          let intent = detectIntent(cleanInput || input, commandRegistry);
          if (intent.type === 'status') {
            setStatusDashboardOpen(true);
            dispatch({ type: 'info', message: 'Status dashboard open. Press q or Esc to close.' } as any);
            transition(finishReplState);
            return;
          }
          const ctx = buildContext();
          (ctx as any).autoModeQueued = autoModeForTurn;
          const cesarEngineForTurn = String((ctx.config as any).cesarEngine ?? ctx.config.forgeFixedStarter ?? 'claude');
          activeTurnRef.current = (!input.startsWith('/') && mode === 'chat')
            ? { input, engineId: cesarEngineForTurn, retried: false }
            : null;
          const cb: DispatchCallbacks = {
            dispatch, ctx, commandRegistry, eventBus, loadedExtensions, setWorkspacePath,
            runAsJob: (type: string, label: string, fn: () => Promise<void>) => {
              const job = jobManager.create(type, label);
              chatStartTimeRef.current = Date.now();
              setJobList([...jobManager.list()]);
              dispatch({ type: 'info', message: `Started background job [${job.id}] ${type}: ${label || type}` } as any);
              // Transition to idle so user can submit new commands while job runs
              // Strip stays active via jobList.some(j => j.state === 'running') check
              setReplState((prev: any) => prev === 'idle' ? prev : finishReplState({ state: prev }).state);
              fn().then(() => { jobManager.complete(job.id); setJobList([...jobManager.list()]); })
                .catch((err: any) => { jobManager.fail(job.id, err instanceof Error ? err.message : String(err)); setJobList([...jobManager.list()]); dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) } as any); });
            },
            setMode, setPendingImages, setSessionEngines, setEnginePickerOpen, setModelPickerOpen, setModelPickerEntries, setModelPickerLoading, setCesarPickerOpen, setChatSession, setLastUndoToken, askQuestion, exit: () => process.exit(0),
            setModelPickerTargetEngine, setModelPickerInitialFilter, setModelPickerTitle, setModelPickerCliGroups,
            allImages, allSlashCommands: allSlashCommands, dynamicSkills: [...dynamicSkills, ...extensionSkills], mode, lastUndoToken, sessionStartTime, jobManager,
            explorationMode, setExplorationMode,
            neroMode, setNeroMode,
            setActivePlan: setActivePlanWrapped,
          };
          if (handleModeSwitch(intent.type, (intent as any).topic, (intent as any).question, cb)) {
            if (!(intent as any).input?.trim()) { transition(finishReplState); return; }
          }
          if (intent.type === 'unknown' && mode !== 'chat') {
            switch (mode) {
              case 'campfire': intent = { type: 'campfire', topic: input } as any; break;
              case 'brainstorm': intent = { type: 'brainstorm', question: input } as any; break;
              case 'tribunal': intent = { type: 'tribunal', question: input } as any; break;
            }
          }
          try {
            const result = await dispatchIntent(intent, input, cb);
            if (result.ranAsJob) return;
          } catch (err: any) { dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) } as any); }
          finally {
            if (activeTurnRef.current?.input === input) activeTurnRef.current = null;
            setReplState((prev: any) => prev === 'idle' ? prev : finishReplState({ state: prev }).state);
          }
  }, [replState,dispatch,buildContext,mode,pendingImages,jobManager,loadedExtensions,extensionSkills,commandRegistry,eventBus,planModeQueued,autoModeQueued,setPersistentAutoMode,setActivePlanWrapped,outputBlocks]);

  const handleReviewActionCb = useCallback((action:'apply'|'edit'|'reject'|'copy') => {
    if (!reviewEvent) {
      return;
    }
    const token = handleReviewAction({ type: action }, reviewEvent, dispatch);
    if (token) {
      setLastUndoToken(token);
    }
    setReviewEvent(null);
  }, [reviewEvent,dispatch]);

  const openCliModelPicker = useCallback((engineId:string) => {
          let engine: any = null;
          try { engine = registry.get(engineId); } catch { /* not found, fallback to id */ }
    
          const env = (engine?.api?.apiKeyEnv ?? '').toLowerCase();
          const baseUrl = (engine?.api?.baseUrl ?? '').toLowerCase();
          const display = (engine?.displayName ?? '').toLowerCase();
          const defaultModel = (engine?.api?.model ?? '').toLowerCase();
    
          let providerFilter = '';
          if (engineId === 'claude' || env.includes('anthropic') || baseUrl.includes('anthropic') || display.includes('anthropic')) providerFilter = 'provider:anthropic';
          else if (engineId === 'codex' || env.includes('openai') || baseUrl.includes('openai') || display.includes('openai')) providerFilter = 'provider:openai';
          else if (engineId === 'agy' || engineId === 'antigravity' || env.includes('google') || baseUrl.includes('google') || display.includes('google') || display.includes('antigravity')) providerFilter = 'provider:google';
          else if (engineId === 'openrouter' || env.includes('openrouter') || baseUrl.includes('openrouter')) providerFilter = 'provider:openrouter';
          else if (engineId === 'mistral' || display.includes('mistral')) providerFilter = 'provider:mistral';
          else if (engineId === 'qwen' || display.includes('qwen')) providerFilter = 'provider:qwen';
          else if (engineId === 'minimax' || display.includes('minimax')) providerFilter = 'provider:minimax';
          else providerFilter = defaultModel;
    
          setModelPickerTargetEngine(engineId);
          setModelPickerTitle(`Select model for ${engineId}`);
          setModelPickerInitialFilter(providerFilter);
          setModelPickerEntries([]);
          setModelPickerLoading(true);
          setEnginePickerOpen(false);
          setModelPickerOpen(true);
    
          setModelPickerCliGroups([]);
    
          import('@agon/core').then(({ fetchModelsRegistry, buildModelEntries, buildCliModelGroupsAsync }) => {
            buildCliModelGroupsAsync().then((cliGroups: any) => {
              setModelPickerCliGroups(cliGroups);
            });
            fetchModelsRegistry().then((reg: any) => {
              setModelPickerEntries(buildModelEntries(reg));
              setModelPickerLoading(false);
            }).catch((err: any) => {
              setModelPickerOpen(false);
              setModelPickerLoading(false);
              setModelPickerTargetEngine(null);
              setModelPickerInitialFilter('');
              setModelPickerTitle('Select model');
              setEnginePickerOpen(true);
              dispatch({ type: 'error', message: `Failed to fetch models: ${err.message}` } as any);
            });
          });
  }, [registry,dispatch]);

  const openResultsPager = useCallback(() => {
          let content = '';
          let tmpFile = '';
          if (mode === 'chat') {
            if (chatSession.messages.length === 0) {
              dispatch({ type: 'info', message: 'No chat messages yet.' } as any);
              return;
            }
            content = formatChatTranscript(chatSession);
            tmpFile = join(tmpdir(), `agon-chat-${Date.now()}.txt`);
          } else {
            if (!sessionResultStore.hasResults()) {
              dispatch({ type: 'info', message: 'No results yet — run /brainstorm, /campfire, /tribunal, or /forge first' } as any);
              return;
            }
            content = formatSessionResults(sessionResultStore.getResults());
            tmpFile = join(tmpdir(), `agon-results-${Date.now()}.txt`);
          }
          try {
            writeFileSync(tmpFile, content, 'utf-8');
            const pager = process.env.PAGER || 'less';
            const args = pager === 'less' ? ['-R', tmpFile] : [tmpFile];
            spawnSync(pager, args, { stdio: 'inherit' });
          } catch (err) {
            dispatch({ type: 'error', message: `Pager failed: ${err instanceof Error ? err.message : String(err)}` } as any);
          } finally {
            try { unlinkSync(tmpFile); } catch { /* temp file already cleaned up */ }
          }
  }, [dispatch,mode,chatSession]);

  const openLatestToolDetail = useCallback(() => {
    const event = findLatestToolDetailEvent(outputBlocks);
    if (!event) {
      dispatch({ type: 'info', message: 'No large tool output or approval command to open yet.' } as any);
      return;
    }
    setToolDetailEvent(event);
  }, [outputBlocks,dispatch]);

  const draftLatestFailedToolRetry = useCallback(() => {
    const event = findLatestFailedToolEvent(outputBlocks);
    if (!event) {
      dispatch({ type: 'info', message: 'No failed tool call to retry/edit yet.' } as any);
      return;
    }
    const draft = buildFailedToolRetryDraft(event);
    if (!draft) {
      dispatch({ type: 'info', message: 'No retry draft available for the latest failed tool.' } as any);
      return;
    }
    inputValueRef.current = draft;
    setInputValue(draft);
    setHistoryIndex(-1);
    dispatch({ type: 'info', message: 'Drafted failed-tool retry in the composer. Edit it, then press Enter.' } as any);
  }, [outputBlocks,dispatch]);

  const handleSlashSelect = useCallback((cmd:string) => {
    setPlanModeQueued(false);
    setSlashPickerOpen(false);
    setInputValue(cmd + ' ');
  }, []);

  const handleSlashCancel = useCallback(() => {
    setSlashPickerOpen(false);
  }, []);

  const handleQuestionAnswer = useCallback((answer:string) => {
    if (questionState) {
      questionState.resolve(answer);
      setQuestionState(null);
      setQuestionAnswer('');
    }
  }, [questionState]);

  const handleCancelOrExit = useCallback(() => {
          if (questionState) { questionState.resolve(''); setQuestionState(null); setQuestionAnswer(''); }
          if (replState !== 'idle') {
            interruptActiveRun(activeAbortRef.current ? 'Cancelled.' : 'Interrupted.', false);
            return;
          }
    
          const now = Date.now();
          if (inputValue) {
            _lastSigintAt.value = now;
            setInputValue('');
            dispatch({ type: 'info', message: 'Input cleared. Press Ctrl+C again to exit.' } as any);
            return;
          }
    
          if (now - _lastSigintAt.value < 1200) {
            process.exit(0);
          }
    
          _lastSigintAt.value = now;
          dispatch({ type: 'info', message: 'Press Ctrl+C again to exit.' } as any);
  }, [questionState,replState,inputValue,dispatch]);

  const handleComposerCtrlShortcut = useCallback((shortcut:string) => {
          nestedCtrlShortcutRef.current = { key: shortcut, at: Date.now() };
          switch (shortcut) {
            case 'b':
              ctrlKeyHandledRef.current = true;
              setExecutionRailOpen(false);
              setFileRailOpen((prev: boolean) => !prev);
              return;
            case 'c':
              ctrlKeyHandledRef.current = true;
              handleCancelOrExit();
              return;
            case 'e':
              ctrlKeyHandledRef.current = true;
              setToolOutputExpanded((prev: boolean) => !prev);
              return;
            case 'g':
            case 'i':
            case 't':
              ctrlKeyHandledRef.current = true;
              setFileRailOpen(false);
              setFileRailExpandedPath(null);
              setExecutionRailOpen((prev: boolean) => !prev);
              return;
            case 'o':
              ctrlKeyHandledRef.current = true;
              openLatestToolDetail();
              return;
            case 'l':
              ctrlKeyHandledRef.current = true;
              handleSubmit('/clear');
              return;
            case 'r':
              ctrlKeyHandledRef.current = true;
              openResultsPager();
              return;
            case 'y':
              ctrlKeyHandledRef.current = true;
              draftLatestFailedToolRetry();
              return;
            case 'j':
              ctrlKeyHandledRef.current = true;
              setInputValue((prev: string) => prev + '\n');
              return;
            default:
              return;
          }
  }, [handleCancelOrExit,handleSubmit,openLatestToolDetail,openResultsPager,draftLatestFailedToolRetry]);

  const handleKeyboardInput = useCallback((input:string,key:any) => {
          if (isTerminalFocusReport(input)) return;
          if (key?.paste) return;
    
          const keyName = typeof key?.name === 'string' ? key.name.toLowerCase() : '';
          const globalCtrlInputMap = {
            '\x01': 'a',
            '\x03': 'c',
            '\x05': 'e',
            '\x07': 'g',
            '\x0f': 'o',
            '\x0a': 'j',
            '\x0b': 'k',
            '\x0c': 'l',
            '\x12': 'r',
            '\x14': 't',
            '\x15': 'u',
            '\x17': 'w',
            '\x02': 'b',
            ...(key.ctrl ? { '\x09': 'i' } : {}),
          } as Record<string, string>;
          const globalCtrlInput = globalCtrlInputMap[input] ?? (key.ctrl && keyName ? keyName : input);
          const hasGlobalCtrlSignal = !!key.ctrl || ['\x01', '\x02', '\x03', '\x05', '\x07', '\x0a', '\x0b', '\x0c', '\x0f', '\x12', '\x14', '\x15', '\x17'].includes(input);
          if (btwPanel && (key.escape || input === '\x1b')) {
            setBtwPanel(null);
            return;
          }
          const textInputOwnsReservedShortcut = !statusDashboardOpen && !modelPickerOpen && !cesarPickerOpen && !enginePickerOpen && !reviewEvent && !toolDetailEvent && !slashPickerOpen && (!questionState || !questionState.choices);
          if (hasGlobalCtrlSignal && globalCtrlInput === 'e' && !textInputOwnsReservedShortcut) {
            const nested = nestedCtrlShortcutRef.current;
            if (nested.key === 'e' && Date.now() - nested.at < 120) {
              nestedCtrlShortcutRef.current = { key: '', at: 0 };
              return;
            }
            nestedCtrlShortcutRef.current = { key: 'e', at: Date.now() };
            ctrlKeyHandledRef.current = true;
            setToolOutputExpanded((prev: boolean) => !prev);
            return;
          }
    
          if (statusDashboardOpen && !modelPickerOpen && !cesarPickerOpen && !enginePickerOpen && !reviewEvent && !toolDetailEvent && !slashPickerOpen && !questionState) {
            if (key.escape || input === 'q' || input === 'Q' || (key.ctrl && input === '\x03')) {
              setStatusDashboardOpen(false);
              return;
            }
            if (input === 'a' || input === 'A') {
              setStatusDashboardFilter('all');
              return;
            }
            if (input === 'p' || input === 'P') {
              setStatusDashboardFilter('problem');
              return;
            }
            return;
          }
    
          // ScrollBox keyboard shortcuts (only when fullscreen owns the viewport and no modal is open).
          if (terminalMode === 'fullscreen' && !modelPickerOpen && !cesarPickerOpen && !enginePickerOpen && !reviewEvent && !toolDetailEvent && !slashPickerOpen && !questionState) {
            if (key.shift && key.name === 'pageup') {
              scrollBoxRef.current?.scrollBy(-Math.max(1, Math.floor(currentVisibleRowBudget / 2)));
              return;
            }
            if (key.shift && key.name === 'pagedown') {
              scrollBoxRef.current?.scrollBy(Math.max(1, Math.floor(currentVisibleRowBudget / 2)));
              return;
            }
            if (key.name === 'home') {
              scrollBoxRef.current?.scrollTo(0);
              return;
            }
            if (key.name === 'end') {
              scrollBoxRef.current?.scrollToBottom?.();
              return;
            }
          }
    
          const normalizedCtrlInputMap = {
            '\x01': 'a',
            '\x03': 'c',
            '\x05': 'e',
            '\x07': 'g',
            '\x0f': 'o',
            '\x0a': 'j',
            '\x0b': 'k',
            '\x0c': 'l',
            '\x12': 'r',
            '\x14': 't',
            '\x15': 'u',
            '\x17': 'w',
            '\x02': 'b',
            ...(key.ctrl ? { '\x09': 'i' } : {}),
          } as Record<string, string>;
          const normalizedCtrlInput = normalizedCtrlInputMap[input] ?? (key.ctrl && keyName ? keyName : input);
          const hasCtrlSignal = !!key.ctrl || ['\x01', '\x02', '\x03', '\x05', '\x07', '\x0a', '\x0b', '\x0c', '\x0f', '\x12', '\x14', '\x15', '\x17'].includes(input);
          if (hasCtrlSignal && normalizedCtrlInput) {
            const nested = nestedCtrlShortcutRef.current;
            if (nested.key === normalizedCtrlInput && Date.now() - nested.at < 120) {
              nestedCtrlShortcutRef.current = { key: '', at: 0 };
              return;
            }
          }
    
          const action = resolveKeyboardInput({
            input, key,
            textInputActive: !modelPickerOpen && !cesarPickerOpen && !enginePickerOpen && !reviewEvent && !toolDetailEvent && !slashPickerOpen && (!questionState || !questionState.choices),
            modelPickerOpen, cesarPickerOpen, slashPickerOpen, enginePickerOpen,
            reviewEventOpen: !!reviewEvent,
            toolDetailOpen: !!toolDetailEvent,
            questionState, replState, inputValue, inputHistory, historyIndex,
            planModeQueued, autoModeQueued, activePlanState: activePlanRef.current?.state ?? null,
            outputBlockCount: outputBlocks.length,
            commands: allSlashCommands,
            engineIds: availableEngines,
            fileRailFocused: fileRailOpen && inputValue.trim().length === 0,
            fileRailExpanded: fileRailExpandedPath !== null,
            executionRailFocused: executionRailOpen && inputValue.trim().length === 0,
          });
    
          switch (action.type) {
            case 'none': return;
            case 'exit': process.exit(0); return;
            case 'resolveChoice':
              questionState.resolve(action.choiceKey);
              setQuestionState(null); setQuestionAnswer(''); return;
            case 'cancelChoice':
              questionState.resolve('n');
              setQuestionState(null); setQuestionAnswer(''); return;
            case 'swallow': return;
            case 'ghostComplete':
              setInputValue(inputValue + action.ghost + ' ');
              return;
            case 'togglePlanQueued':
              setPlanModeQueued((prev: boolean) => !prev); return;
            case 'toggleAutoQueued':
              const nextAutoModeQueued = !autoModeQueued;
              setPlanModeQueued(false);
              setPersistentAutoMode(nextAutoModeQueued);
              dispatch({
                type: 'info',
                message: nextAutoModeQueued
                  ? 'AUTO ON by default. Plain tasks may self-escalate through Cesar. Ctrl+A toggles it off.'
                  : 'AUTO OFF by default.',
              } as any);
              return;
            case 'submit':
              handleSubmit(action.value); return;
            case 'planControl':
              // Swallow the y/n keystroke so PromptTextInput does not insert it
              // into the composer after we route the approval.
              ctrlKeyHandledRef.current = true;
              handleSubmit(action.action === 'approve' ? '/approve' : '/cancel');
              return;
            case 'toggleToolExpand':
              ctrlKeyHandledRef.current = true;
              setToolOutputExpanded((prev: boolean) => !prev); return;
            case 'openToolDetail':
              openLatestToolDetail(); return;
            case 'retryFailedTool':
              draftLatestFailedToolRetry(); return;
            case 'openResults':
              openResultsPager(); return;
            case 'toggleFileRail':
              setExecutionRailOpen(false);
              setFileRailOpen((prev: boolean) => !prev);
              return;
            case 'toggleExecutionRail':
              setFileRailOpen(false);
              setFileRailExpandedPath(null);
              setExecutionRailOpen((prev: boolean) => !prev);
              return;
            case 'fileRailSelectPrev': {
              const files = listFiles();
              const last = Math.max(0, files.length - 1);
              setFileRailSelectedIdx((i: number) => Math.max(0, Math.min(last, i) - 1));
              return;
            }
            case 'fileRailSelectNext': {
              const files = listFiles();
              const last = Math.max(0, files.length - 1);
              setFileRailSelectedIdx((i: number) => Math.min(last, Math.max(0, i) + 1));
              return;
            }
            case 'fileRailToggleExpand': {
              const files = listFiles();
              if (files.length === 0) return;
              const idx = Math.max(0, Math.min(files.length - 1, fileRailSelectedIdx));
              const target = files[idx];
              setFileRailExpandedPath((prev: string|null) => prev === target.path ? null : target.path);
              return;
            }
            case 'fileRailClose':
              setFileRailOpen(false);
              setFileRailExpandedPath(null);
              return;
            case 'executionRailClose':
              setExecutionRailOpen(false);
              return;
            case 'unqueuePlan':
              setPlanModeQueued(false); return;
            case 'unqueueAuto':
              setPersistentAutoMode(false);
              dispatch({ type: 'info', message: 'AUTO OFF by default.' } as any);
              return;
            case 'closeSlash':
              setSlashPickerOpen(false); return;
            case 'closeEnginePicker':
              setEnginePickerOpen(false); return;
            case 'cancelQuestion':
              if (questionState) { questionState.resolve(''); setQuestionState(null); setQuestionAnswer(''); }
              return;
            case 'interrupt':
              interruptActiveRun('Interrupted.', false); return;
            case 'clearInput':
              setInputValue(''); return;
            case 'insertNewline':
              setInputValue((prev: string) => prev + '\n'); return;
            case 'historySet':
              setHistoryIndex(action.index);
              // value is always a string — empty string means "return to blank composer".
              setInputValue(action.value);
              return;
            case 'cancelOrExit':
              handleCancelOrExit();
              return;
          }
  }, [modelPickerOpen,cesarPickerOpen,slashPickerOpen,enginePickerOpen,reviewEvent,toolDetailEvent,btwPanel,questionState,replState,inputValue,inputHistory,historyIndex,planModeQueued,autoModeQueued,outputBlocks,allSlashCommands,availableEngines,handleSubmit,interruptActiveRun,dispatch,openLatestToolDetail,openResultsPager,draftLatestFailedToolRetry,startupOnly,terminalMode,setPersistentAutoMode,statusDashboardOpen]);

  useEffect(() => {
          initExtensions(workspacePath, commandRegistry, registry, eventBus).then(({ extensions, skills: extSkills, systemPromptFragments }) => {
            if (extSkills.length > 0) setExtensionSkills(extSkills);
            if (systemPromptFragments.length > 0) setExtensionPromptFragments(systemPromptFragments);
            if (extensions.length > 0) setLoadedExtensions(extensions);
          }).catch((err: Error) => {
            console.warn(`[agon] extension loading failed: ${err.message}`);
          });
  }, [workspacePath]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    mouseSelectionRef.current = mouseSelection;
  }, [mouseSelection]);

  useEffect(() => {
    activePlanRef.current = activePlan;
  }, [activePlan]);

  useEffect(() => {
          if (planWatcherTimerRef.current) { clearInterval(planWatcherTimerRef.current); planWatcherTimerRef.current = null; }
          if (planWatcherDebounceTimerRef.current) { clearTimeout(planWatcherDebounceTimerRef.current); planWatcherDebounceTimerRef.current = null; }
          if (!activePlan?.id) return;
          const planId = activePlan.id;
          const planFilePath = (() => { try { return cesarPlanJsonPath(planId); } catch { return null; } })();
          planWatcherTimerRef.current = setInterval(() => {
            try {
              // Idle bail-out: free syscall, returns immediately when file hasn't
              // been written since last tick. Skips the readFileSync + JSON.parse
              // + comparison + stringify-fallback hot path that compounds as the
              // plan grows. Only the gate — the rest of the body is identical to
              // the original conservative logic so render-frequency is unchanged
              // on real updates.
              if (planFilePath) {
                try {
                  const mtimeMs = statSync(planFilePath).mtimeMs;
                  if (mtimeMs === planWatcherStatMtimeRef.current) return;
                  planWatcherStatMtimeRef.current = mtimeMs;
                } catch { /* file gone — fall through to loadCesarPlan which handles missing */ }
              }
              const loaded = loadCesarPlan(planId);
              if (!loaded) return;
              const current = activePlanRef.current;
              const loadedMs = Date.parse(String(loaded.updatedAt ?? ''));
              const currentMs = Date.parse(String(current?.updatedAt ?? ''));
              const loadedValid = Number.isFinite(loadedMs);
              const currentValid = Number.isFinite(currentMs);
              if (loadedValid && currentValid) {
                if (loadedMs <= currentMs) return;
              } else if (loadedValid === currentValid) {
                // Both missing/invalid — treat as unchanged unless structurally different
                if (JSON.stringify(loaded) === JSON.stringify(current)) return;
              }
              if (planWatcherDebounceTimerRef.current) clearTimeout(planWatcherDebounceTimerRef.current);
              planWatcherDebounceTimerRef.current = setTimeout(() => {
                const latest = activePlanRef.current;
                const latestMs = Date.parse(String(latest?.updatedAt ?? ''));
                const latestValid = Number.isFinite(latestMs);
                if (loadedValid && latestValid) {
                  if (loadedMs <= latestMs) return;
                } else if (loadedValid === latestValid) {
                  if (JSON.stringify(loaded) === JSON.stringify(latest)) return;
                }
                setActivePlanWrapped(loaded);
              }, 500);
            } catch {}
          }, 2000);
          return () => {
            if (planWatcherTimerRef.current) { clearInterval(planWatcherTimerRef.current); planWatcherTimerRef.current = null; }
            if (planWatcherDebounceTimerRef.current) { clearTimeout(planWatcherDebounceTimerRef.current); planWatcherDebounceTimerRef.current = null; }
          };
  }, [activePlan,setActivePlanWrapped]);

  useEffect(() => {
    const nextCount = nativeTranscriptBlocks.length;
    if (terminalMode !== 'native') {
      nativeTranscriptBlockCountRef.current = nextCount;
      return;
    }
    const previousCount = nativeTranscriptBlockCountRef.current;
    if (nextCount < previousCount) {
      setNativeStaticEpoch((epoch: number) => epoch + 1);
      setNativeArchiveCount(0);
    }
    nativeTranscriptBlockCountRef.current = nextCount;
  }, [terminalMode,nativeTranscriptBlocks]);

  useEffect(() => {
    if (terminalMode !== 'native') {
      return;
    }
    if (effectiveNativeArchiveCount !== nativeArchiveCount) {
      setNativeArchiveCount(effectiveNativeArchiveCount);
    }
  }, [terminalMode,effectiveNativeArchiveCount,nativeArchiveCount]);

  useEffect(() => {
    lastReviewResultRef.current = lastReviewResult;
  }, [lastReviewResult]);

  useEffect(() => {
          const interval = setInterval(() => {
            const prev = agentProgressRef.current;
            if (!prev || Object.keys(prev).length === 0) return;
            const now = Date.now();
            let changed = false;
            const next: Record<string, AgentProgressSnapshot> = {};
            for (const eid of Object.keys(prev)) {
              const snap = prev[eid];
              if (snap.completedAt && now - snap.completedAt > 5000) {
                changed = true;
                continue;
              }
              next[eid] = snap;
            }
            if (changed) {
              agentProgressRef.current = next;
              setAgentProgress(next);
            }
          }, 1000);
          return () => clearInterval(interval);
  }, []);

  useEffect(() => {
          if (!eventBus) return;
          const modes = ['brainstorm', 'forge', 'tribunal', 'campfire'] as const;
          const listeners: Array<{ mode: string; handler: () => void }> = [];
          for (const mode of modes) {
            const handler = () => {
              const result = sessionResultStore.getLatest();
              if (!result || result.type !== mode) return;
              const winner = result.winner ?? 'none';
              let summary = '';
              if (result.type === 'brainstorm' && 'bids' in result.data) {
                const winBid = (result.data as any).bids?.find((b: any) => b.engineId === winner);
                summary = winBid?.approach ?? winBid?.reasoning?.slice(0, 200) ?? (result.data as any).response?.slice(0, 200) ?? '';
              } else if (result.type === 'forge' && 'winner' in result.data) {
                summary = winner !== 'none' ? `Winner: ${winner}. Diff proposed for review.` : 'No winner — all engines failed.';
              } else if (result.type === 'tribunal' && 'verdict' in result.data) {
                summary = (result.data as any).verdict?.slice(0, 200) ?? '';
              } else if (result.type === 'campfire' && 'rounds' in result.data) {
                const rounds = (result.data as any).rounds;
                const last = rounds?.[rounds.length - 1];
                summary = last ? `${last.engineId}: ${last.content?.slice(0, 200)}` : '';
              }
              // Append to chat history so Cesar sees it on next turn
              appendMessage(chatSession, {
                role: 'engine' as any,
                engineId: `${mode}-result`,
                content: `[${mode} result] Winner: ${winner}. ${summary}`,
                timestamp: new Date().toISOString(),
              });
              // Narrate to UI
              const label = winner !== 'none' ? `${mode} complete — winner: ${winner}` : `${mode} complete`;
              dispatch({ type: 'info', message: label } as any);
            };
            eventBus.on(`post:${mode}`, handler);
            listeners.push({ mode, handler });
          }
          return () => {
            for (const listener of listeners) {
              eventBus.off(`post:${listener.mode}`, listener.handler);
            }
          };
  }, [eventBus,dispatch,chatSession]);

  useEffect(() => {
          return () => {
            if (activePlanClearTimerRef.current) {
              clearTimeout(activePlanClearTimerRef.current);
              activePlanClearTimerRef.current = null;
            }
          };
  }, []);

  useEffect(() => {
          const onResize = () => {
            setTermWidth(process.stdout.columns || 100);
            setTermHeight(process.stdout.rows || 24);
          };
          process.stdout.on('resize', onResize);
          return () => { process.stdout.off('resize', onResize); };
  }, []);

  useEffect(() => {
          try {
            const startupConfig = loadConfig();
            if ((startupConfig as any).resumePausedPlanOnStartup !== true) return;
            const MAX_RESUME_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
            const now = Date.now();
            const plans = listCesarPlans();
            const candidates = plans
              .filter((p: any) => p.state === 'paused' || p.state === 'running')
              .filter((p: any) => {
                const updatedAt = String(p.updatedAt ?? '');
                if (!updatedAt) return true; // no timestamp = assume fresh
                const ageMs = now - new Date(updatedAt).getTime();
                return !Number.isFinite(ageMs) || ageMs <= MAX_RESUME_AGE_MS;
              })
              .sort((a: any, b: any) => {
                const aTime = new Date(String(a.updatedAt ?? 0)).getTime();
                const bTime = new Date(String(b.updatedAt ?? 0)).getTime();
                return bTime - aTime;
              });
            const paused = candidates[0];
            if (!paused) return;
            const done = paused.steps.filter((s: any) => s.state === 'done').length;
            const failed = paused.steps.find((s: any) => s.state === 'failed');
            const remaining = paused.steps.length - done;
            const lines = [
              `Paused plan detected: ${paused.intent}`,
              `${done}/${paused.steps.length} steps done · ${remaining} remaining`,
            ];
            if (failed) lines.push(`Failed step: ${failed.description}${failed.result?.error ? ` — ${failed.result.error}` : ''}`);
            dispatch({ type: 'info', message: lines.join('\n') } as any);
            setQuestionState({
              prompt: 'Resume the paused plan?',
              choices: [
                { key: '1', label: 'Resume', color: '#4ade80' },
                { key: '2', label: 'Dismiss', color: '#9ca3af' },
              ],
              resolve: (answer: string) => {
                const trimmed = String(answer ?? '').trim().toLowerCase();
                if (trimmed === '1' || trimmed === 'y' || trimmed === 'resume') {
                  dispatch({ type: 'info', message: 'Resuming paused plan…' } as any);
                  handleSubmit('/plan resume');
                }
              },
            });
          } catch { /* ignore plan detection errors on startup */ }
  }, []);

  useEffect(() => {
          const initialConfig = loadConfig();
          if ((initialConfig as any).cesarAutoModePrompted === true) return;
          setQuestionState({
            prompt: 'Enable AUTO mode by default? Cesar may self-escalate plain tasks to plans; tool approval policy still applies.',
            choices: [
              { key: 'y', label: 'Always on', color: '#f97316' },
              { key: 'n', label: 'Keep off', color: '#9ca3af' },
            ],
            resolve: (answer: string) => {
              const enabled = String(answer ?? '').trim().toLowerCase() === 'y';
              setPersistentAutoMode(enabled);
              dispatch({
                type: 'info',
                message: enabled
                  ? 'AUTO is now always on. Change it anytime with /auto off or Ctrl+A.'
                  : 'AUTO is off by default. Enable it anytime with /auto on or Ctrl+A.',
              } as any);
            },
          });
  }, []);

  useEffect(() => {
          if (!process.stdin.isTTY || !process.stdout.isTTY) return;
          // Bracketed paste only. Mouse tracking is not enabled; selection belongs
          // to the terminal scrollback.
          process.stdout.write('\x1b[?2004h');
          const onResume = () => {
            process.stdout.write('\x1b[?2004h');
          };
          process.on('SIGCONT', onResume);
          return () => {
            process.off('SIGCONT', onResume);
            drainStdinBuffer();
            process.stdout.write('\x1b[?2004l');
          };
  }, []);

  useEffect(() => {
          if (telemetryPollerRef.current) {
            telemetryPollerRef.current.stop();
            telemetryPollerRef.current = null;
          }
          const poller = createTelemetryPoller({
            registry,
            probe: async (id: string) => probeEngineVitals(registry, id, _cesarSessionRef.session, activeEnginePidsRef.current),
            intervalMs: 5000,
            stallThresholdMs: 30000,
            probeTimeoutMs: 2500,
            activeEngineIds: activeEngines,
            autoFallback: 'auto',
            onAutoFallback: async (from: string, to: string, reason: string) => {
              const activeTurn = activeTurnRef.current;
              const retryActiveTurn = !!(activeTurn && !activeTurn.retried && activeTurn.engineId === from && activeTurn.input);
              if (retryActiveTurn && activeTurn) {
                activeTurn.retried = true;
              }
              const plan = activePlanRef.current;
              const runningStep = plan?.state === 'running' && Array.isArray(plan?.steps)
                ? plan.steps.find((step: any) => String(step?.state ?? '') === 'running')
                : null;
              const stepEngines = runningStep
                ? [runningStep.engine, ...(Array.isArray(runningStep.engines) ? runningStep.engines : [])].filter((id: any) => typeof id === 'string' && id.trim())
                : [];
              const retryActivePlan = !!(runningStep && !((plan as any).fallbackRetriesUsed?.[runningStep.id]) && (stepEngines.length === 0 || stepEngines.includes(from)));
              setRecentFallbacks((prev: any[]) => [...prev.slice(-7), { from, to, reason, at: Date.now() }]);
              if (!retryActivePlan && !retryActiveTurn) {
                dispatch({ type: 'warning', message: `Telemetry: ${from} stalled (${reason}); keeping Cesar unchanged.` } as any);
                return false;
              }
    
              configSet('cesarEngine' as any, to as any);
              setConfigVersion((v: number) => v + 1);
              if (cesarSession) {
                cesarSession.close();
                setCesarSessionWrapped(null);
              }
              if (retryActivePlan) {
                if (activeAbortRef.current) activeAbortRef.current.abort();
                dispatch({ type: 'warning', message: `Telemetry: ${from} stalled during plan step — switched to ${to} and retrying that step (${reason})` } as any);
              } else if (retryActiveTurn && activeTurn) {
                if (activeAbortRef.current) activeAbortRef.current.abort();
                setInputQueue((prev: string[]) => [...prev, activeTurn.input]);
                dispatch({ type: 'warning', message: `Telemetry: ${from} stalled — switched to ${to} and retrying this prompt (${reason})` } as any);
              } else {
                dispatch({ type: 'warning', message: `Telemetry: ${from} stalled — auto-fallback to ${to} (${reason})` } as any);
              }
              return true;
            },
          });
          poller.start();
          telemetryPollerRef.current = poller;
          const unsub = poller.subscribe((snapshot: Map<string, EngineVitals>) => {
            setTelemetryVitals(new Map(snapshot));
          });
          return () => {
            unsub();
            poller.stop();
            telemetryPollerRef.current = null;
          };
  }, [registry,cesarSession,activeEngines]);

  useEffect(() => {
          if (replState === 'idle' && inputQueue.length > 0) {
            const next = inputQueue[0];
            setInputQueue((prev: string[]) => prev.slice(1));
            setTimeout(() => handleSubmit(next), 50);
          }
  }, [replState,inputQueue]);

  useEffect(() => {
    inputValueRef.current = inputValue;
  }, [inputValue]);

  useEffect(() => {
          _cancelCallback.fn = () => {
            for (const abort of _activeAborts) abort.abort();
            _activeAborts.clear();
            activeAbortRef.current = null;
            setActiveAbort(null);
            setLiveSpinner(null);
            setLiveProgress(null);
            // Commit any in-flight streams before wiping — see interruptActiveRun.
            outputActions.flushStream();
            agentProgressRef.current = {};
            setAgentProgress({});
            clearPermissionQueue();
            clearThinkingBuffer();
            setQuestionState(null);
            setQuestionAnswer('');
            setPendingPlanProposal(null);
            setSlashPickerOpen(false);
            setEnginePickerOpen(false);
            setModelPickerOpen(false);
            setCesarPickerOpen(false);
            setReviewEvent(null);
            setToolDetailEvent(null);
            const pendingPlan = activePlanRef.current;
            if (pendingPlan && ['planning', 'awaiting_approval'].includes(String(pendingPlan.state ?? ''))) {
              try { saveCesarPlan(cancelCesarPlan(pendingPlan)); } catch (_err) {}
              activePlanRef.current = null;
              setActivePlan(null);
            }
            setReplState((prev: any) => prev === 'idle' ? prev : finishReplState({ state: prev }).state);
          };
  }, [setActiveAbort,outputActions]);

        useStableInput(handleKeyboardInput);
        const showExecutionRail = executionRailOpen;
        const showFileRail = fileRailOpen && !showExecutionRail;
        const fileRailFiles = useMemo(() => listFiles(), [fileRailVersion]);
        const sideRailWidth = fileRailWidthForTerminal(termWidth, true);
        const sideRailMaxRows = fileRailMaxRowsForTerminal(termHeight, terminalMode, true);
        // Stable element array — without useMemo, every keystroke rebuilds N
        // React elements even though `displayRows` only changes on stream/mode.
        // ScrollBox also does React.Children.toArray on children; a stable ref
        // lets its internal memo bail too.
        const transcriptElements = useMemo(
          () => displayRows.map((row: any) => <TranscriptRowView key={row.key} row={row} />),
          [displayRows],
        );
        const nativeLiveTranscriptElements = useMemo(
          () => nativeLiveRows.map((row: any) => <TranscriptRowView key={row.key} row={row} />),
          [nativeLiveRows],
        );
        const lowerPanel = (
        <Box flexDirection="column" flexShrink={0}>
          <ChromeBar mode={mode} cwdLabel={workspacePath.split('/').pop() ?? ''} engineCount={availableEngines.length} replState={replState} runningJobs={runningJobs} planModeQueued={planModeQueued} autoModeQueued={autoModeQueued} activePlanState={activePlan?.state ?? null} activePlan={activePlan} />
          <TodoList todos={todos} />
          <BackgroundJobRail jobs={runningJobs} />
          {startupUseDashboardView && (displayRows.length === 0 || terminalMode === 'native') && (
            <Box flexDirection="column">
              <DashboardView event={outputBlocks[0]?.event as any} />
            </Box>
          )}
          {terminalMode === 'native' && startupOnly && !startupUseDashboardView && (
            <Box flexDirection="column">
              {transcriptElements}
            </Box>
          )}
          {terminalMode === 'native' && !startupOnly && nativeLiveTranscriptElements.length > 0 && (
            <Box flexDirection="column">
              {nativeLiveTranscriptElements}
            </Box>
          )}
          {livePaneVisible && (
            <>
              <StreamingView streamingText={activeStream} mode={mode} liveProgress={liveProgress} liveToolStreams={liveToolStreams} />
              {Object.keys(agentProgress).length > 0 && (
                <Box flexDirection="column">
                  {Object.values(agentProgress).map((snap: AgentProgressSnapshot) => (
                    <AgentProgressView
                      key={snap.engineId}
                      engineId={snap.engineId}
                      turnIndex={snap.turnIndex}
                      phase={snap.phase}
                      userPrompt={snap.userPrompt}
                      toolCalls={snap.toolCalls}
                      lastTool={snap.lastTool}
                      lastToolStatus={snap.lastToolStatus}
                      tokensUsed={snap.tokensUsed}
                      elapsedMs={snap.elapsedMs}
                      turnsRemaining={snap.turnsRemaining}
                      maxTurns={snap.maxTurns}
                      tokensRemaining={snap.tokensRemaining}
                      maxTokens={snap.maxTokens}
                      error={snap.error}
                    />
                  ))}
                </Box>
              )}
            </>
          )}
          {pendingPlanProposal && (
            <PlanProposalView
              plan={(pendingPlanProposal as any).plan}
              markdown={(pendingPlanProposal as any).markdown}
            />
          )}
          {btwPanel && (
            <Box flexDirection="column" borderStyle="round" borderColor="#22d3ee" paddingX={1} marginY={1}>
              <Box justifyContent="space-between">
                <Text bold color="#22d3ee">{'BTW'}</Text>
                <Text dimColor>{btwPanel.status === 'running' ? `${btwPanel.engineId} thinking…` : 'Esc close'}</Text>
              </Box>
              <Text dimColor>{btwPanel.question}</Text>
              {btwPanel.contextPreview && (
                <Text dimColor>{'Context: '}{String(btwPanel.contextPreview).split('\n').filter((line: string) => line.trim()).slice(-2).join(' / ').slice(0, Math.max(40, termWidth - 16))}</Text>
              )}
              {btwPanel.status === 'running' ? (
                <Text color="#fbbf24">{'Answering in a side channel; main work continues.'}</Text>
              ) : btwPanel.error ? (
                <Text color="#ef4444">{btwPanel.error}</Text>
              ) : (
                <Box flexDirection="column">
                  {String(btwPanel.answer ?? '').split('\n').slice(0, 8).map((line: string, i: number) => (
                    <Text key={i}>{line}</Text>
                  ))}
                </Box>
              )}
            </Box>
          )}
          {toolDetailView && (
            <ToolDetailBlock
              title={toolDetailView.title}
              subtitle={toolDetailView.subtitle}
              accentColor={toolDetailView.accentColor}
              rows={toolDetailView.rows}
              maxVisibleRows={toolDetailViewportRows(termHeight)}
              onClose={() => setToolDetailEvent(null)}
            />
          )}
          {reviewEvent && <ReviewBlock event={reviewEvent} onAction={handleReviewActionCb} />}
          {enginePickerOpen && (
            <EnginePicker available={availableEngines} initialSelected={sessionEngines ?? registry.activeIds(config as any)}
              userEngines={new Set(registry.list().filter((e: any) => e.tier === 'user').map((e: any) => e.id))}
              modelOverrides={(config as any).engineModels ?? {}}
              onConfirm={(selected: string[]) => { setEnginePickerOpen(false); setSessionEngines(selected); configSet('engineActivationMode' as any, 'explicit' as any); configSet('forgeEnabledEngines', selected); setConfigVersion((v: number) => v + 1); dispatch({ type: 'success', message: `Active engines: ${selected.join(', ')}` } as any); }}
              onCancel={() => setEnginePickerOpen(false)}
              onRemove={(engineId: string) => {
                const engPath = join(getAgonHome(), 'engines', `${engineId}.json`);
                try { unlinkSync(engPath); } catch (_e) {}
                const nextModels = { ...((loadConfig() as any).engineModels ?? {}) };
                delete nextModels[engineId];
                configSet('engineModels', nextModels as any);
                const cfg = loadConfig() as any;
                const hidden = new Set(cfg.hiddenEngines ?? []);
                hidden.add(engineId);
                configSet('hiddenEngines', [...hidden] as any);
                const selected = (cfg.forgeEnabledEngines ?? []).filter((id: string) => id !== engineId);
                configSet('forgeEnabledEngines', selected as any);
                setConfigVersion((v: number) => v + 1);
                registry.unregister(engineId);
                registry.clearBinaryCache(engineId);
                setRegistryVersion((v: number) => v + 1);
                setSessionEngines((prev: string[]|null) => prev ? prev.filter((id: string) => id !== engineId) : null);
                dispatch({ type: 'success', message: `Removed from Agon: ${engineId}. Restore with /engines restore ${engineId}.` } as any);
              }}
              onSetModel={(engineId: string, model: string | null) => {
                const nextModels = { ...((loadConfig() as any).engineModels ?? {}) };
                if (model) nextModels[engineId] = model;
                else delete nextModels[engineId];
                configSet('engineModels', nextModels as any);
                setConfigVersion((v: number) => v + 1);
                dispatch({ type: 'success', message: model ? `Model override set: ${engineId} → ${model}` : `Model override cleared: ${engineId}` } as any);
              }}
              onBrowseModel={(engineId: string) => openCliModelPicker(engineId)} />
          )}
          {modelPickerOpen && (
            <ModelPicker entries={modelPickerEntries} loading={modelPickerLoading} initialFilter={modelPickerInitialFilter} title={modelPickerTitle} cliGroups={modelPickerCliGroups}
              activeEngineIds={activeEngines()}
              onToggleCliEngine={(engineId: string, active: boolean) => {
                const current = sessionEngines ?? registry.activeIds(config as any);
                const next = active
                  ? Array.from(new Set([...current, engineId]))
                  : current.filter((id: string) => id !== engineId);
                if (next.length === 0) {
                  dispatch({ type: 'warning', message: 'Keep at least one engine active.' } as any);
                  return;
                }
                setSessionEngines(next);
                const cfg = loadConfig() as any;
                const hidden = new Set(cfg.hiddenEngines ?? []);
                if (active) hidden.delete(engineId);
                else hidden.add(engineId);
                configSet('engineActivationMode' as any, 'explicit' as any);
                configSet('forgeEnabledEngines', next as any);
                configSet('hiddenEngines', [...hidden] as any);
                setConfigVersion((v: number) => v + 1);
                dispatch({ type: 'success', message: `${active ? 'Activated' : 'Deactivated'} CLI engine: ${engineId}` } as any);
              }}
              onSelect={(entry: any) => {
                if (modelPickerTargetEngine) {
                  const nextModels = { ...((loadConfig() as any).engineModels ?? {}) };
                  nextModels[modelPickerTargetEngine] = entry.modelId;
                  configSet('engineModels', nextModels as any);
                  setConfigVersion((v: number) => v + 1);
                  dispatch({ type: 'success', message: `Model override set: ${modelPickerTargetEngine} → ${entry.modelId}` } as any);
                  setModelPickerTargetEngine(null);
                  setModelPickerInitialFilter('');
                  setModelPickerTitle('Select model');
                  setModelPickerOpen(false);
                  setEnginePickerOpen(true);
                  return;
                }
                // CLI-sourced entry (no baseUrl): set model override on matching engine
                if (!entry.baseUrl) {
                  const engineId = entry.providerId;
                  const nextModels = { ...((loadConfig() as any).engineModels ?? {}) };
                  nextModels[engineId] = entry.modelId;
                  configSet('engineModels', nextModels as any);
                  setConfigVersion((v: number) => v + 1);
                  setModelPickerOpen(false);
                  dispatch({ type: 'success', message: `CLI model set: ${engineId} → ${entry.modelId}` } as any);
                  return;
                }
                setModelPickerOpen(false);
                const def = modelEntryToEngineDef(entry);
                const dir = join(getAgonHome(), 'engines');
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, `${def.id}.json`), JSON.stringify(def, null, 2) + '\n');
                registry.register(def as any);
                const nextSelected = Array.from(new Set([...(sessionEngines ?? registry.activeIds(config as any)), def.id]));
                const cfg = loadConfig() as any;
                const hidden = new Set(cfg.hiddenEngines ?? []);
                hidden.delete(def.id);
                setSessionEngines(nextSelected);
                configSet('engineActivationMode' as any, 'explicit' as any);
                configSet('forgeEnabledEngines', nextSelected as any);
                configSet('hiddenEngines', [...hidden] as any);
                setRegistryVersion((v: number) => v + 1);
                setConfigVersion((v: number) => v + 1);
                dispatch({ type: 'success', message: `Added: ${entry.providerName} \u2014 ${entry.modelName}` } as any);
              }}
              onCancel={() => {
                const hadTarget = !!modelPickerTargetEngine;
                setModelPickerOpen(false);
                setModelPickerTargetEngine(null);
                setModelPickerInitialFilter('');
                setModelPickerTitle('Select model');
                if (hadTarget) setEnginePickerOpen(true);
              }} />
          )}
          {cesarPickerOpen && (
            <CesarPicker
              engines={availableEngines}
              currentCesar={(config as any).cesarEngine ?? config.forgeFixedStarter ?? 'claude'}
              onSelect={(engineId: string) => {
                setCesarPickerOpen(false);
                configSet('cesarEngine', engineId);
                setConfigVersion((v: number) => v + 1);
                if (cesarSession) { cesarSession.close(); setCesarSession(null); }
                dispatch({ type: 'success', message: `Cesar brain set to: ${engineId}` } as any);
                dispatch({ type: 'info', message: 'Conversation context + memory preserved.' } as any);
              }}
              onCancel={() => setCesarPickerOpen(false)} />
          )}
          {liveSpinner && mode !== 'chat' && <SpinnerBlock message={liveSpinner.message} color={liveSpinner.color} />}
          {!enginePickerOpen && !modelPickerOpen && !cesarPickerOpen && (
            <Box flexDirection="column" paddingX={1} marginTop={1}>
              {pendingImages.length > 0 && (<Box><Text color="#22d3ee">{icons().image + ' '}</Text>{pendingImages.map((img: any, i: number) => (<Text key={i} dimColor>{img.filename}{i < pendingImages.length - 1 ? ', ' : ''}</Text>))}</Box>)}
              {inputQueue.length > 0 && (<Box><Text dimColor>{icons().queue + ' '}{inputQueue.length} queued: </Text><Text dimColor italic>{inputQueue[0].length > 40 ? inputQueue[0].slice(0, 40) + '…' : inputQueue[0]}</Text></Box>)}
              {liveSpinner && mode === 'chat' && !questionState && (
                <Box paddingLeft={1}>
                  <Text color="#fbbf24">{liveSpinner.message}</Text>
                </Box>
              )}
              {statusDashboardOpen ? (
                <StatusDashboard telemetryVitals={telemetryVitals} recentFallbacks={recentFallbacks} width={termWidth} height={termHeight} filter={statusDashboardFilter} />
              ) : (
                <ComposerView
                  mode={mode}
                  replState={replState}
                  planModeQueued={planModeQueued}
                  autoModeQueued={autoModeQueued}
                  activePlanState={activePlan?.state ?? null}
                  slashPickerOpen={slashPickerOpen}
                  inputValue={inputValue}
                  handleInputChange={handleInputChange}
                  handlePasteInput={handlePasteInput}
                  handleSubmit={handleSubmit}
                  allSlashCommands={allSlashCommands}
                  availableEngines={availableEngines}
                  onSlashSelect={handleSlashSelect}
                  onSlashCancel={handleSlashCancel}
                  questionState={questionState}
                  questionAnswer={questionAnswer}
                  onQuestionAnswerChange={setQuestionAnswer}
                  onQuestionAnswerSubmit={handleQuestionAnswer}
                  termWidth={termWidth}
                  termHeight={termHeight}
                  onCtrlShortcut={handleComposerCtrlShortcut} />
              )}
              {(() => {
                const _cesarId = (config as any).cesarEngine ?? config.forgeFixedStarter ?? 'claude';
                return (<>
                  <CesarStatusStrip cesarId={_cesarId} confidence={cesarConfidence} spinner={liveSpinner} engines={liveProgress} jobs={runningJobs} startTime={chatStartTimeRef.current || 0} streamSnippet={streamSnippet} isActive={replState !== 'idle' || runningJobs.length > 0} planModeQueued={planModeQueued} autoModeQueued={autoModeQueued} activePlanState={activePlan?.state ?? null} activePlan={activePlan} scoreboard={null} rationale={null} />
                  {mode === 'chat' && <StatusBar cesarId={statusStats.cesarId} chatMessageCount={statusStats.chatMessageCount} totalTokens={statusStats.totalTokens} totalCostUsd={statusStats.totalCostUsd} cwd={statusCwd} branch={statusBranch} explorationMode={explorationMode} toolOutputExpanded={toolOutputExpanded} autoModeQueued={autoModeQueued} isActive={replState !== 'idle'} fullscreenEnabled={terminalMode === 'fullscreen'} telemetryVitals={telemetryVitals} />}
                </>);
              })()}
            </Box>
          )}
        </Box>
        );
  
        if (terminalMode === 'native') return (
        <>
          <Static key={`native-static-${nativeStaticEpoch}`} items={nativeArchiveBlocks}>
            {(block: any) => (
              <OutputBlockView key={block.id} event={block.event} mode={mode} toolOutputExpanded={toolOutputExpanded} thinkingExpanded={thinkingExpanded} />
            )}
          </Static>
          <Box flexDirection="row" width={termWidth}>
            <Box flexDirection="column" flexGrow={1} minWidth={0} overflowX="hidden">
              {lowerPanel}
            </Box>
            {showFileRail && (
              <FileRail files={fileRailFiles} maxRows={sideRailMaxRows} width={sideRailWidth} focused={fileRailOpen && inputValue.trim().length === 0} selectedIndex={fileRailSelectedIdx} expandedPath={fileRailExpandedPath} autoExpandSelected={fileRailOpen && inputValue.trim().length === 0} />
            )}
            {showExecutionRail && (
              <ExecutionRailPanel
                spinner={liveSpinner}
                engines={liveProgress}
                activePlanState={activePlan?.state ?? null}
                activePlan={activePlan}
                lastTool={latestToolEvent}
                recentFallbacks={recentFallbacks}
                stats={executionRailStats}
                toolOutputExpanded={toolOutputExpanded}
                startTime={chatStartTimeRef.current || 0}
                isActive={replState !== 'idle' || runningJobs.length > 0}
                width={sideRailWidth}
                maxRows={sideRailMaxRows}
                focused={executionRailOpen && inputValue.trim().length === 0}
              />
            )}
          </Box>
        </>
        );
  
        return (
        <AlternateScreen>
        <Box flexDirection="column" flexGrow={1} width={termWidth} height={termHeight}>
        <Box flexDirection="row" flexGrow={1} width="100%">
        <Box flexDirection="column" flexGrow={1} minWidth={0} overflowX="hidden">
        <ScrollBox ref={scrollBoxRef} stickyScroll flexGrow={1}>
          {transcriptElements}
        </ScrollBox>
        {lowerPanel}
        </Box>
        {showFileRail && (
          <FileRail files={fileRailFiles} maxRows={sideRailMaxRows} width={sideRailWidth} focused={fileRailOpen && inputValue.trim().length === 0} selectedIndex={fileRailSelectedIdx} expandedPath={fileRailExpandedPath} autoExpandSelected={fileRailOpen && inputValue.trim().length === 0} />
        )}
        {showExecutionRail && (
          <ExecutionRailPanel
            spinner={liveSpinner}
            engines={liveProgress}
            activePlanState={activePlan?.state ?? null}
            activePlan={activePlan}
            lastTool={latestToolEvent}
            recentFallbacks={recentFallbacks}
            stats={executionRailStats}
            toolOutputExpanded={toolOutputExpanded}
            startTime={chatStartTimeRef.current || 0}
            isActive={replState !== 'idle' || runningJobs.length > 0}
            width={sideRailWidth}
            maxRows={sideRailMaxRows}
            focused={executionRailOpen && inputValue.trim().length === 0}
          />
        )}
        </Box>
        </Box>
        </AlternateScreen>
        );
}


// @kern-source: app:2102
export async function startRepl(): Promise<void> {
  ensureAgonHome();
  ensureCurrentWorkspace(process.cwd());
  process.on('SIGINT', () => {
    const now = Date.now();
    if (now - _lastSigintAt.value < 1200) {
      if (_cesarSessionRef.session) { try { _cesarSessionRef.session.close(); } catch { /* session already closed or errored */ } _cesarSessionRef.session = null; }
      process.exit(0);
    }
    if (_pauseState.value?.active) {
      // Second Ctrl+C during pause — hard cancel
      _pauseState.value = dismissPauseState();
      for (const abort of _activeAborts) abort.abort();
      _activeAborts.clear();
      _lastSigintAt.value = now;
      if (_cancelCallback.fn) _cancelCallback.fn();
      return;
    }
    if (_activeAborts.size > 0) {
      // First Ctrl+C — enter pause state instead of immediate abort
      _pauseState.value = createPauseState();
      _lastSigintAt.value = now;
      return;
    }
    _lastSigintAt.value = now;
  });
  if (process.stdout.isTTY) {
    process.on('exit', () => {
      try { drainStdinBuffer(); } catch { /* stdout gone */ }
    });
  }
  render(<App />, { exitOnCtrlC: false });
}

