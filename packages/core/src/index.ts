export * from './types.js';
export * from './errors.js';
export { loadConfig, configGet, configSet, ensureAgonHome, getAgonHome, agonPath, AGON_HOME, RATINGS_PATH, TEAM_ELO_PATH, CORPUS_PATH, SKILLS_DIR, RUNS_DIR } from './config.js';
export { computeScore, tiebreak, DEFAULT_WEIGHTS } from './scoring.js';
export { updateGlicko, updateGlickoRanked, getRatings, getEngineGlickoRating, advisorScore, rankEnginesByRating, pickTopRatedEngine, seedSuccessorRating, seedEnginesFromLineage, lineageFromRegistry, seedNewEnginesFromRegistry } from './glicko.js';
export { classifyTask } from './task-classifier.js';
export { searchHistorySemantic } from './history-search.js';
export type { HistorySearchItem, HistorySearchHit } from './history-search.js';
export {
  validateSyntax, detectLanguageFromPath,
  SYNTAX_VALIDATOR_TIMEOUT_MS, SYNTAX_VALIDATOR_DISABLE_ENV,
} from './syntax-validator.js';
export { resolveDedupSidecar } from './generated/blocks/dedup-resolver.js';
export {
  createRunDir, writeRunStatus, printRunSummary, findLatestRunDir,
  sanitizeRunLabel,
} from './run-dir.js';
export type {
  CreateRunDirOptions, RunDirHandle, RunStatus, RunStatusEngine,
} from './run-dir.js';
export type {
  SyntaxValidatorInput, SyntaxValidatorResult, SyntaxValidationError,
} from './syntax-validator.js';
export { defaultFinalizeOnScoreForTask } from './generated/blocks/finalize-policy.js';
export {
  repoRoot, headSha, worktreePrune, worktreeCreate, worktreeRemove,
  worktreeRemoveBestEffort, worktreePruneAll, worktreePruneOrphaned, stashSnapshot,
  worktreeDiff, worktreeChangedDiff, worktreeChangedShortstat,
  readOnlyDiff, diffLineCount, diffFileCount, applyPatch, recentCommits,
  currentBranch, isDirty,
  gitStatusShort, gitDiffStat, gitChangedFiles, gitTruncatedDiff,
  absoluteGitDir, branchExists, worktreeAddOnBranch, hydrateWorktreeBuildArtifacts,
  coAuthorTrailer, appendCoAuthor,
} from './git.js';
export {
  createSessionWorktree, listSessionWorktrees, findSessionWorktree,
  removeSessionWorktree, pruneSessionWorktrees, rehydrateSessionWorktree,
  detectPackageManager, sessionWorktreesDir, worktreePathFor,
} from './worktree-session.js';
export type { SessionWorktree } from './worktree-session.js';
export {
  acquireApplyLock, releaseApplyLock, headChanged, branchChanged,
} from './worktree-lock.js';
export type { ApplyLockInfo, ApplyLockResult } from './worktree-lock.js';
export { spawnWithTimeout, spawnStream } from './process.js';
export type { SpawnOptions } from './process.js';
export {
  buildForgePrompt, buildCritiquePrompt, buildSynthesisPrompt,
  buildBrainstormPrompt, buildTribunalPrompt, buildReviewPrompt,
  buildForgePromptWithContext,
} from './prompt-builder.js';
export { createLogger } from './logger.js';
export type { Logger } from './logger.js';
export { EngineRegistry } from './engine-registry.js';
export { scanProjectContext, isKernProject, hasProjectBrief, buildKernContextSpine, discoverGate, bashRanGate, isGateSkipSignal } from './context-scanner.js';
export type { DiscoveredGate } from './context-scanner.js';
export { buildCodebaseMap, collectSourceFiles, extractSymbols, clearCodebaseMapCache } from './generated/blocks/codebase-map.js';
export {
  addWorkspace, removeWorkspace, listWorkspaces,
  getActiveWorkspace, switchWorkspace, getWorkspace,
  ensureCurrentWorkspace, snapshotWorkspace, resolveWorkingDir,
} from './workspace.js';
export type { Workspace, WorkspaceState } from './workspace.js';
export type { ContextFormat } from './context-scanner.js';
export { tracker, estimateTokens, estimateCost } from './token-tracker.js';
export type { TokenUsage, SessionStats } from './token-tracker.js';
export {
  createPlan, advanceStep, canAutoApprove,
  mergeStepResult, approvePlan, startPlan, cancelPlan, failPlan, resetStepForRetry,
} from './plan.js';
export type {
  Plan, PlanStep, PlanStepInput, PlanAction, StepResult, StepAttempt,
  ArtifactRef, WorkspaceSnapshot, PlanState, StepState, StepEffect,
  PlanStepKind, ApprovalLevel,
} from './plan.js';
export { savePlan, loadPlan, listPlans, deletePlan } from './plan-store.js';
export { wordWrap } from './text.js';
export {
  installKernStackTraceMapper,
  mapKernStackTrace,
  resolveKernSourceLocation,
  uninstallKernStackTraceMapper,
} from './generated/blocks/stack-trace.js';
export type { KernSourceLocation } from './generated/blocks/stack-trace.js';
export {
  formatSpinnerFrame, formatEngineBlock, formatStatusLine,
  clearLinesSequence, cursorUpSequence, clearLineSequence,
} from './output-manager.js';
export { parseStreamChunk, StreamParser } from './stream-parser.js';
export type { ParsedChunk } from './stream-parser.js';
export { discoverEngines } from './engine-discover.js';
export type { DiscoveryResult } from './engine-discover.js';
export { preflightApply, applyPatchToTree, readPatchFromManifest, readPatchFromPath, applyPatchWithUndo, undoPatch } from './patch-apply.js';
export type { PatchInfo, ApplyPreflight } from './patch-apply.js';
export { parsePatch, patchSummary, invertPatch } from './patch-parser.js';
export type { PatchFile, PatchHunk } from './patch-parser.js';
export { takeSnapshot, revertSnapshot, listSnapshots, getLatestSnapshotId } from './file-history.js';
export type { FileSnapshot, HistoryEntry } from './file-history.js';
export { copyToClipboard } from './clipboard.js';
export { pasteStore, PASTE_MAX_AGE } from './paste-store.js';
export type { PasteStoreResult } from './paste-store.js';
export {
  saveSessionState, loadSessionState, clearSessionState,
  saveToolResultToDisk, loadToolResultFromDisk, pruneToolCache,
  sessionCacheDir,
  saveConversation, loadConversation, clearConversation, stripEngineArtifacts,
} from './session-store.js';
// ── Session budget — proactive context-window management ──
export {
  estimateSessionTokens, estimateMessageHistoryTokens, estimateFlatHistoryTokens,
  estimatePtyTokens, estimateMessageTokens, effectiveWindow, resolveCharsPerToken,
} from './generated/sessions/token-estimator.js';
export type {
  EstimatorMessage, PtyAccumulation, SessionTokenInputs,
} from './generated/sessions/token-estimator.js';
export {
  checkSessionBudget, resolveThresholds, budgetRatioPct,
} from './generated/sessions/session-budget.js';
export type {
  BudgetCheck, BudgetThresholds,
} from './generated/sessions/session-budget.js';
// ── Context Parts (structured message parts + StageContext) ──
export {
  buildStageContext, renderStageContext,
} from './context-parts.js';
export type {
  TextPart, ToolCallPart, ToolResultPart, ReasoningPart, CompactionSummaryPart,
  MessagePart, ToolCacheEntry, StageContext, StageDecision, ToolResultRef,
} from './context-parts.js';
export { runApiAgentLoop } from './generated/api/agent-loop.js';
export type { ApiAgentOptions, ApiAgentResult } from './generated/api/agent-loop.js';
// ── Engine dispatch isolation ──
export { resolveIsolationMode, planEngineIsolation, isValidIsolationMode, ISOLATION_MODES } from './generated/signals/isolation.js';
export type { EngineIsolationPlan } from './generated/signals/isolation.js';
// ── Tool System ──
export type { ToolResult, ToolContext, ToolHandler, ToolDefinition, ToolCall, ToolCallResult, PermissionDecision, FileState as ToolFileState, ParsedPermissionRule, PermissionRuleSet, ToolHookDef, ParsedToolHooks } from './tool-types.js';
export { parseToolHooks, hasToolHooks, runPreToolUseHooks, runPostToolUseHooks } from './tool-hooks.js';
export { FileStateCache, fileStateCache, getProjectFileStateCache, clearProjectFileStateCaches } from './file-state-cache.js';
export { ToolRegistry, executeToolCall, executeToolCalls, PERMISSION_DENIED_MESSAGE } from './tool-registry.js';
export { isDangerousCommand, isReadOnlyCommand, isPathUnderCwd } from './tool-permissions.js';
export { parsePermissionRule, parsePermissionRuleSet, ruleMatches, evaluatePermissionRules, evaluateToolRules, evaluateBashRules, evaluateFilePathRules, hasShellControl, hasRedirection, hasSubstitution, splitShellSegments, resolveRulePath, pathRuleMatches } from './tool-permissions.js';
export { createReadTool, createEditTool, createWriteTool, createBashTool, createGrepTool, createGlobTool, createForgeTool, createBrainstormTool, createTribunalTool, createCampfireTool, createReportConfidenceTool, createDelegateTool, createPipelineTool, createGoalTool, createConquerTool, createReviewTool, createAgentTool, createProposePlanTool, createExitPlanModeTool, createListPlansTool, createRetrieveResultTool, createWebFetchTool, parseAndValidateUrl, htmlToText, createTodoWriteTool, normalizeTodos, createSaveMemoryTool, appendMemoryLine, normalizeMemoryLine, todayPrefix, canonicalMemorySection, MEMORY_SECTIONS, createWebSearchTool, buildSearchRequest, parseSearchResults, formatSearchResults, createQuickNeroTool } from './tools.js';
export { formatCesarPlanMarkdown } from './generated/cesar/plan-formatter.js';
export { generateToolPrompt, toolsToOpenAIFormat } from './generated/tools/tool-prompt.js';
export { parseToolCalls, toolCallsToApiFormat, formatToolResults, formatToolResult } from './generated/tools/tool-parser.js';
export type { ParsedToolCall, ParseResult } from './generated/tools/tool-parser.js';
export { discoverMcpServers, mcpDiscoveryFingerprint, mcpServersToWireFormat } from './generated/tools/mcp-discovery.js';
export type { McpServerConfig } from './generated/tools/mcp-discovery.js';
export { buildToolSystemPrompt, processToolResponse, runToolLoop } from './generated/tools/tool-loop.js';
export type { ToolLoopCallbacks, ToolLoopResult } from './generated/tools/tool-loop.js';
export { startChatSession, appendMessage, appendUserTurnIfAbsent, updateChatSummary, formatChatHistoryForPrompt, formatChatContextForPrompt, buildHistoryPrimedPrompt, seedChatSessionFromThread, loadChatSession, resumeChatSession, listChatSessions, latestChatSession } from './chat-store.js';
export type { ChatMessage as StoredChatMessage, ChatSession } from './chat-store.js';
export {
  isImagePath, mimeFromExt, resolveImagePath,
  buildImageAttachment, extractImagesFromInput, normalizeDroppedPath,
  encodeImagesForDispatch,
} from './image.js';
// ── Agon Rooms — multi-party room ledger (file-first; CLI/MCP/daemon are adapters) ──
export {
  roomsDir, roomDir, createRoom, listRooms, roomExists, closeRoom, isRoomClosed,
  appendEvent, readEvents, parseMentions, slugifyRoomId,
} from './generated/rooms/store.js';
export { recordPresence, removePresence, listPresence, PRESENCE_TTL_MS } from './generated/rooms/presence.js';
export { acquireTurnLease, releaseTurnLease, readActiveLease } from './generated/rooms/leases.js';
export { detectTrigger, detectPingPong, evaluateStop } from './generated/rooms/auto-policy.js';
export type { RoomActor, RoomEvent, RoomMeta, PresenceEntry, TurnLease, AutoConfig, AutoState, StopDecision, TriggerDecision } from './generated/rooms/types.js';
// ── EventLog — append-only per-session event ledger (client/server split M1) ──
export {
  append as eventLogAppend, flush as eventLogFlush, replay as eventLogReplay,
  latestSeq as eventLogLatestSeq, listSessions as eventLogListSessions,
  readMeta as eventLogReadMeta, resetEventLogState, eventLogWriteFailures,
  sessionsRoot as eventLogSessionsRoot, sessionDir as eventLogSessionDir,
  eventsPath as eventLogEventsPath, metaPath as eventLogMetaPath,
  sanitizeSessionId as eventLogSanitizeSessionId,
  EVENT_LOG_FLUSH_MS, EVENT_LOG_ROTATE_BYTES,
} from './generated/sessions/event-log.js';
export type { LoggedEvent, SessionMeta as EventLogSessionMeta, AppendOptions as EventLogAppendOptions } from './generated/sessions/event-log.js';
// ── SessionHost — read-side seam over the EventLog ledger (client/server split M2) ──
export { InProcessSessionHost, inProcessSessionHost, getSessionHost, SUBSCRIBE_POLL_MS } from './generated/sessions/session-host.js';
export type { SessionHost, SessionDescriptor, SubscribeOptions } from './generated/sessions/session-host.js';
// ── Daemon wire protocol — newline-JSON frames agond speaks (client/server split M3) ──
export {
  encodeDaemonRequest, encodeDaemonResponse,
  parseDaemonRequest, parseDaemonResponse, splitFrames,
} from './generated/sessions/daemon-protocol.js';
export type { DaemonRequest, DaemonResponse } from './generated/sessions/daemon-protocol.js';
export { logFlow, readFlows, analyzeFlows, FLOWS_DIR, FRICTION_TAGS } from './flow.js';
export type { FlowRecord, FlowTelemetry, FlowFeedback, FlowModeMeta, FlowAnalysis, ModeStats } from './flow.js';
export { apiDispatch, apiStreamDispatch, apiStreamDispatchWithHistory } from './api-dispatch.js';
export type { ApiConfig } from './api-dispatch.js';
export { companionDispatch } from './companion-dispatch.js';
export type { CompanionResult } from './companion-dispatch.js';
export { fetchModelsRegistry, buildModelEntries, searchModels, modelEntryToEngineDef } from './models-registry.js';
export type { ModelEntry, ModelsDevProvider, ModelsDevModel } from './models-registry.js';
export { buildCliModelGroups, buildCliModelGroupsAsync, buildCliGroupsImmediate, refreshCliGroup, refreshCliGroupVersion, getBinaryVersionAsync, discoverCliModelsAsync, findBinary, getBinaryVersion, readProbedCliModels, refreshProbedCliModels } from './cli-models-registry.js';
export type { CliModelEntry, CliProviderGroup } from './cli-models-registry.js';
export { loadAuthStore, saveAuthStore, setAuthKey, removeAuthKey, getAuthKey, loadAllAuthKeys, listStoredProviders } from './auth-store.js';
export type { AuthEntry, AuthStore } from './auth-store.js';
export {
  createPersistentSession, createCompanionSession, createAcpSession,
  createStreamJsonSession, createResumeSession,
} from './persistent-session.js';
export type {
  PersistentSession, PersistentSessionConfig, SessionChunk, SessionSendOptions,
} from './persistent-session.js';
export { StreamBridge, createStreamBridge } from './generated/cesar/stream-bridge.js';
export type { EngineSwitch } from './generated/cesar/stream-bridge.js';
export {
  VirtualFS, createFileSnapshot, applyEffectPackage, relocateEffectPackage, effectPackageDiff, scoreEffectPackage, snapshotRead, snapshotList,
} from './generated/forge/virtual-fs.js';
export type {
  FileEffect, EffectPackage, FileSnapshot as VfsSnapshot,
} from './generated/forge/virtual-fs.js';
export { Speculator, createSpeculator } from './generated/cesar/speculator.js';
export type {
  SpeculatorMemberConfig, SpeculatorOptions, SpeculatorResult,
} from './generated/cesar/speculator.js';
export { createCesarMemory, buildProjectMemoryBlock, extractProjectMemorySections, stripProjectMemorySections } from './generated/cesar/memory.js';
export type { CesarMemory, MemoryEntry } from './generated/cesar/memory.js';
export {
  ContextThread, loadOrCreateActiveThread, forkActiveThread, listThreadsForProject, deleteThread, projectHash16, projectSha8,
} from './generated/cesar/context-thread.js';
export type {
  ThreadMessage, ThreadCheckpoint, FileTouch, LoopMessage, ContextThreadConfig, ThreadSize,
} from './generated/cesar/context-thread.js';
export { createCesarPlan, approveCesarPlan, advanceCesarStep, cancelCesarPlan, exitCesarPlan, saveCesarPlan, loadCesarPlan, listCesarPlans, getCesarPlansDir, cesarPlanJsonPath, cesarPlanMarkdownPath, CESAR_STEP_TYPES } from './generated/cesar/plan.js';
export type { CesarPlan, CesarPlanStep, CesarStepResult } from './generated/cesar/plan.js';
export { sanitizePlanSteps } from './generated/cesar/plan-validation.js';
export { planCostEstimator } from './generated/cesar/plan-cost-estimator.js';
export type { CostEstimate } from './generated/cesar/plan-cost-estimator.js';
export { executePlan, getReadySteps } from './generated/cesar/plan-executor.js';
export type { StepExecutor, PlanExecutorCallbacks } from './generated/cesar/plan-executor.js';
export { AgentSession, makeBudgetError } from './generated/cesar/agent-session.js';
export type {
  AgentBudget, AgentStepResult, AgentSessionStats, AgentSessionConfig,
} from './generated/cesar/agent-session.js';
export {
  AgentTeam, makeAgentTeamError, makeAgentTeamDisposedError,
} from './generated/cesar/agent-team.js';
export type {
  AgentTeamConfig, AgentTeamMemberConfig, AgentTeamMemberResult, AgentTeamResult,
  AgentTeamBudget,
} from './generated/cesar/agent-team.js';
export {
  determineWinner, scoreAgentTeamResult,
} from './generated/cesar/synthesis-utils.js';
export {
  buildAgentSynthesisPrompt, buildAgentInvestigateSynthesisPrompt,
  runAgentTeamSynthesis, runAgentInvestigateSynthesis,
  runPostSynthesisFitnessCheck, detectSynthesisInsightMention,
} from './generated/cesar/agent-synthesis.js';
export type {
  AgentSynthesisLoser, AgentSynthesisOptions, AgentSynthesisResult,
  AgentInvestigateSynthesisOptions, AgentInvestigateSynthesisResult,
  PostSynthesisFitnessResult, SynthesisBiasSignal,
} from './generated/cesar/agent-synthesis.js';
export {
  tokensToCost, estimatedTokensToCost, getEnginePricing,
} from './generated/blocks/pricing.js';
export type { PricingEntry } from './generated/blocks/pricing.js';
export {
  Semaphore, isHeavyTool,
} from './generated/blocks/semaphore.js';
export {
  createAgentState, beginTurn, completeTurn, requestApproval, approveTool, rejectTool,
  cancelAgent, failAgent, completeAgent, checkBudget, isTerminal,
} from './generated/cesar/agent-state.js';
export type {
  AgentMessage, AgentTurn, AgentContext, AgentPhase, AgentState,
} from './generated/cesar/agent-state.js';
export {
  makeAssistantChunk, makeToolCall, makeTurnComplete, makeError,
  normalizeSessionChunk, buildApiTurnEvents, unavailableUsage, estimatedUsage,
} from './generated/models/agent-event.js';
export type { AgentEvent, AgentUsage, RawSessionChunk } from './generated/models/agent-event.js';
export { runHooks, hooksFailed, hooksOutput } from './hooks.js';
export type { HookEvent, HookDef, HookResult } from './hooks.js';
export { loadSkills, findSkill, renderSkillPrompt } from './skill-loader.js';
export {
  loadEngineMemory, addEngineNote, setEngineStrengths, setEngineWeaknesses,
  addEngineTendency, getEngineProfile, buildRolePrompt, filePathToMemoryPattern,
  extractPatchFilePatterns, recordForgeOutcome, recordForgeJudgment,
} from './engine-memory.js';
export type { EngineNote, EngineProfile, EngineMemoryRecord, EngineStrengthObservation } from './engine-memory.js';
export { rankByTaskClass, buildSpecializedPrompt, assignForgeRoles } from './role-specialization.js';
export type { EngineRole } from './role-specialization.js';
export type { Skill } from './skill-loader.js';
export { createSidechainLogger } from './sidechain-logger.js';
export type { SidechainEvent, SidechainLogger } from './sidechain-logger.js';
export {
  buildForgeProvenance,
  renderProvenanceMarkdown,
  renderProvenanceJson,
  sha256OfFile,
  writeProvenanceReport,
} from './provenance.js';
export type { ProvenanceLedger, ProvenanceContribution } from './provenance.js';
export { validateEngineConfig, validateEngineDir, EngineDefinitionSchema } from './schemas/engine-schema.js';
export { validateManifest } from './extension-manifest.js';
export type { ExtensionManifest, ExtensionContributions, CommandContribution, LoadedExtension } from './extension-manifest.js';
export { CommandRegistry } from './command-registry.js';
export type { CommandDefinition, CommandHandler } from './command-registry.js';
export { initExtensions, loadExtensions, discoverExtensionDirs, buildExtensionContext } from './extension-loader.js';
export { registerBuiltinCommands } from './builtin-commands.js';
export { EventBus, bridgeShellHooks } from './event-bus.js';
export type { EventPayload, EventListener } from './event-bus.js';
export { EngineHealth, engineHealth, classifyDispatchFailure } from './engine-health.js';
export type { EngineHealthRecord } from './engine-health.js';
export type { ValidatedEngineDefinition } from './schemas/engine-schema.js';
export { sessionContext } from './session-context.js';
export type { SessionResult, BrainstormResultData, CampfireResultData, TribunalResultData, ForgeResultData, ThinkResultData, CouncilResultData, SynthesisResultData, NeroResultData, ReviewResultData } from './generated/models/session-result-types.js';
export {
  splitPromptBlocks, mergeBlocksByRole,
} from './prompt-builder.js';
export type { PromptBlock } from './prompt-builder.js';
// ── Team Competition ──
export {
  lineupKey, makeFormat, assignTeamRoles, composeTeams, computeContributionWeights,
} from './generated/teams/team.js';
export type {
  TeamRole, TeamComposeMode, TeamCoopStrategy, TeamMember, TeamSpec, TeamFormat,
  TeamRoundTrace, TeamSubmission, TeamScoreCard, TeamMatchResult, TeamEvent,
} from './generated/teams/team.js';
export { getTeamElo, updateTeamElo, predictTeamRating } from './generated/teams/team-elo.js';
export type { TeamCompositionRating, TeamRoleRating, TeamEloRecord } from './generated/teams/team-elo.js';
