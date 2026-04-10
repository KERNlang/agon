// @kern-source: app:4
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';

// @kern-source: app:5
import { Box, Text, render, useApp, useInput } from 'ink';

// @kern-source: app:6
import TextInput from 'ink-text-input';

// @kern-source: app:7
import { EngineRegistry, loadConfig, ensureAgonHome, ensureCurrentWorkspace, startChatSession, getRatings, getActiveWorkspace, RUNS_DIR, extractImagesFromInput, resolveWorkingDir, currentBranch, configSet, createCesarMemory, modelEntryToEngineDef, appendMessage } from '@agon/core';

// @kern-source: app:8
import type { Plan, ChatSession, Skill, PersistentSession, ImageAttachment } from '@agon/core';

// @kern-source: app:9
import type { EngineProgress } from '../../handlers/types.js';

// @kern-source: app:10
import { createCliAdapter } from '@agon/adapter-cli';

// @kern-source: app:11
import type { EngineAdapter } from '@agon/core';

// @kern-source: app:12
import { detectIntent, SLASH_COMMANDS } from '../signals/intent.js';

// @kern-source: app:13
import { CommandRegistry, registerBuiltinCommands, initExtensions, EventBus, bridgeShellHooks } from '@agon/core';

// @kern-source: app:14
import { JobManager } from '../signals/job-manager.js';

// @kern-source: app:15
import type { Job } from '../signals/job-manager.js';

// @kern-source: app:16
import { ENGINE_COLORS } from '../blocks/output-format.js';

// @kern-source: app:17
import { icons } from '../signals/icons.js';

// @kern-source: app:18
import { parseMarkdownBlocks, cleanEngineOutput } from '../blocks/markdown.js';

// @kern-source: app:19
import type { OutputEvent, HandlerContext } from '../../handlers/types.js';

// @kern-source: app:20
import { codeBlockBuffer } from '../../code-buffer.js';

// @kern-source: app:21
import { getGhostCompletion } from '../signals/ghost-text.js';

// @kern-source: app:22
import { startCommandReplState, finishReplState, cancelReplState } from '../signals/app-state.js';

// @kern-source: app:23
import type { ReplStateState } from '../signals/app-state.js';

// @kern-source: app:24
import { processPasteContent, expandPastePlaceholders } from '../signals/paste-handler.js';

// @kern-source: app:25
import { dispatchIntent, handleModeSwitch } from '../signals/dispatch.js';

// @kern-source: app:26
import type { DispatchCallbacks } from '../signals/dispatch.js';

// @kern-source: app:27
import { handleOutputEvent, clearPermissionQueue } from '../signals/output.js';

// @kern-source: app:28
import type { OutputActions, OutputState } from '../signals/output.js';

// @kern-source: app:29
import { cleanInputValue, cleanSubmitValue, findInputChange, navigateHistory, resolveEscapeAction, shouldQueuePlanModeOnTab } from '../signals/app-input.js';

// @kern-source: app:30
import { handleReviewAction } from '../blocks/review.js';

// @kern-source: app:31
import { SpinnerBlock, EngineProgressView, StatusBar, CesarStatusStrip, OutputBlockView, ToolCallGroup, SlashPicker, EnginePicker, ModelPicker, ReviewBlock, BackgroundJobRail, RenderedSegments, CesarPicker, contentWidth, engineColor } from '../../components.js';

// @kern-source: app:32
import type { OutputBlock, ReviewEvent } from '../../components.js';

// @kern-source: app:33
import { join, dirname } from 'node:path';

// @kern-source: app:34
import { fileURLToPath } from 'node:url';

// @kern-source: app:35
import { readdirSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';

// @kern-source: app:36
import { homedir, tmpdir } from 'node:os';

// @kern-source: app:37
import { spawnSync } from 'node:child_process';

// @kern-source: app:38
import { sessionResultStore } from '../models/session-results.js';

// @kern-source: app:39
import { formatSessionResults, formatChatTranscript } from '../blocks/results-formatter.js';

// @kern-source: app:40
import { loadSkills } from '@agon/core';

// @kern-source: app:43
export const _activeAborts: Set<AbortController> = new Set<AbortController>();

// @kern-source: app:46
export const _cancelCallback: { fn: (() => void) | null } = { fn: null };

// @kern-source: app:49
export const _cesarSessionRef: { session: PersistentSession | null } = { session: null };

// @kern-source: app:52

export function App({  }: {  }) {
  const [replState, setReplState] = useState<ReplStateState>('idle');
  const [outputBlocks, setOutputBlocks] = useState<OutputBlock[]>([]);
  const [inputValue, setInputValue] = useState<string>('');
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [inputQueue, setInputQueue] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [mode, setMode] = useState<'chat'|'campfire'|'brainstorm'|'tribunal'>('chat');
  const [sessionStartTime, setSessionStartTime] = useState<number>(Date.now());
  const [liveSpinner, setLiveSpinner] = useState<any>(null);
  const [liveProgress, setLiveProgress] = useState<EngineProgress[]|null>(null);
  const [slashPickerOpen, setSlashPickerOpen] = useState<boolean>(false);
  const [inputKey, setInputKey] = useState<number>(0);
  const [questionState, setQuestionState] = useState<any>(null);
  const [questionAnswer, setQuestionAnswer] = useState<string>('');
  const [enginePickerOpen, setEnginePickerOpen] = useState<boolean>(false);
  const [modelPickerOpen, setModelPickerOpen] = useState<boolean>(false);
  const [modelPickerEntries, setModelPickerEntries] = useState<any[]>([]);
  const [modelPickerLoading, setModelPickerLoading] = useState<boolean>(false);
  const [modelPickerInitialFilter, setModelPickerInitialFilter] = useState<string>('');
  const [modelPickerTitle, setModelPickerTitle] = useState<string>('Select model');
  const [modelPickerTargetEngine, setModelPickerTargetEngine] = useState<string|null>(null);
  const [cesarPickerOpen, setCesarPickerOpen] = useState<boolean>(false);
  const [streamingText, setStreamingText] = useState<any>(null);
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [reviewEvent, setReviewEvent] = useState<ReviewEvent|null>(null);
  const [jobManager, setJobManager] = useState<any>(new JobManager());
  const [jobList, setJobList] = useState<Job[]>([]);
  const [lastUndoToken, setLastUndoToken] = useState<string|null>(null);
  const [sessionEngines, setSessionEngines] = useState<string[]|null>(() => { const cfg = loadConfig(); const saved = cfg.forgeEnabledEngines; return saved && saved.length > 0 ? saved : null; });
  const [currentPlan, setCurrentPlan] = useState<Plan|null>(null);
  const [activePlan, setActivePlan] = useState<any>(null);
  const [chatSession, setChatSession] = useState<ChatSession>(() => { const cwd = resolveWorkingDir(); let branch = 'unknown'; try { branch = currentBranch(cwd); } catch { /* git not available or not a repo */ } return startChatSession({ cwd, branch }); });
  const [activeAbort, setActiveAbort] = useState<AbortController|null>(null);
  const [cesarSession, setCesarSession] = useState<PersistentSession|null>(null);
  const [explorationMode, setExplorationMode] = useState<boolean>(false);
  const [neroMode, setNeroMode] = useState<boolean>(false);
  const [toolOutputExpanded, setToolOutputExpanded] = useState<boolean>(false);
  const [thinkingExpanded, setThinkingExpanded] = useState<boolean>(true);
  const [cesarConfidence, setCesarConfidence] = useState<number|null>(null);
  const [planModeQueued, setPlanModeQueued] = useState<boolean>(false);
  const [cesarMemory, setCesarMemory] = useState<any>(() => createCesarMemory());
  const [sessionMcpServers, setSessionMcpServers] = useState<Array<Record<string,unknown>>>([]);
  const [registry, setRegistry] = useState<EngineRegistry>((() => { const reg = new EngineRegistry(); const engDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../engines'); reg.load(engDir); return reg; })());
  const [adapter, setAdapter] = useState<EngineAdapter>(createCliAdapter(registry));
  const [dynamicSkills, setDynamicSkills] = useState<Skill[]>(() => loadSkills(resolveWorkingDir()));
  const [commandRegistry, setCommandRegistry] = useState<any>((() => { const reg = new CommandRegistry(); registerBuiltinCommands(reg); return reg; })());
  const [eventBus, setEventBus] = useState<any>((() => { const bus = new EventBus(); const cfg = loadConfig(); if (cfg.hooks) bridgeShellHooks(bus, cfg.hooks); return bus; })());
  const [extensionSkills, setExtensionSkills] = useState<Skill[]>([]);
  const [extensionPromptFragments, setExtensionPromptFragments] = useState<string[]>([]);
  const [loadedExtensions, setLoadedExtensions] = useState<any[]>([]);
  const [workspacePath, setWorkspacePath] = useState<string>(resolveWorkingDir());
  const [termWidth, setTermWidth] = useState<number>(process.stdout.columns || 100);
  const [scrollOffset, setScrollOffset] = useState<number>(0);
  const chatStartTimeRef = useRef<number>(0);
  const currentPlanRef = useRef<Plan|null>(null);
  const streamingTextRef = useRef<any>(null);
  const streamingBufferRef = useRef<any>(null);
  const streamingFlushTimerRef = useRef<any>(null);
  const modeRef = useRef<'chat'|'campfire'|'brainstorm'|'tribunal'>('chat');
  const ctrlKeyHandledRef = useRef<boolean>(false);
  const justPastedRef = useRef<boolean>(false);
  const pasteHashesRef = useRef<Map<string,string>>(new Map());
  const pasteCountRef = useRef<number>(0);
  const activeAbortRef = useRef<AbortController|null>(null);
  const lastActivityTimeRef = useRef<number>(Date.now());

  const allSlashCommands = useMemo(() => {
          const registryCmds = commandRegistry.listForHelp();
          const skillCmds = [...dynamicSkills, ...extensionSkills].map((s: any) => ({ cmd: s.trigger, desc: s.description || s.name }));
          // Dedupe: registry already has builtins, skills add on top
          const seen = new Set(registryCmds.map((c: any) => c.cmd));
          const uniqueSkills = skillCmds.filter((s: any) => !seen.has(s.cmd));
          return [...registryCmds, ...uniqueSkills];
  }, [dynamicSkills, extensionSkills, commandRegistry]);

  const outputActions = useMemo(() => {
          return {
            setLiveSpinner,
            setLiveProgress,
            setStreamingText: (val: any) => {
              streamingBufferRef.current = val;
              if (modeRef.current !== 'chat') {
                if (streamingFlushTimerRef.current) {
                  clearTimeout(streamingFlushTimerRef.current);
                  streamingFlushTimerRef.current = null;
                }
                streamingTextRef.current = val;
                setStreamingText(val);
                return;
              }
              if (!val) {
                if (streamingFlushTimerRef.current) {
                  clearTimeout(streamingFlushTimerRef.current);
                  streamingFlushTimerRef.current = null;
                }
                streamingTextRef.current = null;
                setStreamingText(null);
                return;
              }
              const needsImmediatePaint = !streamingTextRef.current || streamingTextRef.current.engineId !== val.engineId;
              if (needsImmediatePaint) {
                if (streamingFlushTimerRef.current) {
                  clearTimeout(streamingFlushTimerRef.current);
                  streamingFlushTimerRef.current = null;
                }
                streamingTextRef.current = val;
                setStreamingText(val);
                return;
              }
              if (streamingFlushTimerRef.current) return;
              streamingFlushTimerRef.current = setTimeout(() => {
                streamingFlushTimerRef.current = null;
                streamingTextRef.current = streamingBufferRef.current;
                setStreamingText(streamingBufferRef.current);
              }, 90);
            },
            addBlock: (event: any) => { setScrollOffset(0); setOutputBlocks((prev: any) => [...prev, { id: Date.now() + Math.random(), event }]); },
            clearBlocks: () => setOutputBlocks([]),
            setReviewEvent,
            setQuestionState,
            setChatStartTime: (val: number) => { chatStartTimeRef.current = val; },
            flushStream: () => {
              const prev = streamingBufferRef.current ?? streamingTextRef.current;
              if (streamingFlushTimerRef.current) {
                clearTimeout(streamingFlushTimerRef.current);
                streamingFlushTimerRef.current = null;
              }
              if (prev) {
                const color = ENGINE_COLORS[prev.engineId] ?? 124;
                setOutputBlocks((blocks: any) => [...blocks, { id: Date.now() - 1, event: { type: 'engine-block', engineId: prev.engineId, color, content: prev.content } }]);
              }
              streamingBufferRef.current = null;
              streamingTextRef.current = null;
              setStreamingText(null);
            },
            getEngineColor: (engineId: string) => ENGINE_COLORS[engineId] ?? 124,
            setCesarConfidence,
          };
  }, []);

  const transition = useCallback((fn:any) => {
          setReplState((prev: any) => {
            try { return fn({ state: prev }).state; }
            catch { return prev; }
          });
  }, []);

  const trackAbort = useCallback((abort:AbortController|null) => {
          if (activeAbortRef.current) _activeAborts.delete(activeAbortRef.current);
          activeAbortRef.current = abort;
          if (abort) _activeAborts.add(abort);
          setActiveAbort(abort);
  }, []);

  const setCesarSessionWrapped = useCallback((session:PersistentSession|null) => {
          _cesarSessionRef.session = session;
          setCesarSession(session);
  }, []);

  const activeEngines = useCallback(() => {
          const available = registry.availableIds();
          if (!sessionEngines) return available;
          return sessionEngines.filter((id: string) => available.includes(id));
  }, [registry,sessionEngines]);

  const dispatch = useCallback((event:OutputEvent) => {
          const et = (event as any).type;
          if (et === 'streaming-chunk' || et === 'progress-update' || et === 'tool-call' || et === 'spinner-start' || et === 'spinner-update') {
            lastActivityTimeRef.current = Date.now();
          }
          const state: OutputState = { liveSpinner: null, liveProgress: null, streamingText: streamingBufferRef.current ?? streamingTextRef.current };
          handleOutputEvent(event, state, outputActions, mode, chatStartTimeRef.current);
  }, [mode]);

  const askQuestion = useCallback((prompt:string) => {
          return new Promise<string>((resolve) => { dispatch({ type: 'question', prompt, resolve } as any); });
  }, [dispatch]);

  const interruptActiveRun = useCallback((message:string, clearChat:boolean) => {
          const abort = activeAbortRef.current;
          if (abort) abort.abort();
          trackAbort(null);
          setLiveSpinner(null);
          setLiveProgress(null);
          if (streamingFlushTimerRef.current) {
            clearTimeout(streamingFlushTimerRef.current);
            streamingFlushTimerRef.current = null;
          }
          streamingBufferRef.current = null;
          streamingTextRef.current = null;
          setStreamingText(null);
          clearPermissionQueue();
    
          if (replState !== 'idle') {
            if (message) dispatch({ type: 'warning', message } as any);
            setReplState((prev: any) => prev === 'idle' ? prev : cancelReplState({ state: prev }).state);
          }
    
          if (clearChat) dispatch({ type: 'clear' } as any);
  }, [replState,dispatch,trackAbort]);

  const buildContext = useCallback(() => {
          return {
            registry, adapter, activeEngines,
            config: loadConfig(), chatSession,
            get currentPlan() { return currentPlanRef.current; },
            setCurrentPlan, setActiveAbort: trackAbort,
            askQuestion, cesarSession, setCesarSession: setCesarSessionWrapped,
            explorationMode, setExplorationMode,
            neroMode, setNeroMode,
            cesarMemory,
            activePlan, setActivePlan,
            extensionPromptFragments,
            sessionMcpServers, setSessionMcpServers,
          };
  }, [registry,adapter,activeEngines,chatSession,askQuestion,cesarSession,explorationMode,neroMode,activePlan,extensionPromptFragments,sessionMcpServers]);

  const handleInputChange = useCallback((value:string) => {
          // Swallow input while a choice question is active — useInput handles keypress
          if (questionState && questionState.choices) return;
    
          // Reject value changes caused by Ctrl+key shortcuts (useInput already handled them,
          // but TextInput still fires onChange with the raw character)
          if (ctrlKeyHandledRef.current) {
            ctrlKeyHandledRef.current = false;
            return;
          }
    
          const nextValue = cleanInputValue(value);
    
          // "/" typed into empty input → open slash picker, swallow the character
          if (!inputValue && nextValue === '/' && !slashPickerOpen && !enginePickerOpen && !modelPickerOpen && !questionState && !justPastedRef.current) {
            if (planModeQueued) setPlanModeQueued(false);
            setSlashPickerOpen(true);
            setInputKey((k: number) => k + 1);
            return;
          }
    
          // When slash picker is open, don't update inputValue — picker manages its own filter
          if (slashPickerOpen) {
            return;
          }
    
          if (justPastedRef.current) {
            setInputValue(nextValue);
            return;
          }
    
          const change = findInputChange(inputValue, nextValue);
          const looksLikePaste = value !== nextValue || change.inserted.length > 1;
    
          if (!looksLikePaste || !change.inserted) {
            setInputValue(nextValue);
            return;
          }
    
          justPastedRef.current = true;
          setTimeout(() => { justPastedRef.current = false; }, 100);
    
          pasteCountRef.current += 1;
          const result = processPasteContent(change.inserted, pasteCountRef.current);
          if (result.type === 'empty') {
            setInputValue(nextValue);
            return;
          }
    
          if (result.type === 'stored') {
            pasteHashesRef.current.set(String(pasteCountRef.current), result.fullHash);
          }
    
          const replacement = result.type === 'stored' ? result.placeholder : result.content;
          const updatedValue = nextValue.slice(0, change.start) + replacement + nextValue.slice(change.start + change.inserted.length);
          setInputValue(updatedValue);
          setInputKey((k: number) => k + 1);
  }, [inputValue,slashPickerOpen,enginePickerOpen,modelPickerOpen,questionState,planModeQueued]);

  const handleSubmit = useCallback(async (value:string) => {
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
          pasteCountRef.current = 0;
          setInputValue(''); setInputHistory((prev: string[]) => [...prev, input]); setHistoryIndex(-1);
          // /btw <question> — side-channel question during active dispatch
          const btwLower = input.trim().toLowerCase();
          if (btwLower === '/btw') {
            dispatch({ type: 'info', message: 'Usage: /btw <question> — ask something while engines work.' } as any);
            return;
          }
          if (btwLower.startsWith('/btw ')) {
            const btwQuestion = input.trim().slice(5).trim();
            if (btwQuestion && replState !== 'idle') {
              // Fire side-dispatch — don't interrupt main task
              dispatch({ type: 'separator' } as any);
              dispatch({ type: 'user-message', content: `/btw ${btwQuestion}` } as any);
    
              const ctx = buildContext();
              const cesarId = (ctx.config as any).cesarEngine ?? ctx.config.forgeFixedStarter ?? 'claude';
              let engineDef: any;
              try { engineDef = ctx.registry.get(cesarId); } catch { /* cesar engine not registered */ }
    
              if (!engineDef) {
                dispatch({ type: 'error', message: `btw: engine ${cesarId} not available` } as any);
                return;
              }
    
              const color = ENGINE_COLORS[cesarId] ?? 124;
              dispatch({ type: 'info', message: 'btw\u2026' } as any);
    
              // Build context from streaming output
              let streamCtx = '';
              if (streamingTextRef.current && streamingTextRef.current.content) {
                const lines = streamingTextRef.current.content.split('\n').filter((l: string) => l.trim());
                streamCtx = lines.slice(-10).join('\n');
              }
    
              const prompt = `The user asks while you are working on another task:\n\n${btwQuestion}\n\n${streamCtx ? '--- Recent output from the running task ---\n' + streamCtx + '\n---\n\n' : ''}Answer briefly and concisely. Keep it short.`;
    
              const btwOutputDir = join(RUNS_DIR, `btw-${Date.now()}`);
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
                  dispatch({ type: 'engine-block', engineId: cesarId, color, content: answer } as any);
                } else {
                  dispatch({ type: 'warning', message: 'btw: no response' } as any);
                }
              }).catch((err: any) => {
                dispatch({ type: 'error', message: `btw: ${err instanceof Error ? err.message : String(err)}` } as any);
              });
              return;
            }
            // If idle, just process as regular input (falls through to normal dispatch)
            if (!btwQuestion) {
              dispatch({ type: 'info', message: 'Usage: /btw <question>' } as any);
              return;
            }
          }
          if (replState !== 'idle' && !jobManager.running().length) {
            setInputQueue((prev: string[]) => [...prev, input]);
            dispatch({ type: 'info', message: `Queued: ${input.length > 50 ? input.slice(0, 50) + '\u2026' : input}` } as any);
            return;
          }
          if (planModeQueued && input.trim() && !input.startsWith('/')) {
            setPlanModeQueued(false);
            handleSubmit(`/plan ${input}`);
            return;
          }
          if (planModeQueued) setPlanModeQueued(false);
          transition(startCommandReplState);
          dispatch({ type: 'separator' } as any);
          dispatch({ type: 'user-message', content: input } as any);
          const { text: cleanInput, images: detectedImages } = extractImagesFromInput(input, resolveWorkingDir());
          const allImages = [...pendingImages, ...detectedImages];
          let intent = detectIntent(cleanInput || input, commandRegistry);
          const cb: DispatchCallbacks = {
            dispatch, ctx: buildContext(), commandRegistry, eventBus, loadedExtensions, setWorkspacePath,
            runAsJob: (type: string, label: string, fn: () => Promise<void>) => {
              const job = jobManager.create(type, label);
              setJobList([...jobManager.list()]);
              // Transition to idle so user can submit new commands while job runs
              // Strip stays active via jobList.some(j => j.state === 'running') check
              setReplState((prev: any) => prev === 'idle' ? prev : finishReplState({ state: prev }).state);
              fn().then(() => { jobManager.complete(job.id); setJobList([...jobManager.list()]); })
                .catch((err: any) => { jobManager.fail(job.id, err instanceof Error ? err.message : String(err)); setJobList([...jobManager.list()]); dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) } as any); });
            },
            setMode, setPendingImages, setSessionEngines, setEnginePickerOpen, setModelPickerOpen, setModelPickerEntries, setModelPickerLoading, setCesarPickerOpen, setChatSession, setLastUndoToken, askQuestion, exit: () => process.exit(0),
            setModelPickerTargetEngine, setModelPickerInitialFilter, setModelPickerTitle,
            allImages, allSlashCommands: allSlashCommands, dynamicSkills: [...dynamicSkills, ...extensionSkills], mode, lastUndoToken, sessionStartTime, jobManager,
            explorationMode, setExplorationMode,
            neroMode, setNeroMode,
            setActivePlan,
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
          finally { setReplState((prev: any) => prev === 'idle' ? prev : finishReplState({ state: prev }).state); }
  }, [replState,dispatch,buildContext,mode,pendingImages,jobManager,loadedExtensions,extensionSkills,commandRegistry,eventBus,planModeQueued]);

  const handleReviewActionCb = useCallback((action:'apply'|'edit'|'reject'|'copy') => {
          if (!reviewEvent) return;
          const token = handleReviewAction({ type: action }, reviewEvent, dispatch);
          if (token) setLastUndoToken(token);
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
          else if (engineId === 'gemini' || env.includes('google') || baseUrl.includes('google') || display.includes('google')) providerFilter = 'provider:google';
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
    
          import('@agon/core').then(({ fetchModelsRegistry, buildModelEntries }) => {
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

  const handleSlashSelect = useCallback((cmd:string) => {
          setPlanModeQueued(false);
          setSlashPickerOpen(false);
          setInputValue(cmd + ' ');
          setInputKey((k: number) => k + 1);
  }, []);

  const handleQuestionAnswer = useCallback((answer:string) => {
          if (questionState) { questionState.resolve(answer); setQuestionState(null); setQuestionAnswer(''); }
  }, [questionState]);

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
          return () => {
            if (streamingFlushTimerRef.current) clearTimeout(streamingFlushTimerRef.current);
          };
  }, []);

  useEffect(() => {
          const modes = ['brainstorm', 'forge', 'tribunal', 'campfire'] as const;
          const offs: (() => void)[] = [];
          for (const mode of modes) {
            const off = eventBus.on(`post:${mode}`, () => {
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
            });
            offs.push(off);
          }
          return () => { for (const off of offs) off(); };
  }, [eventBus,dispatch,chatSession]);

  useEffect(() => {
          const onResize = () => setTermWidth(process.stdout.columns || 100);
          process.stdout.on('resize', onResize);
          return () => { process.stdout.off('resize', onResize); };
  }, []);

  useEffect(() => {
          const stdin = process.stdin;
          if (!stdin.isTTY) return;
          process.stdout.write('\x1b[?2004h');
          return () => { process.stdout.write('\x1b[?2004l'); };
  }, []);

  useEffect(() => {
          const available = registry.availableIds();
          const config = loadConfig();
          const ratings = getRatings();
          const defaultEngine = config.forgeFixedStarter ?? available[0] ?? 'none';
          const activeWs = getActiveWorkspace();
          const totalMatches = Object.values(ratings.global).reduce((sum: number, r: any) => sum + r.wins + r.losses, 0);
          const sorted = Object.entries(ratings.global)
            .map(([id, r]: any) => [id, { rating: Math.round(r.mu - 2 * r.phi) }] as const)
            .sort(([, a], [, b]) => b.rating - a.rating);
          const enabled = sessionEngines ?? available;
          let runCount = 0;
          try { runCount = readdirSync(RUNS_DIR).filter((f: string) => f.endsWith('.json')).length; } catch { /* runs dir missing — first run */ }
          setOutputBlocks([{ id: 0, event: {
            type: 'dashboard' as const, available, enabled, defaultEngine,
            eloTop: sorted.length > 0 ? { id: sorted[0][0], rating: (sorted[0][1] as any).rating } : undefined,
            totalForges: Math.floor(totalMatches / 2),
            workspace: activeWs ? { name: activeWs.name, path: activeWs.path, isKern: activeWs.isKern } : undefined,
            runCount,
          }}]);
  }, []);

  useEffect(() => {
          if (replState === 'idle' && inputQueue.length > 0) {
            const next = inputQueue[0];
            setInputQueue((prev: string[]) => prev.slice(1));
            setTimeout(() => handleSubmit(next), 50);
          }
  }, [replState,inputQueue]);

  useEffect(() => {
          _cancelCallback.fn = () => {
            for (const abort of _activeAborts) abort.abort();
            _activeAborts.clear();
            activeAbortRef.current = null;
            if (streamingFlushTimerRef.current) {
              clearTimeout(streamingFlushTimerRef.current);
              streamingFlushTimerRef.current = null;
            }
            streamingBufferRef.current = null;
            streamingTextRef.current = null;
            setActiveAbort(null); setLiveSpinner(null); setLiveProgress(null); setStreamingText(null);
            clearPermissionQueue();
            setReplState((prev: any) => prev === 'idle' ? prev : finishReplState({ state: prev }).state);
          };
  }, [setActiveAbort]);

  const _inputHandlerRef = useRef<(input: string, key: any) => void>(() => {});
  _inputHandlerRef.current = (input: string, key: any) => {
          // When model picker is open, let it handle all input (except Ctrl+C)
          if (modelPickerOpen || cesarPickerOpen) {
            if (input === '\x03' || (key.ctrl && input === 'c')) { process.exit(0); }
            return;
          }
          // Choice-based question: single keypress resolves immediately (letter key OR 1/2/3 numeric shortcut)
          if (questionState && questionState.choices) {
            const pressed = input.toLowerCase();
            const choices = questionState.choices as {key:string,label:string}[];
            const match = choices.find((c: any) => c.key.toLowerCase() === pressed);
            // Also accept 1-based numeric index: 1 = first choice, 2 = second, 3 = third, etc.
            const numIdx = /^[1-9]$/.test(pressed) ? parseInt(pressed, 10) - 1 : -1;
            const resolved = match ?? (numIdx >= 0 && numIdx < choices.length ? choices[numIdx] : null);
            if (resolved) {
              questionState.resolve(resolved.key);
              setQuestionState(null);
              setQuestionAnswer('');
              return;
            }
            if (key.escape) {
              questionState.resolve('n');
              setQuestionState(null);
              setQuestionAnswer('');
              return;
            }
            return; // Swallow other keys while choices are shown
          }
          if ((key.tab || input === '\t') && !slashPickerOpen && !enginePickerOpen && !questionState && !reviewEvent) {
            const ghost = getGhostCompletion(inputValue, allSlashCommands, registry.availableIds());
            if (ghost) { setInputValue(inputValue + ghost + ' '); setInputKey((k: number) => k + 1); return; }
            if (shouldQueuePlanModeOnTab({ replState, inputValue, activePlanState: activePlan?.state ?? null })) {
              setPlanModeQueued((prev: boolean) => !prev);
              return;
            }
            return;
          }
          if (key.ctrl && input === 'l') {
            handleSubmit('/clear'); return;
          }
          // Scroll output: Shift+Up/Down for 5 blocks, Ctrl+U/D for full page
          if (key.shift && key.upArrow) {
            setScrollOffset((prev: number) => Math.min(prev + 3, Math.max(0, outputBlocks.length - 1)));
            return;
          }
          if (key.shift && key.downArrow) {
            setScrollOffset((prev: number) => Math.max(0, prev - 3));
            return;
          }
          if ((key.ctrl && input === 'e') || input === '\x05') {
            ctrlKeyHandledRef.current = true;
            setToolOutputExpanded((prev: boolean) => !prev); return;
          }
          if ((key.ctrl && input === 't') || input === '\x14') {
            ctrlKeyHandledRef.current = true;
            setThinkingExpanded((prev: boolean) => !prev); return;
          }
          if (key.ctrl && input === 'r') {
            openResultsPager();
            return;
          }
          if (key.escape) {
            if (planModeQueued) { setPlanModeQueued(false); return; }
            const decision = resolveEscapeAction({
              replState,
              inputValue,
              slashPickerOpen,
              enginePickerOpen,
              questionOpen: !!questionState,
            });
    
            switch (decision.action) {
              case 'close-slash':
                setSlashPickerOpen(false);
                return;
              case 'close-engine-picker':
                setEnginePickerOpen(false);
                return;
              case 'cancel-question':
                if (questionState) { questionState.resolve(''); setQuestionState(null); setQuestionAnswer(''); }
                return;
              case 'interrupt':
                interruptActiveRun('Interrupted.', false);
                return;
              case 'clear-input':
                setInputValue('');
                return;
              case 'noop':
                return;
            }
          }
          if (key.ctrl && input === 'j') {
            setInputValue((prev: string) => prev + '\n'); return;
          }
          if (!enginePickerOpen && !questionState) {
            if (key.upArrow && inputHistory.length > 0 && !slashPickerOpen) {
              const r = navigateHistory('up', historyIndex, inputHistory);
              setHistoryIndex(r.index); if (r.value) setInputValue(r.value);
            }
            if (key.downArrow && historyIndex >= 0 && !slashPickerOpen) {
              const r = navigateHistory('down', historyIndex, inputHistory);
              setHistoryIndex(r.index); setInputValue(r.value);
            }
          }
          if (input === '\x03' || (key.ctrl && input === 'c')) {
            if (questionState) { questionState.resolve(''); setQuestionState(null); setQuestionAnswer(''); }
            if (replState !== 'idle') {
              interruptActiveRun(activeAbortRef.current ? 'Cancelled.' : 'Interrupted.', false);
            } else { process.exit(0); }
          }
  };
  useInput((input: string, key: any) => _inputHandlerRef.current(input, key));

        return (
        <Box flexDirection="column">
          {mode !== 'chat' && (
            <Box paddingX={1}>
              <Text dimColor>{icons().find + ' '}{resolveWorkingDir().split('/').pop()}</Text>
              <Text dimColor>{' \u2502 '}</Text>
              <Text color={mode === 'campfire' ? '#f97316' : mode === 'brainstorm' ? '#22d3ee' : '#a78bfa'}>{mode}</Text>
              <Text dimColor>{' \u2502 '}</Text>
              <Text dimColor>{registry.availableIds().length}{' engines'}</Text>
              {replState !== 'idle' && (<><Text dimColor>{' \u2502 '}</Text><Text color="yellow">{replState}</Text></>)}
              {(() => {
                const running = jobList.filter((j: Job) => j.state === 'running');
                if (running.length === 0) return null;
                return (<><Text dimColor>{' \u203a '}</Text><Text color="#facc15">{running.map((j: Job) => `${j.type}: ${j.label.slice(0, 20)}`).join(', ')}</Text></>);
              })()}
            </Box>
          )}
          <BackgroundJobRail jobs={jobList.filter((j: Job) => j.state === 'running')} />
          <Box flexDirection="column">
            {scrollOffset > 0 && <Box paddingX={1}><Text dimColor>{`↑ ${scrollOffset} block${scrollOffset > 1 ? 's' : ''} above — Shift+↑ to scroll`}</Text></Box>}
            {(() => {
              const visibleBlocks = scrollOffset > 0 ? outputBlocks.slice(0, outputBlocks.length - scrollOffset) : outputBlocks;
              if (toolOutputExpanded) {
                return visibleBlocks.map((block: OutputBlock) => (<OutputBlockView key={block.id} event={block.event} mode={mode} toolOutputExpanded={true} thinkingExpanded={thinkingExpanded} />));
              }
              // Group tool calls — absorb minor events (info, warning, success) between them
              const minorTypes = new Set(['info', 'warning', 'success', 'separator']);
              const groups: (OutputBlock | OutputBlock[])[] = [];
              let idx = 0;
              while (idx < visibleBlocks.length) {
                if (visibleBlocks[idx].event.type === 'tool-call') {
                  const group: OutputBlock[] = [];
                  while (idx < visibleBlocks.length) {
                    const t = visibleBlocks[idx].event.type;
                    if (t === 'tool-call') { group.push(visibleBlocks[idx]); idx++; }
                    else if (minorTypes.has(t) && idx + 1 < visibleBlocks.length && visibleBlocks[idx + 1].event.type === 'tool-call') { idx++; }
                    else break;
                  }
                  groups.push(group);
                } else { groups.push(visibleBlocks[idx]); idx++; }
              }
              return groups.map((item: OutputBlock | OutputBlock[], gi: number) => {
                if (Array.isArray(item)) {
                  if (item.length === 1) return <OutputBlockView key={item[0].id} event={item[0].event} mode={mode} toolOutputExpanded={false} thinkingExpanded={thinkingExpanded} />;
                  return <ToolCallGroup key={`tg-${item[0].id}`} blocks={item} />;
                }
                return <OutputBlockView key={item.id} event={item.event} mode={mode} toolOutputExpanded={false} thinkingExpanded={thinkingExpanded} />;
              });
            })()}
            {streamingText && (() => {
              const c = engineColor(streamingText.engineId);
              const cleaned = cleanEngineOutput(streamingText.content);
              const wrapWidth = contentWidth(mode === 'chat' ? 6 : 8);
              const segments = parseMarkdownBlocks(cleaned);
              return mode === 'chat' ? (
                (() => {
                  const lines = cleaned.split('\n').filter((line: string) => line.trim());
                  const lastLine = lines.length > 0 ? lines[lines.length - 1].trim() : '';
                  const previewLimit = Math.max(24, wrapWidth - streamingText.engineId.length - 6);
                  const preview = lastLine.length > previewLimit ? lastLine.slice(0, previewLimit - 1) + '…' : lastLine;
                  return (
                    <Box marginY={1} paddingLeft={1}>
                      <Text color={c} bold>{icons().dotOn + ' '}{streamingText.engineId}</Text>
                      <Text dimColor>{preview ? ` ${preview}` : ' streaming…'}</Text>
                    </Box>
                  );
                })()
              ) : (
                <Box flexDirection="column" marginY={1} paddingLeft={2}>
                  <Text color={c} bold>{'┌── '}{streamingText.engineId}</Text>
                  <Text color={c}>{'│'}</Text>
                  <RenderedSegments segments={segments} borderColor={c} wrapWidth={wrapWidth} />
                </Box>
              );
            })()}
            {liveProgress && <EngineProgressView engines={liveProgress} mode={mode} />}
          </Box>
          {reviewEvent && <ReviewBlock event={reviewEvent} onAction={handleReviewActionCb} />}
          {enginePickerOpen && (
            <EnginePicker available={registry.availableIds()} initialSelected={sessionEngines ?? registry.availableIds()}
              userEngines={new Set(registry.list().filter((e: any) => e.tier === 'user').map((e: any) => e.id))}
              modelOverrides={(loadConfig() as any).engineModels ?? {}}
              onConfirm={(selected: string[]) => { setEnginePickerOpen(false); setSessionEngines(selected); configSet('forgeEnabledEngines', selected); dispatch({ type: 'success', message: `Active engines: ${selected.join(', ')}` } as any); }}
              onCancel={() => setEnginePickerOpen(false)}
              onRemove={(engineId: string) => {
                const engPath = join(homedir(), '.agon', 'engines', `${engineId}.json`);
                try { unlinkSync(engPath); } catch (_e) {}
                const nextModels = { ...((loadConfig() as any).engineModels ?? {}) };
                delete nextModels[engineId];
                configSet('engineModels', nextModels as any);
                registry.unregister(engineId);
                setSessionEngines((prev: string[]|null) => prev ? prev.filter((id: string) => id !== engineId) : null);
                dispatch({ type: 'success', message: `Removed: ${engineId}` } as any);
              }}
              onSetModel={(engineId: string, model: string | null) => {
                const nextModels = { ...((loadConfig() as any).engineModels ?? {}) };
                if (model) nextModels[engineId] = model;
                else delete nextModels[engineId];
                configSet('engineModels', nextModels as any);
                dispatch({ type: 'success', message: model ? `Model override set: ${engineId} → ${model}` : `Model override cleared: ${engineId}` } as any);
              }}
              onBrowseModel={(engineId: string) => openCliModelPicker(engineId)} />
          )}
          {modelPickerOpen && (
            <ModelPicker entries={modelPickerEntries} loading={modelPickerLoading} initialFilter={modelPickerInitialFilter} title={modelPickerTitle}
              onSelect={(entry: any) => {
                if (modelPickerTargetEngine) {
                  const nextModels = { ...((loadConfig() as any).engineModels ?? {}) };
                  nextModels[modelPickerTargetEngine] = entry.modelId;
                  configSet('engineModels', nextModels as any);
                  dispatch({ type: 'success', message: `Model override set: ${modelPickerTargetEngine} → ${entry.modelId}` } as any);
                  setModelPickerTargetEngine(null);
                  setModelPickerInitialFilter('');
                  setModelPickerTitle('Select model');
                  setModelPickerOpen(false);
                  setEnginePickerOpen(true);
                  return;
                }
                setModelPickerOpen(false);
                const def = modelEntryToEngineDef(entry);
                const dir = join(homedir(), '.agon', 'engines');
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, `${def.id}.json`), JSON.stringify(def, null, 2) + '\n');
                registry.register(def as any);
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
              engines={registry.availableIds()}
              currentCesar={(loadConfig() as any).cesarEngine ?? loadConfig().forgeFixedStarter ?? 'claude'}
              onSelect={(engineId: string) => {
                setCesarPickerOpen(false);
                configSet('cesarEngine', engineId);
                if (cesarSession) { cesarSession.close(); setCesarSession(null); }
                dispatch({ type: 'success', message: `Cesar brain set to: ${engineId}` } as any);
                dispatch({ type: 'info', message: 'Conversation context + memory preserved.' } as any);
              }}
              onCancel={() => setCesarPickerOpen(false)} />
          )}
          {liveSpinner && mode !== 'chat' && <SpinnerBlock message={liveSpinner.message} color={liveSpinner.color} />}
          {!enginePickerOpen && !modelPickerOpen && !cesarPickerOpen && (
            <Box flexDirection="column" paddingX={1} marginTop={1}>
              {slashPickerOpen && <SlashPicker commands={allSlashCommands} onSelect={handleSlashSelect} onCancel={() => setSlashPickerOpen(false)} />}
              {pendingImages.length > 0 && (<Box><Text color="#22d3ee">{icons().image + ' '}</Text>{pendingImages.map((img: any, i: number) => (<Text key={i} dimColor>{img.filename}{i < pendingImages.length - 1 ? ', ' : ''}</Text>))}</Box>)}
              {inputQueue.length > 0 && (<Box><Text dimColor>{icons().queue + ' '}{inputQueue.length} queued: </Text><Text dimColor italic>{inputQueue[0].length > 40 ? inputQueue[0].slice(0, 40) + '…' : inputQueue[0]}</Text></Box>)}
              {liveSpinner && mode === 'chat' && (
                <Box paddingLeft={1}>
                  <Text color="#fbbf24">{liveSpinner.message}</Text>
                </Box>
              )}
              <Box borderStyle={mode === 'chat' ? 'round' : 'single'} borderColor={mode === 'chat' ? (questionState ? '#fbbf24' : '#585858') : 'gray'} borderLeft={mode !== 'chat'} borderRight={mode !== 'chat'} borderTop borderBottom paddingX={1} width="100%">
                {mode !== 'chat' && (<Text><Text color={mode === 'campfire' ? '#f97316' : mode === 'brainstorm' ? '#22d3ee' : '#a78bfa'} bold>{mode === 'campfire' ? icons().campfire : mode === 'brainstorm' ? icons().brainstorm : icons().tribunal}{' '}{mode}</Text><Text dimColor>{' │ '}</Text></Text>)}
                <Text color={mode === 'chat' ? (planModeQueued || (activePlan && activePlan.state === 'planning') ? '#c084fc' : '#585858') : '#fbbf24'}>{mode === 'chat' ? (planModeQueued ? '◈ ' : '> ') : icons().prompt + ' '}</Text>
                <Box flexGrow={1}>
                  {slashPickerOpen ? (
                    <Text dimColor>{inputValue || '/'}</Text>
                  ) : (
                    <><TextInput key={inputKey} value={inputValue} onChange={handleInputChange} onSubmit={handleSubmit}
                      placeholder={replState === 'idle' ? mode === 'chat' ? '' : mode === 'campfire' ? 'What should we think about?' : mode === 'brainstorm' ? 'What question for the engines?' : 'What should they debate?' : ''} />
                    {(() => { const ghost = getGhostCompletion(inputValue, allSlashCommands, registry.availableIds()); return ghost ? <Text dimColor>{ghost}</Text> : null; })()}</>
                  )}
                </Box>
              </Box>
              {questionState && (
                <Box flexDirection="column" paddingLeft={2} marginTop={0}>
                  <Text bold color="#fbbf24">{questionState.prompt}</Text>
                  {questionState.choices ? (
                    <Box flexDirection="column" paddingLeft={1}>
                      {(questionState.choices as {key:string,label:string,color?:string}[]).map((c: any, i: number) => (
                        <Text key={i}><Text color={c.color ?? '#6b7280'} bold>  [{i + 1}/{c.key}] </Text><Text>{c.label}</Text></Text>
                      ))}
                    </Box>
                  ) : (
                    <Box paddingLeft={1}><TextInput value={questionAnswer} onChange={setQuestionAnswer} onSubmit={handleQuestionAnswer} /></Box>
                  )}
                </Box>
              )}
              {(() => {
                const _cfg = loadConfig();
                const _cesarId = (_cfg as any).cesarEngine ?? _cfg.forgeFixedStarter ?? 'claude';
                // Extract last non-empty line from streaming text for status strip
                let snippet: { engineId: string; line: string } | null = null;
                if (streamingText && streamingText.content) {
                  const cleaned = cleanEngineOutput(streamingText.content);
                  const lines = cleaned.split('\n').filter((l: string) => l.trim());
                  if (lines.length > 0) snippet = { engineId: streamingText.engineId, line: lines[lines.length - 1].trim() };
                }
                return (<>
                  <CesarStatusStrip cesarId={_cesarId} confidence={cesarConfidence} spinner={liveSpinner} engines={liveProgress} startTime={chatStartTimeRef.current || 0} streamSnippet={snippet} isActive={replState !== 'idle' || jobList.some((j: Job) => j.state === 'running')} planModeQueued={planModeQueued} activePlanState={activePlan?.state ?? null} />
                  {mode === 'chat' && <StatusBar config={_cfg} chatSession={chatSession} explorationMode={explorationMode} toolOutputExpanded={toolOutputExpanded} thinkingExpanded={thinkingExpanded} isActive={replState !== 'idle'} />}
                </>);
              })()}
            </Box>
          )}
        </Box>
        );
}


// @kern-source: app:1029
export async function startRepl(): Promise<void> {
  ensureAgonHome();
  ensureCurrentWorkspace(process.cwd());
  process.on('SIGINT', () => {
    if (_activeAborts.size > 0) {
      for (const abort of _activeAborts) abort.abort();
      _activeAborts.clear();
      if (_cancelCallback.fn) _cancelCallback.fn();
    } else {
      if (_cesarSessionRef.session) { try { _cesarSessionRef.session.close(); } catch { /* session already closed or errored */ } _cesarSessionRef.session = null; }
      process.exit(0);
    }
  });
  render(<App />, { exitOnCtrlC: false });
}

