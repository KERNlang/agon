// @kern-source: ui-app:4
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';

// @kern-source: ui-app:5
import { Box, Text, render, useApp, useInput } from 'ink';

// @kern-source: ui-app:6
import TextInput from 'ink-text-input';

// @kern-source: ui-app:7
import { EngineRegistry, loadConfig, ensureAgonHome, ensureCurrentWorkspace, startChatSession, getElo, getActiveWorkspace, RUNS_DIR, extractImagesFromInput, resolveWorkingDir, currentBranch, configSet, createCesarMemory, modelEntryToEngineDef } from '@agon/core';

// @kern-source: ui-app:8
import type { Plan, ChatSession, Skill, PersistentSession, ImageAttachment } from '@agon/core';

// @kern-source: ui-app:9
import type { EngineProgress } from '../handlers/types.js';

// @kern-source: ui-app:10
import { createCliAdapter } from '@agon/adapter-cli';

// @kern-source: ui-app:11
import type { EngineAdapter } from '@agon/core';

// @kern-source: ui-app:12
import { detectIntent, SLASH_COMMANDS } from '../intent.js';

// @kern-source: ui-app:13
import { CommandRegistry, registerBuiltinCommands, initExtensions, EventBus, bridgeShellHooks } from '@agon/core';

// @kern-source: ui-app:14
import { JobManager } from '../generated/job-manager.js';

// @kern-source: ui-app:15
import type { Job } from '../generated/job-manager.js';

// @kern-source: ui-app:16
import { ENGINE_COLORS } from '../output.js';

// @kern-source: ui-app:17
import { icons } from '../icons.js';

// @kern-source: ui-app:18
import { parseMarkdownBlocks, cleanEngineOutput } from '../markdown.js';

// @kern-source: ui-app:19
import type { OutputEvent, HandlerContext } from '../handlers/types.js';

// @kern-source: ui-app:20
import { codeBlockBuffer } from '../code-buffer.js';

// @kern-source: ui-app:21
import { getGhostCompletion } from '../ghost-text.js';

// @kern-source: ui-app:22
import { startCommandReplState, finishReplState, cancelReplState } from '../generated/app-state.js';

// @kern-source: ui-app:23
import type { ReplStateState } from '../generated/app-state.js';

// @kern-source: ui-app:24
import { processPasteContent, expandPastePlaceholders } from '../paste-handler.js';

// @kern-source: ui-app:25
import { dispatchIntent, handleModeSwitch } from '../generated/app-dispatch.js';

// @kern-source: ui-app:26
import type { DispatchCallbacks } from '../generated/app-dispatch.js';

// @kern-source: ui-app:27
import { handleOutputEvent, clearPermissionQueue } from '../generated/app-output.js';

// @kern-source: ui-app:28
import type { OutputActions, OutputState } from '../generated/app-output.js';

// @kern-source: ui-app:29
import { cleanInputValue, cleanSubmitValue, findInputChange, navigateHistory, resolveEscapeAction } from '../generated/app-input.js';

// @kern-source: ui-app:30
import { handleReviewAction } from '../generated/app-review.js';

// @kern-source: ui-app:31
import { SpinnerBlock, EngineProgressView, StatusLine, StatusBar, CesarStatusStrip, OutputBlockView, ToolCallGroup, SlashPicker, EnginePicker, ModelPicker, ReviewBlock, BackgroundJobRail, RenderedSegments, CesarPicker, contentWidth, engineColor } from '../components.js';

// @kern-source: ui-app:32
import type { OutputBlock, ReviewEvent } from '../components.js';

// @kern-source: ui-app:33
import { join, dirname } from 'node:path';

// @kern-source: ui-app:34
import { fileURLToPath } from 'node:url';

// @kern-source: ui-app:35
import { readdirSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';

// @kern-source: ui-app:36
import { homedir, tmpdir } from 'node:os';

// @kern-source: ui-app:37
import { spawnSync } from 'node:child_process';

// @kern-source: ui-app:38
import { sessionResultStore } from '../generated/session-results.js';

// @kern-source: ui-app:39
import { formatSessionResults } from '../generated/results-formatter.js';

// @kern-source: ui-app:40
import { loadSkills } from '@agon/core';

// @kern-source: ui-app:43
export const _activeAborts: Set<AbortController> = new Set<AbortController>();

// @kern-source: ui-app:46
export const _cancelCallback: { fn: (() => void) | null } = { fn: null };

// @kern-source: ui-app:49
export const _cesarSessionRef: { session: PersistentSession | null } = { session: null };

// @kern-source: ui-app:52

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
  const [cesarPickerOpen, setCesarPickerOpen] = useState<boolean>(false);
  const [streamingText, setStreamingText] = useState<any>(null);
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [reviewEvent, setReviewEvent] = useState<ReviewEvent|null>(null);
  const [jobManager, setJobManager] = useState<any>(new JobManager());
  const [jobList, setJobList] = useState<Job[]>([]);
  const [lastUndoToken, setLastUndoToken] = useState<string|null>(null);
  const [sessionEngines, setSessionEngines] = useState<string[]|null>((() => { const cfg = loadConfig(); const saved = cfg.forgeEnabledEngines; return saved && saved.length > 0 ? saved : null; })());
  const [currentPlan, setCurrentPlan] = useState<Plan|null>(null);
  const [activePlan, setActivePlan] = useState<any>(null);
  const [chatSession, setChatSession] = useState<ChatSession>((() => { const cwd = resolveWorkingDir(); let branch = 'unknown'; try { branch = currentBranch(cwd); } catch {} return startChatSession({ cwd, branch }); })());
  const [activeAbort, setActiveAbort] = useState<AbortController|null>(null);
  const [cesarSession, setCesarSession] = useState<PersistentSession|null>(null);
  const [explorationMode, setExplorationMode] = useState<boolean>(false);
  const [neroMode, setNeroMode] = useState<boolean>(false);
  const [toolOutputExpanded, setToolOutputExpanded] = useState<boolean>(false);
  const [cesarConfidence, setCesarConfidence] = useState<number|null>(null);
  const [planModeQueued, setPlanModeQueued] = useState<boolean>(false);
  const [cesarMemory, setCesarMemory] = useState<any>(() => createCesarMemory());
  const [registry, setRegistry] = useState<EngineRegistry>((() => { const reg = new EngineRegistry(); const engDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../engines'); reg.load(engDir); return reg; })());
  const [adapter, setAdapter] = useState<EngineAdapter>(createCliAdapter(registry));
  const [dynamicSkills, setDynamicSkills] = useState<Skill[]>(loadSkills());
  const [commandRegistry, setCommandRegistry] = useState<any>((() => { const reg = new CommandRegistry(); registerBuiltinCommands(reg); return reg; })());
  const [eventBus, setEventBus] = useState<any>((() => { const bus = new EventBus(); const cfg = loadConfig(); if (cfg.hooks) bridgeShellHooks(bus, cfg.hooks); return bus; })());
  const [extensionSkills, setExtensionSkills] = useState<Skill[]>([]);
  const [extensionPromptFragments, setExtensionPromptFragments] = useState<string[]>([]);
  const [loadedExtensions, setLoadedExtensions] = useState<any[]>([]);
  const [workspacePath, setWorkspacePath] = useState<string>(resolveWorkingDir());
  const chatStartTimeRef = useRef<number>(0);
  const currentPlanRef = useRef<Plan|null>(null);
  const streamingTextRef = useRef<any>(null);
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
            setStreamingText: (val: any) => { streamingTextRef.current = val; setStreamingText(val); },
            addBlock: (event: any) => setOutputBlocks((prev: any) => [...prev, { id: Date.now() + Math.random(), event }]),
            clearBlocks: () => setOutputBlocks([]),
            setReviewEvent,
            setQuestionState,
            setChatStartTime: (val: number) => { chatStartTimeRef.current = val; },
            flushStream: () => {
              const prev = streamingTextRef.current;
              if (prev) {
                const color = ENGINE_COLORS[prev.engineId] ?? 245;
                setOutputBlocks((blocks: any) => [...blocks, { id: Date.now() - 1, event: { type: 'engine-block', engineId: prev.engineId, color, content: prev.content } }]);
                streamingTextRef.current = null;
                setStreamingText(null);
              }
            },
            getEngineColor: (engineId: string) => ENGINE_COLORS[engineId] ?? 245,
            setCesarConfidence,
          };
  }, []);

  const transition = useCallback((fn:any) => {
          setReplState((prev: any) => fn({ state: prev }).state);
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
          const state: OutputState = { liveSpinner: null, liveProgress: null, streamingText: streamingTextRef.current };
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
          };
  }, [registry,adapter,activeEngines,chatSession,askQuestion,cesarSession,explorationMode,neroMode,activePlan,extensionPromptFragments]);

  const handleInputChange = useCallback((value:string) => {
          const nextValue = cleanInputValue(value);
    
          // "/" typed into empty input → open slash picker, swallow the character
          if (!inputValue && nextValue === '/' && !slashPickerOpen && !enginePickerOpen && !modelPickerOpen && !questionState && !justPastedRef.current) {
            setSlashPickerOpen(true);
            setInputKey((k: number) => k + 1);
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
  }, [inputValue]);

  const handleSubmit = useCallback(async (value:string) => {
          let input = cleanSubmitValue(value);
          if (!input) return;
          // Bare "/" → open slash picker flyout, don't dump text list
          if (input === '/') { setSlashPickerOpen(true); return; }
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
              try { engineDef = ctx.registry.get(cesarId); } catch {}
    
              if (!engineDef) {
                dispatch({ type: 'error', message: `btw: engine ${cesarId} not available` } as any);
                return;
              }
    
              const color = ENGINE_COLORS[cesarId] ?? 245;
              dispatch({ type: 'info', message: 'btw\u2026' } as any);
    
              // Build context from streaming output
              let streamCtx = '';
              if (streamingTextRef.current && streamingTextRef.current.content) {
                const lines = streamingTextRef.current.content.split('\n').filter((l: string) => l.trim());
                streamCtx = lines.slice(-10).join('\n');
              }
    
              const prompt = `The user asks while you are working on another task:\n\n${btwQuestion}\n\n${streamCtx ? '--- Recent output from the running task ---\n' + streamCtx + '\n---\n\n' : ''}Answer briefly and concisely. Keep it short.`;
    
              const btwOutputDir = join(RUNS_DIR, `btw-${Date.now()}`);
              try { mkdirSync(btwOutputDir, { recursive: true }); } catch {}
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
              setReplState((prev: any) => prev === 'idle' ? prev : finishReplState({ state: prev }).state);
              fn().then(() => { jobManager.complete(job.id); setJobList([...jobManager.list()]); })
                .catch((err: any) => { jobManager.fail(job.id, err instanceof Error ? err.message : String(err)); setJobList([...jobManager.list()]); dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) } as any); });
            },
            setMode, setPendingImages, setSessionEngines, setEnginePickerOpen, setModelPickerOpen, setModelPickerEntries, setModelPickerLoading, setCesarPickerOpen, setChatSession, setLastUndoToken, askQuestion, exit: () => process.exit(0),
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
  }, [replState,dispatch,buildContext,mode,pendingImages,jobManager,loadedExtensions,extensionSkills,commandRegistry,eventBus]);

  const handleReviewActionCb = useCallback((action:'apply'|'edit'|'reject'|'copy') => {
          if (!reviewEvent) return;
          const token = handleReviewAction({ type: action }, reviewEvent, dispatch);
          if (token) setLastUndoToken(token);
          setReviewEvent(null);
  }, [reviewEvent,dispatch]);

  const openResultsPager = useCallback(() => {
          if (!sessionResultStore.hasResults()) {
            dispatch({ type: 'info', message: 'No results yet — run /brainstorm, /campfire, /tribunal, or /forge first' } as any);
            return;
          }
          const content = formatSessionResults(sessionResultStore.getResults());
          const tmpFile = join(tmpdir(), `agon-results-${Date.now()}.txt`);
          try {
            writeFileSync(tmpFile, content, 'utf-8');
            const pager = process.env.PAGER || 'less';
            const args = pager === 'less' ? ['-R', tmpFile] : [tmpFile];
            spawnSync(pager, args, { stdio: 'inherit' });
          } catch (err) {
            dispatch({ type: 'error', message: `Pager failed: ${err instanceof Error ? err.message : String(err)}` } as any);
          } finally {
            try { unlinkSync(tmpFile); } catch {}
          }
  }, [dispatch]);

  const handleSlashSelect = useCallback((cmd:string) => {
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
          const stdin = process.stdin;
          if (!stdin.isTTY) return;
          process.stdout.write('\x1b[?2004h');
          return () => { process.stdout.write('\x1b[?2004l'); };
  }, []);

  useEffect(() => {
          const available = registry.availableIds();
          const config = loadConfig();
          const elo = getElo();
          const defaultEngine = config.forgeFixedStarter ?? available[0] ?? 'none';
          const activeWs = getActiveWorkspace();
          const totalMatches = Object.values(elo.global).reduce((sum: number, r: any) => sum + r.wins + r.losses, 0);
          const sorted = Object.entries(elo.global).sort(([, a]: any, [, b]: any) => b.rating - a.rating);
          const enabled = sessionEngines ?? available;
          let runCount = 0;
          try { runCount = readdirSync(RUNS_DIR).filter((f: string) => f.endsWith('.json')).length; } catch {}
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
            if (replState === 'idle') {
              if (activePlan && ['planning', 'awaiting_approval', 'running', 'paused'].includes(activePlan.state)) return;
              setPlanModeQueued((prev: boolean) => !prev);
              return;
            }
            return;
          }
          if (key.ctrl && input === 'l') {
            handleSubmit('/clear'); return;
          }
          if ((key.ctrl && input === 'e') || input === '\x05') {
            setToolOutputExpanded((prev: boolean) => !prev); return;
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
            </Box>
          )}
          <BackgroundJobRail jobs={jobList.filter((j: Job) => j.state === 'running')} />
          <Box flexDirection="column">
            {(() => {
              if (toolOutputExpanded) {
                return outputBlocks.map((block: OutputBlock) => (<OutputBlockView key={block.id} event={block.event} mode={mode} toolOutputExpanded={true} />));
              }
              // Group tool calls — absorb minor events (info, warning, success) between them
              const minorTypes = new Set(['info', 'warning', 'success', 'separator']);
              const groups: (OutputBlock | OutputBlock[])[] = [];
              let idx = 0;
              while (idx < outputBlocks.length) {
                if (outputBlocks[idx].event.type === 'tool-call') {
                  const group: OutputBlock[] = [];
                  while (idx < outputBlocks.length) {
                    const t = outputBlocks[idx].event.type;
                    if (t === 'tool-call') { group.push(outputBlocks[idx]); idx++; }
                    else if (minorTypes.has(t) && idx + 1 < outputBlocks.length && outputBlocks[idx + 1].event.type === 'tool-call') { idx++; }
                    else break;
                  }
                  groups.push(group);
                } else { groups.push(outputBlocks[idx]); idx++; }
              }
              return groups.map((item: OutputBlock | OutputBlock[], gi: number) => {
                if (Array.isArray(item)) {
                  if (item.length === 1) return <OutputBlockView key={item[0].id} event={item[0].event} mode={mode} toolOutputExpanded={false} />;
                  return <ToolCallGroup key={`tg-${item[0].id}`} blocks={item} />;
                }
                return <OutputBlockView key={item.id} event={item.event} mode={mode} toolOutputExpanded={false} />;
              });
            })()}
            {streamingText && (() => {
              const c = engineColor(streamingText.engineId);
              const cleaned = cleanEngineOutput(streamingText.content);
              const wrapWidth = contentWidth(mode === 'chat' ? 6 : 8);
              const segments = parseMarkdownBlocks(cleaned);
              return mode === 'chat' ? (
                <Box flexDirection="column" marginY={1} paddingLeft={1}>
                  <Text><Text color={c} bold>{icons().dotOn + ' '}{streamingText.engineId}</Text></Text>
                  <Text>{' '}</Text>
                  <RenderedSegments segments={segments} borderColor={''} wrapWidth={wrapWidth} />
                </Box>
              ) : (
                <Box flexDirection="column" marginY={1} paddingLeft={2}>
                  <Text color={c} bold>{'┌── '}{streamingText.engineId}</Text>
                  <Text color={c}>{'│'}</Text>
                  <RenderedSegments segments={segments} borderColor={c} wrapWidth={wrapWidth} />
                </Box>
              );
            })()}
            {liveProgress && <EngineProgressView engines={liveProgress} />}
          </Box>
          {reviewEvent && <ReviewBlock event={reviewEvent} onAction={handleReviewActionCb} />}
          {enginePickerOpen && (
            <EnginePicker available={registry.availableIds()} initialSelected={sessionEngines ?? registry.availableIds()}
              userEngines={new Set(registry.list().filter((e: any) => e.tier === 'user').map((e: any) => e.id))}
              onConfirm={(selected: string[]) => { setEnginePickerOpen(false); setSessionEngines(selected); configSet('forgeEnabledEngines', selected); dispatch({ type: 'success', message: `Active engines: ${selected.join(', ')}` } as any); }}
              onCancel={() => setEnginePickerOpen(false)}
              onRemove={(engineId: string) => {
                const engPath = join(homedir(), '.agon', 'engines', `${engineId}.json`);
                try { unlinkSync(engPath); } catch (_e) {}
                registry.unregister(engineId);
                setSessionEngines((prev: string[]|null) => prev ? prev.filter((id: string) => id !== engineId) : null);
                dispatch({ type: 'success', message: `Removed: ${engineId}` } as any);
              }} />
          )}
          {modelPickerOpen && (
            <ModelPicker entries={modelPickerEntries} loading={modelPickerLoading}
              onSelect={(entry: any) => {
                setModelPickerOpen(false);
                const def = modelEntryToEngineDef(entry);
                const dir = join(homedir(), '.agon', 'engines');
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, `${def.id}.json`), JSON.stringify(def, null, 2) + '\n');
                registry.register(def as any);
                dispatch({ type: 'success', message: `Added: ${entry.providerName} \u2014 ${entry.modelName}` } as any);
              }}
              onCancel={() => setModelPickerOpen(false)} />
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
          {liveSpinner && (mode === 'chat'
            ? <StatusLine startTime={chatStartTimeRef.current || Date.now()} engineId={liveSpinner.engineId} color={liveSpinner.color} />
            : <SpinnerBlock message={liveSpinner.message} color={liveSpinner.color} />)}
          {!enginePickerOpen && !modelPickerOpen && !cesarPickerOpen && (
            <Box flexDirection="column" paddingX={1} marginTop={1}>
              {slashPickerOpen && <SlashPicker commands={allSlashCommands} onSelect={handleSlashSelect} onCancel={() => setSlashPickerOpen(false)} />}
              {pendingImages.length > 0 && (<Box><Text color="#22d3ee">{icons().image + ' '}</Text>{pendingImages.map((img: any, i: number) => (<Text key={i} dimColor>{img.filename}{i < pendingImages.length - 1 ? ', ' : ''}</Text>))}</Box>)}
              {inputQueue.length > 0 && (<Box><Text dimColor>{icons().queue + ' '}{inputQueue.length} queued: </Text><Text dimColor italic>{inputQueue[0].length > 40 ? inputQueue[0].slice(0, 40) + '…' : inputQueue[0]}</Text></Box>)}
              {questionState ? (
                <Box flexDirection="column">
                  <Box><Text bold color="yellow">{questionState.prompt}</Text></Box>
                  {questionState.choices ? (
                    <Box gap={2} marginTop={0}>
                      {(questionState.choices as {key:string,label:string,color?:string}[]).map((c: any, i: number) => (
                        <Text key={i}><Text color={c.color ?? '#6b7280'} bold>[{i + 1}/{c.key}]</Text><Text> {c.label}</Text></Text>
                      ))}
                    </Box>
                  ) : (
                    <Box><TextInput value={questionAnswer} onChange={setQuestionAnswer} onSubmit={handleQuestionAnswer} /></Box>
                  )}
                </Box>
              ) : (
                <Box borderStyle={mode === 'chat' ? 'round' : 'single'} borderColor={mode === 'chat' ? '#585858' : 'gray'} borderLeft={mode !== 'chat'} borderRight={mode !== 'chat'} borderTop borderBottom paddingX={1} width="100%">
                  {mode !== 'chat' && (<Text><Text color={mode === 'campfire' ? '#f97316' : mode === 'brainstorm' ? '#22d3ee' : '#a78bfa'} bold>{mode === 'campfire' ? icons().campfire : mode === 'brainstorm' ? icons().brainstorm : icons().tribunal}{' '}{mode}</Text><Text dimColor>{' │ '}</Text></Text>)}
                  {(planModeQueued || (activePlan && ['planning', 'awaiting_approval', 'running', 'paused'].includes(activePlan.state))) && (<Text><Text color="#c084fc" bold>{'◈ plan'}</Text><Text dimColor>{planModeQueued ? ' ready' : activePlan.state === 'planning' ? ' thinking…' : activePlan.state === 'awaiting_approval' ? ' review' : activePlan.state === 'running' ? ' executing…' : ' paused'}</Text><Text dimColor>{' │ '}</Text></Text>)}
                  <Text color={mode === 'chat' ? (planModeQueued || (activePlan && activePlan.state === 'planning') ? '#c084fc' : '#585858') : '#fbbf24'}>{mode === 'chat' ? '> ' : icons().prompt + ' '}</Text>
                  <Box flexGrow={1}>
                    <TextInput key={inputKey} value={inputValue} onChange={handleInputChange} onSubmit={handleSubmit}
                      placeholder={replState === 'idle' ? mode === 'chat' ? '' : mode === 'campfire' ? 'What should we think about?' : mode === 'brainstorm' ? 'What question for the engines?' : 'What should they debate?' : ''} />
                    {(() => { const ghost = getGhostCompletion(inputValue, allSlashCommands, registry.availableIds()); return ghost ? <Text dimColor>{ghost}</Text> : null; })()}
                  </Box>
                </Box>
              )}
              {(() => {
                // Extract last non-empty line from streaming text for btw/status
                let snippet: { engineId: string; line: string } | null = null;
                if (streamingText && streamingText.content) {
                  const cleaned = cleanEngineOutput(streamingText.content);
                  const lines = cleaned.split('\n').filter((l: string) => l.trim());
                  if (lines.length > 0) snippet = { engineId: streamingText.engineId, line: lines[lines.length - 1].trim() };
                }
                return (<>
                  <CesarStatusStrip cesarId={(loadConfig() as any).cesarEngine ?? loadConfig().forgeFixedStarter ?? 'claude'} confidence={cesarConfidence} spinner={liveSpinner} engines={liveProgress} startTime={chatStartTimeRef.current || 0} streamSnippet={snippet} isActive={replState !== 'idle'} planModeQueued={planModeQueued} activePlan={activePlan} />
                  {mode === 'chat' && <StatusBar config={loadConfig()} chatSession={chatSession} explorationMode={explorationMode} toolOutputExpanded={toolOutputExpanded} isActive={replState !== 'idle'} />}
                </>);
              })()}
            </Box>
          )}
        </Box>
        );
}


// @kern-source: ui-app:756
export async function startRepl(): Promise<void> {
  ensureAgonHome();
  ensureCurrentWorkspace(process.cwd());
  process.on('SIGINT', () => {
    if (_activeAborts.size > 0) {
      for (const abort of _activeAborts) abort.abort();
      _activeAborts.clear();
      if (_cancelCallback.fn) _cancelCallback.fn();
    } else {
      if (_cesarSessionRef.session) { try { _cesarSessionRef.session.close(); } catch {} _cesarSessionRef.session = null; }
      process.exit(0);
    }
  });
  render(<App />, { exitOnCtrlC: false });
}

